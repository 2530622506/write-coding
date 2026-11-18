# Implementation Plan — Web UI 可视化编辑器

## 规划状态

| 项 | 状态 |
|----|------|
| prd.md（需求 + 验收标准） | ✅ 完成 |
| design.md（架构 + 算法设计） | ✅ 完成 |
| implement.md（本文件，分阶段任务拆分） | ✅ 完成 |
| 代码实现（Task 0-4） | ✅ 完成，`npm run build` 零错误 |
| Task 5（触控打磨 + README） | ⬜ 待实现 |

---

## ⚠️ 待确认 / 不清楚的点

实现前需你拍板，否则按括号内默认方案执行：

1. ~~**「多层级问题」**~~ ✅ 已确认：使用 **`groupId` 扁平 Group 方案**（参考 PPTist）。元素平铺在数组，`groupId` 相同即同一组合；对齐时按组合整体 bbox 偏移成员。

2. **画布逻辑尺寸**：当前定为 1920×1080 固定。
   - ❓是否需要支持自定义画布尺寸？默认不支持。

3. **移动端框选 vs 长按多选**：touch 易与页面滚动冲突。
   - 默认方案：移动端取消 lasso 框选，改长按进入多选。
   - ❓是否接受？

4. **加分项（对齐辅助线 / 层叠顺序 / Pinch 缩放）**：时间不足时可砍。
   - ❓确认这三项优先级最低？

5. **历史记录上限**：默认 50 条。
   - ❓是否需要更大上限？

---

## 执行模式：多 Agent 并行

```
Task 0（地基，串行）
    ↓
Task 1  Task 2  Task 3  ← 三个 agent 并行
    └───────┬───────┘
         Task 4（集成接线，串行）
              ↓
           Task 5（触控 + 打磨，串行）
```

---

## Task 0 — 地基（串行，所有 task 的前提）

**必须最先完成，其他 task 的 import 均依赖此处定义。**

### 项目初始化
- [x] `npm create vite@latest ui-editor -- --template react-ts`
- [x] 安装依赖：`zustand`、`nanoid`、`tailwindcss v4`（`@tailwindcss/vite`）
- [x] 配置 Tailwind CSS v4（vite.config.ts 加插件，index.css 加 `@import "tailwindcss"`）
- [x] 配置 Vite alias `@` → `src/`
- [x] 建立目录结构：`types/` `store/` `hooks/` `utils/` `components/`

### 类型定义
- [x] `types/element.ts`：`BaseElement`、`TextElement`、`ImageElement`、`Element` 联合类型
  - 字段：`id`, `type`, `x`, `y`, `w`, `h`, `rotate`, `groupId?`, `fill`, `stroke`, `strokeWidth`, `opacity`
  - TextElement 追加：`content`, `fontSize`, `color`
  - ImageElement 追加：`src`

### Store
- [x] `store/editor.ts`：Zustand store
  - 状态：`elements: Element[]`、`selectedIds: string[]`、`history: Element[][]`、`historyIndex: number`
  - Actions：`addElement` / `updateElement` / `updateElements` / `deleteSelected`
  - Actions：`pushHistory` / `undo` / `redo`
  - Actions：`setSelected` / `toggleSelected` / `clearSelected`
  - Actions（Group）：`groupSelected()` / `ungroupSelected()`
  - 选中联动：选中一个组合成员时自动选中同组所有成员（`groupId` 相同）

### 工具函数
- [x] `utils/matrix.ts`：`rotatePoint(px,py,cx,cy,deg)`、`toLocalCoord(mx,my,el)`
- [x] `utils/bbox.ts`：`getRotatedBbox(el)`、`getBboxOfElements(els)`、`getGroupRangeMap(selected)`
- [x] `utils/align.ts`：`alignElements(elements, selectedIds, command)` 含组合成员按整体偏移逻辑
- [x] `utils/coords.ts`：`clientToCanvas` / `getPointerClient` / `getPinchDistance`

**验证**：`npm run build` 零错误 ✅

---

## Task 1 — 画布 + 元素渲染 + 选中

**负责文件（不与其他 task 冲突）：**
```
components/Canvas/index.tsx      ✅
components/Canvas/CanvasContext.ts ✅
components/Element/index.tsx     ✅
hooks/useHitTest.ts              ✅
hooks/useSelection.ts            ✅
```

### 画布自适应
- [x] ResizeObserver 监听容器，scale = Math.min(containerW/1920, containerH/1080)
- [x] 画布 1920×1080，transform:scale，transform-origin:top left
- [x] CanvasContext 暴露 scale 和 canvasRect
- [x] 空白区域 mousedown 触发 clearSelected

### 元素渲染
- [x] 5 种形状渲染（rect/circle/triangle/text/image）
- [x] CSS transform 绝对定位
- [x] 选中态 ring-2 ring-blue-500

### 选中逻辑
- [x] useHitTest：旋转元素逆矩阵命中检测
- [x] useSelection：Shift+Click 追加、空白取消
- [x] 组合联动：点击组合成员自动选中全组
- [x] 框选 Lasso：虚线框 + mouseup 框选相交元素

**验证**：`npm run build` 零错误 ✅

---

## Task 2 — 变换 Hooks（移动 / 缩放 / 旋转）

**负责文件（不与其他 task 冲突）：**
```
hooks/useMove.ts                 ✅
hooks/useResize.ts               ✅
hooks/useRotate.ts               ✅
components/Element/ResizeHandles.tsx ✅
components/Element/RotateHandle.tsx  ✅
```

### 移动
- [x] useMove：document mousemove/mouseup，逻辑坐标 delta，批量 updateElements
- [x] 多选整体移动，mouseup pushHistory
- [x] touch 支持

### 缩放
- [x] ResizeHandles：8 个手柄（nw/n/ne/e/se/s/sw/w）
- [x] useResize：有旋转时 toLocalCoord → 本地系计算 → rotatePoint 还原全局坐标
- [x] 最小尺寸保护 20px

### 旋转
- [x] RotateHandle：顶部 -24px 旋转手柄
- [x] useRotate：atan2 角度差，mouseup pushHistory

**验证**：`npm run build` 零错误 ✅

---

## Task 3 — UI Shell（工具栏 + 属性面板 + 整体布局）

**负责文件（不与其他 task 冲突）：**
```
components/Toolbar/index.tsx     ✅
components/AlignBar/index.tsx    ✅
components/StylePanel/index.tsx  ✅
App.tsx                          ✅
```

### 整体布局
- [x] 顶部 Toolbar + 中间画布区 + 右侧 StylePanel（PC）
- [x] 移动端 StylePanel 底部抽屉（fixed bottom-0，rounded-t-xl）
- [x] Tailwind 深色工具栏 bg-gray-900

### Toolbar
- [x] 添加 5 种元素按钮（含随机偏移防堆叠）
- [x] undo/redo 按钮（灰显逻辑）
- [x] 删除按钮
- [x] 组合/取消组合按钮（按选中状态显示）
- [x] 图片上传（FileReader → base64）

### AlignBar
- [x] 6 种对齐按钮（left/right/top/bottom/centerH/centerV）
- [x] 调用 alignElements → updateElements → pushHistory

### StylePanel
- [x] x/y/w/h/rotate 数值输入
- [x] 填充色/描边色/描边宽度/透明度
- [x] 文本元素额外：字号/文字颜色
- [x] 组合标签（已组合）显示

**验证**：`npm run build` 零错误 ✅

---

## Task 4 — 集成接线（Task 1 + 2 + 3 全部完成后，串行）

**负责文件：**
```
components/Element/index.tsx     ✅ 注入 useMove/useResize/useRotate
App.tsx                          ✅ 嵌入真实 Canvas 组件
hooks/useKeyboard.ts             ✅
hooks/usePinch.ts                ✅
```

- [x] Element 组件注入三个变换 hooks，onPointerDown 分发
- [x] App.tsx 嵌入 Canvas，调用 useKeyboard
- [x] useKeyboard：Ctrl+Z/Ctrl+Shift+Z/Delete/Cmd+G/Cmd+Shift+G
- [x] usePinch：双指捏合画布整体缩放（viewScale × baseScale）
- [x] pushHistory 在 mouseup/touchend 统一调用

**验证**：`npm run build` 零错误 ✅ — 40 modules，244KB JS
```

### 整体布局（App.tsx）
- [ ] 三栏布局：顶部 Toolbar + 中间画布区（`<div id="canvas-placeholder" />`）+ 右侧 StylePanel
- [ ] 移动端：StylePanel 改为底部抽屉（`fixed bottom-0`），Toolbar 图标加大（`min-h-[44px]`）
- [ ] Tailwind 深色工具栏（`bg-gray-900 text-white`）+ 浅灰背景（`bg-gray-100`）+ 白色画布

### Toolbar
- [ ] 添加元素按钮（矩形/圆形/三角形/文本/图片），调用 `addElement`
- [ ] undo/redo 按钮，`historyIndex === 0` 时灰显
- [ ] 图片上传：`input[type=file]`，FileReader 转 base64 存入 store
- [ ] 删除按钮（调用 `deleteSelected`）
- [ ] **组合/取消组合按钮**：多选时显示"组合"，已选组合时显示"取消组合"

### AlignBar
- [ ] 6 种对齐按钮（左/右/顶/底/横向居中/纵向居中）
- [ ] 多选或单选时显示，调用 `utils/align.ts` 函数后 `pushHistory()`

### StylePanel
- [ ] x / y / w / h / rotate 数值输入框（`onChange` 实时更新 store）
- [ ] 填充色：`input[type=color]`
- [ ] 描边色 + 描边宽度
- [ ] 文本元素追加：字号 / 文字颜色
- [ ] 无选中时面板灰显或隐藏

**验证**：UI 在浏览器中可渲染，Tailwind 样式正确，PC 三栏 / 移动端底部抽屉均正常

---

## Task 4 — 集成接线（Task 1 + 2 + 3 全部完成后，串行）

**负责文件：**
```
components/Element/index.tsx    ← 注入 useMove / useResize / useRotate
App.tsx                         ← 替换占位，嵌入真实 Canvas 组件
hooks/useKeyboard.ts            ← 全局键盘快捷键
```

- [ ] `components/Element/index.tsx`：在 `onPointerDown` 时根据来源分发到 `useMove` / `useResize` / `useRotate`
- [ ] `App.tsx`：将 `<div id="canvas-placeholder" />` 替换为 `<Canvas>`，传入 scale/canvasRect
- [ ] `hooks/useKeyboard.ts`：
  - `Ctrl/Cmd+Z` → `undo()`
  - `Ctrl/Cmd+Shift+Z` → `redo()`
  - `Delete / Backspace` → `deleteSelected()`
- [ ] 确认 `pushHistory()` 在 `mouseup/touchend` 时统一调用（移动/缩放/旋转各一次）
- [ ] 对齐操作验证：批量修改后只 push 一次历史

**验证**：完整操作链路通畅：添加 → 移动 → 缩放 → 旋转 → 对齐 → undo/redo → 删除

---

## Task 5 — 触控完整适配 + 视觉打磨（串行，最后阶段）

**负责文件：**
```
hooks/usePointerEvents.ts       ← 统一封装 mouse/touch 事件
components/*/                   ← 移动端 UI 适配 + 视觉打磨
README.md
```

### 移动端触控
- [ ] `hooks/usePointerEvents.ts`：统一 `getPointer(e)` 映射，同时绑定 mouse 和 touch 事件
- [ ] 双指 Pinch 缩放画布：`touchstart` 记两指距离，`touchmove` 更新 canvas scale（不影响元素数据）
- [ ] 单指拖拽控制手柄（缩放/旋转），`e.preventDefault()` 防止页面滚动干扰
- [ ] 移动端长按进入多选模式（替代框选，避免与滚动冲突）

### 视觉打磨（加分项）
- [ ] 对齐辅助线：拖拽时与其他元素对齐时显示红色参考线
- [ ] 元素层叠顺序：上移/下移按钮（调整 `elements` 数组顺序）
- [ ] 旋转时显示角度 tooltip
- [ ] 控制手柄 hover 放大效果

### 收尾
- [ ] 完整测试：逐项对照 prd.md Acceptance Criteria
- [ ] `npm run build` 确保零 TS 错误
- [ ] README.md：项目说明、运行方式、功能截图

---

## 文件所有权表（防 agent 冲突）

| 文件 / 目录 | 归属 Task |
|------------|----------|
| `types/` `store/` `utils/` | Task 0 |
| `components/Canvas/` `hooks/useHitTest` `hooks/useSelection` | Task 1 |
| `hooks/useMove` `hooks/useResize` `hooks/useRotate` `components/Element/ResizeHandles` `components/Element/RotateHandle` | Task 2 |
| `components/Toolbar/` `components/AlignBar/` `components/StylePanel/` `App.tsx`（布局骨架） | Task 3 |
| `components/Element/index.tsx`（接线） `hooks/useKeyboard` `App.tsx`（嵌入 Canvas） | Task 4 |
| `hooks/usePointerEvents` + 全局视觉打磨 + README | Task 5 |

---

## 验证命令

```bash
npm run dev          # 开发服务器
npm run build        # 构建检查（确保无 TS 错误）
npm run test         # vitest 单元测试
```

## 风险点 & 回退策略

| 风险 | 应对 |
|------|------|
| 旋转后缩放坐标系复杂，调试时间长 | Task 2 先做无旋转版本，旋转后坐标系转换作为最后步骤加入 |
| 移动端 touch 与框选手势冲突 | 移动端取消 lasso 框选，改用长按进入多选模式 |
| Task 1/2/3 并行后接线复杂 | Task 4 预留完整一天，各 task 交付时附带接口文档注释 |
| 时间不足 | 砍掉对齐辅助线、layer 顺序、Pinch 缩放，保核心 7 项功能 |
