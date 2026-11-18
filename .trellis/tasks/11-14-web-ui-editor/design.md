# Design — Web UI 可视化编辑器

## 架构总览

```
src/
├── types/           # 数据模型类型定义
├── store/           # Zustand store（元素状态 + 历史记录）
├── hooks/           # 变换/对齐/多选逻辑 hooks
├── utils/           # 数学工具函数（矩阵、bbox 计算）
├── components/
│   ├── Canvas/      # 画布容器（自适应缩放）
│   ├── Element/     # 单元素渲染 + 控制手柄
│   ├── Toolbar/     # 顶部工具栏（元素添加、undo/redo）
│   ├── AlignBar/    # 对齐操作栏
│   └── StylePanel/  # 右侧属性面板（颜色、描边等）
└── App.tsx

# 依赖：nanoid（id生成）+ tailwindcss v4（样式）
```

## 数据模型

```ts
// types/element.ts
type ElementType = 'rect' | 'circle' | 'triangle' | 'text' | 'image'

interface BaseElement {
  id: string
  type: ElementType
  x: number       // 左上角 x（逻辑坐标，相对画布）
  y: number       // 左上角 y
  w: number       // 宽
  h: number       // 高
  rotate: number  // 旋转角度（度，顺时针）
  groupId?: string // 组合 ID，相同 groupId 的元素属于同一组合（参考 PPTist）
  // 样式
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
}

interface TextElement extends BaseElement {
  type: 'text'
  content: string
  fontSize: number
  color: string
}

interface ImageElement extends BaseElement {
  type: 'image'
  src: string     // base64 或 ObjectURL
}

type Element = BaseElement | TextElement | ImageElement
```

## Zustand Store

```
useEditorStore
├── elements: Element[]          # 画布元素列表（扁平，group 靠 groupId 标记）
├── selectedIds: string[]        # 当前选中元素 id 列表
├── history: Element[][]         # 快照栈
├── historyIndex: number         # 当前指针
│
├── addElement(el)
├── updateElement(id, partial)
├── updateElements(ids, partialFn)   # 多选批量更新
├── deleteSelected()
├── pushHistory()                # mouseup 时调用
├── undo()
├── redo()
├── setSelected(ids)
├── toggleSelected(id)
├── groupSelected(groupId)       # 给选中元素分配同一 groupId
└── ungroupSelected()            # 清除选中元素的 groupId
```

历史记录实现参考 PPTist，使用内存数组（无需 IndexedDB，快照数量 ≤50 足够）：

```ts
pushHistory() {
  const snapshot = structuredClone(state.elements)
  const next = state.history.slice(0, state.historyIndex + 1)
  if (next.length >= 50) next.shift()
  set({ history: [...next, snapshot], historyIndex: next.length })
}
```

## 组合（Group）系统（参考 PPTist `groupId` 扁平方案）

### 设计原则

**不用父子嵌套树**，用扁平 `groupId` 标记：元素仍平铺在 `elements` 数组里，组合只是一个 tag。这避开父子嵌套的坐标换算链，2-3 天可行。

### 数据结构

每个元素带可选 `groupId`，相同 `groupId` = 同一组合。无 `groupId` = 独立元素。

### 组合/取消组合

```ts
groupSelected(groupId) {
  // 给所有 selectedIds 分配同一 groupId
  state.elements.forEach(el => {
    if (state.selectedIds.includes(el.id)) el.groupId = groupId
  })
  pushHistory()
}

ungroupSelected() {
  state.elements.forEach(el => {
    if (state.selectedIds.includes(el.id)) delete el.groupId
  })
  pushHistory()
}
```

### 选中联动

选中一个组合成员时，自动选中同组所有成员：
```ts
selectElement(id) {
  const el = state.elements.find(e => e.id === id)
  if (el.groupId) {
    // 选中同组所有元素
    const groupIds = state.elements.filter(e => e.groupId === el.groupId).map(e => e.id)
    setSelected(groupIds)
  } else {
    setSelected([id])
  }
}
```

### 组合整体移动

多选移动逻辑天然覆盖：所有 `selectedIds`（含同组元素）同步加 delta。

### 组合对齐（多层级问题核心，参考 PPTist `useAlignActiveElement.ts`）

```ts
// utils/align.ts — 对齐时考虑组合
function alignLeft(elements, selectedIds) {
  const selected = elements.filter(el => selectedIds.includes(el.id))
  
  // 计算各组合的整体 bbox（参考 PPTist groupElementRangeMap）
  const groupRangeMap = {}
  for (const el of selected) {
    if (el.groupId && !groupRangeMap[el.groupId]) {
      const groupMembers = selected.filter(e => e.groupId === el.groupId)
      groupRangeMap[el.groupId] = getBboxOfElements(groupMembers)
    }
  }
  
  // 选中集合整体 bbox
  const { minX } = getBboxOfElements(selected)
  
  // 计算每个元素新位置
  return selected.map(el => {
    if (!el.groupId) {
      // 独立元素：直接对齐
      const bbox = getRotatedBbox(el)
      return { id: el.id, x: el.x + (minX - bbox.l) }
    } else {
      // 组合成员：按组合整体偏移，保持组内相对位置不变
      const groupRange = groupRangeMap[el.groupId]
      const offset = groupRange.l - minX
      return { id: el.id, x: el.x - offset }
    }
  })
}
```

**关键**：组合成员对齐时按组合整体 bbox 偏移，组内元素相对位置不变，不拆散组合。

## 变换系统（核心）

### CSS 渲染映射

```css
/* 每个元素的 div */
position: absolute;
left: {x}px;
top: {y}px;
width: {w}px;
height: {h}px;
transform: rotate({rotate}deg);
transform-origin: center center;
```

### 移动

```
onMouseDown: 记录 startMouseX/Y, startX/Y
onMouseMove: dx = mouseX - startMouseX (需除以 canvasScale)
             element.x = startX + dx
             element.y = startY + dy
onMouseUp: pushHistory()
```

### 缩放（借鉴 fabric.js 锚点算法）

8 个手柄各自有固定对角锚点（anchor = 对面手柄的画布坐标）。

**无旋转情况**：
```
拖拽右下角手柄：
  anchorX = element.x           (左上角)
  anchorY = element.y
  newW = mouseX - anchorX
  newH = mouseY - anchorY
```

**有旋转情况**（关键难点，参考 fabric.js `scaleObject`）：
```
1. 将鼠标坐标转换到元素本地坐标系（逆旋转矩阵）
2. 在本地坐标系计算新宽高
3. 还原到全局坐标系更新 x/y
```

逆旋转矩阵工具函数：
```ts
// utils/matrix.ts
function rotatePoint(px, py, cx, cy, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  return {
    x: cos * (px - cx) - sin * (py - cy) + cx,
    y: sin * (px - cx) + cos * (py - cy) + cy,
  }
}

// 将鼠标点转到元素本地坐标系（元素中心为原点，消除旋转）
function toLocalCoord(mouseX, mouseY, el: Element) {
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  return rotatePoint(mouseX, mouseY, cx, cy, -el.rotate)
}
```

### 旋转

```
onMouseDown on rotate handle: 记录 startAngle
  startAngle = atan2(handleY - cy, handleX - cx) - el.rotate

onMouseMove:
  currentAngle = atan2(mouseY - cy, mouseX - cx)
  el.rotate = currentAngle - startAngle  (度数)
```

## 命中检测

旋转元素用 `getBoundingClientRect` 拿到的是外接矩形，会误触发。需要将鼠标坐标反旋转后再做矩形包含判断：

```ts
function hitTest(mx, my, el): boolean {
  const local = toLocalCoord(mx, my, el)
  return local.x >= el.x && local.x <= el.x + el.w
      && local.y >= el.y && local.y <= el.y + el.h
}
```

## 对齐算法（参考 PPTist `useAlignActiveElement`）

### 计算元素真实 bbox（含旋转修正）

```ts
// utils/bbox.ts
function getRotatedBbox(el: Element): Bbox {
  if (el.rotate === 0) return { l: el.x, t: el.y, r: el.x+el.w, b: el.y+el.h }
  // 求4个角点旋转后的坐标，取 min/max
  const cx = el.x + el.w/2, cy = el.y + el.h/2
  const corners = [
    rotatePoint(el.x,       el.y,       cx, cy, el.rotate),
    rotatePoint(el.x+el.w,  el.y,       cx, cy, el.rotate),
    rotatePoint(el.x+el.w,  el.y+el.h,  cx, cy, el.rotate),
    rotatePoint(el.x,       el.y+el.h,  cx, cy, el.rotate),
  ]
  return {
    l: Math.min(...corners.map(p=>p.x)),
    t: Math.min(...corners.map(p=>p.y)),
    r: Math.max(...corners.map(p=>p.x)),
    b: Math.max(...corners.map(p=>p.y)),
  }
}
```

### 对齐逻辑

```ts
// 以左对齐为例
function alignLeft(elements: Element[], ids: string[]): Partial<Element>[] {
  const selected = elements.filter(el => ids.includes(el.id))
  const bboxes = selected.map(getRotatedBbox)
  const minL = Math.min(...bboxes.map(b => b.l))
  return selected.map((el, i) => ({
    id: el.id,
    x: el.x + (minL - bboxes[i].l),  // 保持旋转中心，只移动 x
  }))
}
// 对齐完成后统一 pushHistory() 一次
```

## 多选

### 框选（Lasso）

```
onMouseDown on canvas (非元素区域):
  开始记录 lasso: {startX, startY, endX, endY}

onMouseMove:
  更新 lasso.endX/Y，显示虚线框

onMouseUp:
  计算 lasso bbox，findall elements 与 lasso 相交
  set selectedIds
  清除 lasso
```

### 整体移动

多选拖拽时，记录每个元素的 startX/Y，统一加 delta：
```ts
onMove: selectedIds.forEach(id => {
  update(id, { x: starts[id].x + dx, y: starts[id].y + dy })
})
```

## 自适应画布

```ts
// Canvas 组件
const containerRef = useRef()
const [scale, setScale] = useState(1)
const CANVAS_W = 1920, CANVAS_H = 1080

useEffect(() => {
  const ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    setScale(Math.min(width / CANVAS_W, height / CANVAS_H))
  })
  ro.observe(containerRef.current)
  return () => ro.disconnect()
}, [])
```

```jsx
<div ref={containerRef} style={{ width:'100%', height:'100%', overflow:'hidden' }}>
  <div style={{
    width: CANVAS_W, height: CANVAS_H,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    position: 'relative',
    background: '#fff',
  }}>
    {elements.map(el => <ElementNode key={el.id} element={el} />)}
  </div>
</div>
```

**注意**：所有鼠标/touch 坐标都需要除以 scale 换算到逻辑坐标系：
```ts
const logicalX = (clientX - canvasRect.left) / scale
```

## 移动端 Touch 支持

统一封装 `usePointerEvents` hook，同时处理 mouse 和 touch：

```ts
// 统一映射
function getPointer(e: MouseEvent | TouchEvent) {
  if ('touches' in e) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  return { x: e.clientX, y: e.clientY }
}
```

双指捏合缩放（画布整体缩放，不影响元素数据）：
- `touchstart` 双指：记录初始两指距离
- `touchmove`：计算新距离/初始距离 = scaleRatio，更新 canvas scale

## 兼容性与其他

- 鼠标事件绑定在 `document` 上（防止拖拽时鼠标移出元素丢失事件）
- `pointer-events: none` 加在画布内非交互层，避免事件穿透
- 文本编辑：双击设置 `contentEditable=true`，blur 时更新 store，同时阻止双击期间拖拽
