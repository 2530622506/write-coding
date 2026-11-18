# 虚拟滚动面试题集

> 结合字节、阿里、腾讯、美团、滴滴、快手、京东等中大厂真实出题角度，以及本项目（`react-virtual-list-demo`）实现细节整理。题目按主题与难度分层，每题附考察点和答题要点。

---

## 目录

1. [基础原理](#一基础原理)
2. [定高虚拟列表实现](#二定高虚拟列表实现)
3. [滚动性能与白屏优化](#三滚动性能与白屏优化)
4. [不定高虚拟列表实现](#四不定高虚拟列表实现)
5. [Canvas 虚拟列表](#五canvas-虚拟列表)
6. [大数据量与工程选型](#六大数据量与工程选型)
7. [连环追问 / 综合设计](#七连环追问--综合设计)

---

## 一、基础原理

### Q1. 为什么长列表会卡顿？虚拟滚动解决了什么问题？

**难度**：⭐ 基础（字节、阿里、美团均有考察）

**考察点**：浏览器渲染原理、DOM 成本认知

**答题要点**：

- 10,000 条数据，每行含图片/标签/按钮，实际 DOM 节点可达 20w+
- 浏览器要对所有节点做：样式计算 → layout → paint → composite，节点越多越慢
- React 还要对整个组件树做 render + diff + commit
- 用户视口通常只有 7～10 行，剩余全是浪费

虚拟滚动只解决 **DOM 渲染数量** 问题：数据可以有 10,000 条，DOM 始终只有 20～30 行。

---

### Q2. 虚拟列表的核心结构是什么？滚动条为什么能显示正确高度？

**难度**：⭐ 基础

**考察点**：撑高元素 + 偏移定位的基本思路

**答题要点**：

```
滚动容器（overflow: auto，固定高度）
  └─ 撑高元素（height = items.length × itemHeight，不含内容）
       └─ 可见内容区（position: absolute + translateY 偏移）
```

- **撑高元素**：让浏览器生成真实比例的滚动条，自己不渲染内容
- **可见内容区**：只包含当前窗口附近的 20～30 行，用 `transform: translateY(offsetY)` 移到正确位置
- 用户看到的滚动条长度、拖拽位置都是真实的，但 DOM 节点数始终极少

---

### Q3. 虚拟滚动和分页各自适合什么场景？

**难度**：⭐ 基础（面试常见开放题）

**考察点**：方案取舍能力

| 场景 | 推荐方案 |
|------|----------|
| 数据量 < 500 条，交互复杂 | 全量渲染 |
| 数据量 1,000～50,000，需要连续滚动体验 | 虚拟滚动 |
| 数据量 > 50,000，或搜索/排序由后端完成 | 服务端分页 + 虚拟滚动 |
| 移动端信息流、评论 | 无限滚动（游标分页 + 虚拟滚动） |

---

## 二、定高虚拟列表实现

### Q4. 请讲解定高虚拟列表的核心计算公式。

**难度**：⭐⭐ 进阶（字节、腾讯手写题前置问）

**考察点**：索引计算、偏移计算

```ts
const totalHeight = items.length * itemHeight;
const visibleCount = Math.ceil(containerHeight / itemHeight);
const startIndex = Math.max(Math.floor(scrollTop / itemHeight) - overscan, 0);
const endIndex   = Math.min(startIndex + visibleCount + overscan * 2, items.length);
const offsetY    = startIndex * itemHeight;
```

- `startIndex`：当前滚动位置落在哪一行
- `endIndex`：可见行数 + 上下缓冲
- `offsetY`：内容区需要向下偏移多少，让它"看起来"从正确位置开始

渲染：`items.slice(startIndex, endIndex)`，容器用 `transform: translateY(offsetY)` 定位。

---

### Q5. 为什么要用 `transform: translateY` 而不是 `margin-top` 或 `top`？

**难度**：⭐⭐ 进阶（字节有考察）

**考察点**：浏览器渲染分层、GPU 加速

- `margin-top` / `top`（配合 `position: absolute`）会触发 **layout**，浏览器要重新计算文档流或包含块内的位置
- `transform: translateY` 只影响 **composite** 阶段，元素已经在各自图层，位移由 GPU 合成，不触发 layout 和 paint
- 滚动时频繁更新偏移，用 `transform` 能减少主线程工作量

---

### Q6. 定高列表里 `getItemKey` 有什么作用？如果 key 不稳定会怎样？

**难度**：⭐⭐ 进阶

**考察点**：React reconciliation、key 的语义

**答题要点**：

- 虚拟列表每次滚动都会改变 `startIndex`，导致渲染的数据 slice 发生变化
- 如果用 `index` 做 key，React 会认为"第 0 个位置的组件没变"，直接复用旧 DOM，造成内容错误（图片还是旧数据的图片、状态残留）
- 应该用数据的稳定唯一标识（如 `item.id`）做 key，让 React 知道"这行换成新数据了，需要更新内容"，而不是继续复用旧实例

---

### Q7. 手写一个最简定高虚拟列表（React）。

**难度**：⭐⭐⭐ 深度（字节、阿里高频手写题）

```tsx
function VirtualList({ items, itemHeight, height, overscan = 4 }) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight  = items.length * itemHeight;
  const visibleCount = Math.ceil(height / itemHeight);
  const startIndex   = Math.max(Math.floor(scrollTop / itemHeight) - overscan, 0);
  const endIndex     = Math.min(startIndex + visibleCount + overscan * 2, items.length);
  const offsetY      = startIndex * itemHeight;

  return (
    <div
      style={{ height, overflow: "auto", position: "relative" }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* 撑高元素 */}
      <div style={{ height: totalHeight }} />
      {/* 可见内容区 */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0,
                    transform: `translateY(${offsetY}px)` }}>
        {items.slice(startIndex, endIndex).map((item, i) => (
          <div key={item.id} style={{ height: itemHeight }}>
            {item.title}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**追问**：这个版本有什么性能问题？→ 每次 scroll 都 setState，高频更新；缺少 rAF 合帧。

---

## 三、滚动性能与白屏优化

### Q8. 虚拟列表为什么会出现快速滚动白屏？

**难度**：⭐⭐ 进阶（美团、滴滴、快手均有考察）

**考察点**：浏览器渲染管线与 JS 更新时序

白屏的根本原因是**时间差**：

1. 用户快速滚动，浏览器立即更新 `scrollTop`（同步）
2. `scroll` 事件触发，React 计算新的 `startIndex`
3. React 执行：`setState` → `render` → `diff` → `commit`
4. 浏览器：样式计算 → layout → paint → composite
5. 新 DOM 才出现在视口

如果第 2～4 步没赶上滚动位置，旧内容已经移出视口但新内容还没提交，就会短暂空白。

> 结论：DOM 虚拟列表不能在极端快速滚动下给出"绝对不白屏"的理论保证，但工程上可以把概率压很低。

---

### Q9. 有哪些手段可以降低白屏概率？

**难度**：⭐⭐⭐ 深度

| 手段 | 原理 | 代价 |
|------|------|------|
| 增大 `overscan` | 缓冲区更大，新内容进入视口前已预渲染 | DOM 节点变多 |
| 动态 `overscan` | 慢滚时用小值，快滚时临时增大 | 实现稍复杂 |
| 按滚动方向分配缓冲 | 下滑时多渲染下方，减少无效渲染 | 需要记录方向 |
| `requestAnimationFrame` 合帧 | 一帧最多提交一次 state，减少积压 | 轻微延迟 |
| 行组件 `memo` | 避免无关 prop 变化重渲染 | 需要稳定 prop 引用 |
| 图片固定尺寸 + 失败态 | 避免图片加载改变布局 | — |
| 滚动中降级渲染 | 快速滚动时先渲骨架，停止后补完整 | 实现复杂 |

---

### Q10. 为什么用 `requestAnimationFrame` 优化 scroll 事件，而不是 `throttle`？

**难度**：⭐⭐ 进阶（字节有考察）

**考察点**：浏览器帧机制理解

- `throttle(fn, 16)` 是基于 `setTimeout`，定时器精度不准，可能和浏览器帧错位，导致同一帧触发两次或跳帧
- `requestAnimationFrame` 由浏览器统一调度，保证和渲染帧完全对齐，一帧最多执行一次回调

```ts
pendingScrollTopRef.current = e.currentTarget.scrollTop;
if (rafRef.current !== null) return;      // 已有帧在队列，跳过
rafRef.current = requestAnimationFrame(() => {
  rafRef.current = null;
  setScrollTop(pendingScrollTopRef.current); // 只提交最新的一次
});
```

**关键**：`scrollTop` 存在 `ref`，不存在 `state`，这样 scroll 事件里不会触发 React re-render，只有 `rAF` 回调才触发一次。

---

### Q11. `scroll` 事件监听应该用 passive 模式吗？

**难度**：⭐⭐ 进阶

**考察点**：passive event listener

- `scroll` 事件本身已经是被动的，不能在 `scroll` 回调里调用 `preventDefault()`
- 更相关的是 `touchstart` / `touchmove`：如果不加 `{ passive: true }`，浏览器必须等 JS 执行完才知道是否需要阻止默认滚动，会引起滚动卡顿
- React 的 `onScroll` 合成事件不支持 passive，需要用 `useEffect` + `addEventListener('scroll', fn, { passive: true })` 自行挂载，才能在 iOS Safari 获得更流畅的滚动

---

## 四、不定高虚拟列表实现

### Q12. 不定高虚拟列表和定高有什么本质区别？

**难度**：⭐⭐ 进阶（阿里、美团高频考察）

**考察点**：从公式到数据结构的思维跳跃

定高可以用公式直接算：

```ts
startIndex = Math.floor(scrollTop / itemHeight)
```

不定高**不能**这样算，因为每行高度不同，`scrollTop` 落在哪一行，需要知道前面所有行的累积高度。

解决方案：维护一个 **offsets 前缀和数组**：

```ts
offsets[0] = 0
offsets[i+1] = offsets[i] + height(item[i])
```

- `offsets[i]` = 第 i 行的起始 y 坐标
- 给定 `scrollTop`，在 offsets 里**二分查找**，找到 `offsets[i] <= scrollTop < offsets[i+1]` 的 `i`，即为 `startIndex`

---

### Q13. 不定高列表如何获取每行的真实高度？

**难度**：⭐⭐ 进阶

**考察点**：ResizeObserver 使用时机

**流程**：

1. 初始用 `estimatedItemHeight`（如 `148px`）生成初始 offsets，让列表可以先渲染
2. 每行渲染后挂载 `ResizeObserver`，测量真实高度
3. 把真实高度写入 `Map<itemKey, number>`
4. 高度发生变化时，重新用缓存高度 + 预估高度重算 offsets
5. offsets 变化后 React re-render，列表重新定位

```ts
const observer = new ResizeObserver(() => {
  const height = rowEl.getBoundingClientRect().height;
  measuredHeights.set(itemKey, Math.ceil(height));
  // 触发 offsets 重算
});
observer.observe(rowEl);
return () => observer.disconnect();
```

---

### Q14. 不定高列表的 offsets 二分查找怎么写？

**难度**：⭐⭐⭐ 深度（字节有手写考察）

```ts
function findStartIndex(offsets: number[], scrollTop: number): number {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (offsets[mid] <= scrollTop) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}
```

注意 `Math.floor((low + high + 1) / 2)` 是向上取整的写法，避免 `low = mid` 时死循环。

---

### Q15. 不定高列表有哪些常见坑？

**难度**：⭐⭐⭐ 深度

**三大坑**：

1. **预估高度不准 → 滚动条跳动**
   - 初始 offsets 基于预估高度，测量后真实高度偏差大，totalHeight 修正，滚动条长度突变
   - 缓解：预估值取历史实测均值，或让用户保持接近真实值

2. **异步内容改变行高 → 需要重测**
   - 图片加载完成、折叠展开、远程数据补充，都会改变行高
   - `ResizeObserver` 能监听到这些变化，但需要妥善处理触发时机，避免无限循环更新

3. **全量重算 offsets 是 O(n)**
   - 每次高度变化重算整个数组，10,000 条时有感知
   - 优化方向：节流触发、只重算变化行之后的部分、用 **Fenwick Tree（树状数组）** 把单点更新和前缀查询都降到 O(log n)

---

### Q16. 什么是 Fenwick Tree？在虚拟列表里有什么用？

**难度**：⭐⭐⭐⭐ 深度（字节、腾讯偶有考察）

**考察点**：数据结构与算法在工程中的应用

Fenwick Tree（树状数组）支持：
- **单点更新**：修改某行高度，O(log n)
- **前缀查询**：查询前 i 行的总高度，O(log n)

用在不定高虚拟列表时：

```ts
// 更新第 i 行高度（偏量形式）
function update(i: number, delta: number) { ... }

// 查询前 i 行总高度（即 offsets[i]）
function query(i: number): number { ... }

// 二分找 startIndex：满足 query(i) <= scrollTop 的最大 i
```

相比普通 offsets 数组：当 10,000 行中某一行改变高度，不需要重算后续全部 10,000 个值，只需要 O(log n) 次操作。

---

## 五、Canvas 虚拟列表

### Q17. Canvas 虚拟列表为什么快速滚动更稳定？

**难度**：⭐⭐ 进阶（快手、B 站等大视频/流媒体公司有考察）

**DOM 虚拟列表滚动路径**：
`scrollTop 变化` → React setState → render → diff → commit → 样式计算 → layout → paint → composite

**Canvas 滚动路径**：
`scrollTop 变化` → 计算可见行范围 → `clearRect` + `drawImage` / `fillText` → GPU composite

Canvas 没有"新 DOM 还没提交"的问题，每帧只在同一块画布上重画，路径更短，不容易产生时间差白屏。

---

### Q18. Canvas 渲染列表有哪些局限？

**难度**：⭐⭐ 进阶

| 能力 | DOM 虚拟列表 | Canvas 虚拟列表 |
|------|------------|----------------|
| 按钮、链接、表单 | 原生支持 | 需要自行实现命中检测 |
| hover / focus / keyboard | 原生支持 | 需要自行实现 |
| 文本选择、复制 | 原生支持 | 不支持 |
| 无障碍语义（aria） | 原生 | 需要额外 DOM 镜像 |
| CSS 样式与响应式 | 方便 | 坐标和尺寸全部手写 |
| 开发维护成本 | 较低 | 较高 |

**适合 Canvas 的场景**：行情 / 日志 / 热力图 / 大规模弱交互展示列表。  
**不适合**：复杂业务表单、需要键盘/焦点/选中的列表。

---

### Q19. 什么是离屏 Canvas？为什么能提升性能？

**难度**：⭐⭐⭐ 深度

**核心价值**：缓存，不是"离屏"本身。

把每行复杂内容（圆角图片 + 标签 pill + 按钮底图）预先画到一个独立 canvas：

```ts
const cacheCanvas = new OffscreenCanvas(rowWidth, rowHeight);
drawProductRow(cacheCanvas.getContext('2d'), item);
// 滚动时主 canvas 只做：
ctx.drawImage(cacheCanvas, 0, rowY);  // 贴图，极快
```

节省了每帧的：路径计算、clip、measureText、drawImage 解码重复开销。

**代价**：内存占用增加；宽度/主题/数据变化时需要缓存失效。  
**合理策略**：LRU 缓存最近访问的 N 行，或只缓存圆角图片、重复标签等小件。

---

### Q20. OffscreenCanvas + Worker 是什么方案？什么时候用？

**难度**：⭐⭐⭐⭐ 深度

把 Canvas 控制权转移给 Worker，主线程只负责滚动事件和交互：

```ts
// 主线程
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: offscreen }, [offscreen]);

// Worker
self.onmessage = ({ data }) => {
  const ctx = data.canvas.getContext('2d');
  // 在 Worker 里绘制，不阻塞主线程
};
```

**适合场景**：绘制逻辑复杂（图表、热力图、粒子效果），单帧计算量接近 16ms 警戒线，主线程同时有较重的交互逻辑。  
**代价**：图片加载、字体、交互事件需要额外处理；Worker 通信有序列化成本；兼容性需要评估。

---

## 六、大数据量与工程选型

### Q21. 数据量从 1 万变成 100 万，怎么处理？

**难度**：⭐⭐⭐ 深度（系统设计题，字节、阿里、美团均有考察）

**核心结论**：虚拟滚动只解决 DOM 渲染数量，不解决数据本身的内存和计算问题。

**分层策略**：

1. **后端分页 / 游标加载**：前端只持有当前窗口附近的数据，不一次性请求全量
2. **服务端搜索、排序、筛选**：不在前端做大规模 filter / sort
3. **前端数据窗口缓存**：用 `Map<pageIndex, Item[]>` 缓存已加载的页，滚动到某区域时懒加载对应页
4. **Web Worker 处理大规模前端计算**：如果确实需要前端 filter/sort，放到 Worker 避免阻塞主线程
5. 结合成熟库（`@tanstack/react-virtual`）处理边界细节

---

### Q22. `@tanstack/react-virtual` 和自己实现有什么区别？什么时候选库？

**难度**：⭐⭐ 进阶

**库的优势**：
- 已处理滚动同步、边界索引、动态测量、`ResizeObserver` 集成、SSR、水平/网格虚拟化
- API 稳定，社区 issue 覆盖了很多边界场景
- 维护成本低

**自己实现的场景**：
- 需要深度定制（Canvas 渲染、自定义测量策略）
- 包体积敏感
- 学习目的

**选型原则**：生产项目优先用成熟库；面试和学习项目手写更能展示理解深度。

---

### Q23. 虚拟列表如何与搜索过滤结合？

**难度**：⭐⭐ 进阶

**要点**：

1. 搜索过滤后 `filteredItems` 是新数组，虚拟列表直接接收新的 `items` prop
2. 过滤后 `startIndex` 可能超出新数组范围，需要在过滤时把 `scrollTop` 重置到 0
3. 如果过滤是异步（服务端搜索），需要处理 loading 态和防抖（`debounce`）避免过频请求
4. 本项目使用 `useMemo(() => filterItems(items, query), [items, query])` 在前端过滤，同时用 `AbortController` 管理接口请求

---

### Q24. 虚拟列表如何验证确实生效？如何测量性能？

**难度**：⭐⭐ 进阶

**验证清单**：

- Chrome DevTools → Elements → 确认 DOM 只有 20～30 行，而非 10,000 行
- 滚动到底部（scrollTop 跳到接近 `totalHeight`），内容是否正确
- Performance 面板录制快速滚动，查看 Long Task、Layout Shift
- Lighthouse → Performance 分数（首屏渲染时间、TBT）
- Canvas 版：查看 `drawMs`（本帧绘制耗时）、DOM 节点数
- 移动端：测试快速拖动是否出现白屏，注意 iOS Safari 惯性滚动行为

---

## 七、连环追问 / 综合设计

### Q25. 如何实现一个支持分组吸顶的虚拟列表？

**难度**：⭐⭐⭐⭐ 深度（字节、阿里有考察）

**思路**：

1. 把"分组头"和"普通行"都放进统一的 `items` 数组，每个 item 带 `type: "group-header" | "item"`
2. 分组头和普通行可以有不同高度（不定高方案处理）
3. **吸顶**：额外维护一个"当前 `scrollTop` 下最近的分组头 index"，把对应的分组头复制一份用 `position: sticky` 渲染在容器顶部
4. 滚动时更新吸顶的分组头内容
5. 注意吸顶元素被下一个分组头"顶走"的动画处理

---

### Q26. 虚拟列表如何做键盘导航和焦点管理？

**难度**：⭐⭐⭐ 深度（无障碍专项考察）

**要点**：

- 滚动容器设 `role="listbox"` 或 `role="grid"`，每行设 `role="option"` 或 `role="row"`
- 维护 `focusedIndex` state，键盘 `↑↓` 更新 `focusedIndex`
- 当 `focusedIndex` 超出当前渲染范围时，先 `scrollTop` 到对应位置，再等 React commit 后把焦点移到目标 DOM
- `aria-activedescendant` 指向当前焦点行的 id，辅助技术能正确播报
- 本项目已为每行提供 `aria-posinset` 和 `aria-setsize`，图标按钮有 `aria-label`

---

### Q27. 虚拟列表如何处理图片懒加载，避免滚动时图片一直重新加载？

**难度**：⭐⭐⭐ 深度

**问题根源**：虚拟列表每次滚动都可能销毁并重建行 DOM，图片节点被销毁后下次重建又要重新发 HTTP 请求。

**解决手段**：

1. **浏览器图片缓存**：同一 URL 二次请求命中 disk cache，实际上不会重新网络加载
2. **CDN 缩略图**：确保图片 URL 稳定，不带随机参数
3. **`loading="lazy"`**：已离开视口的图片不加载（本项目已用）
4. **预加载**：即将进入视口的图片提前 `new Image().src = url`（配合 overscan 范围）
5. **行组件 `memo`**：当 `item` 引用未变时，行不重渲染，图片 DOM 节点不销毁

---

### Q28. 虚拟列表如何处理容器高度变化（窗口 resize）？

**难度**：⭐⭐⭐ 深度

**要点**：

- 容器高度变化时，`visibleCount` 变化，需要重新计算 `endIndex`
- 使用 `ResizeObserver` 监听容器元素尺寸变化，更新 `height` state
- 不定高列表：容器宽度变化时，每行的文本换行可能改变高度，需要重新测量所有已测量的行
- 注意 `ResizeObserver` 的防抖（`resize` 事件可能触发非常频繁）

---

### Q29. 一道综合设计题：设计一个支持 100 万条日志的前端展示系统。

**难度**：⭐⭐⭐⭐ 深度（系统设计，字节基建方向有考察）

**核心决策点**：

| 层面 | 方案 |
|------|------|
| 数据获取 | 游标分页，每页 200 条，滚动到末尾时追加加载 |
| 前端数据结构 | `Map<pageIndex, LogEntry[]>`，LRU 淘汰远离视口的页 |
| 渲染方案 | 定高虚拟列表（日志行高固定）或 Canvas（弱交互展示） |
| 搜索过滤 | 服务端全文检索，前端只做当前页高亮 |
| 大规模 JSON 解析 | Web Worker 解析，解析完发给主线程 |
| 时间范围跳转 | 把时间戳区间转换为后端查询，不在前端扫描 |
| 滚动稳定性 | overscan + rAF 合帧 + Canvas 可选 |

---

### Q30. 如果让你 code review 一个虚拟列表实现，你会关注哪些点？

**难度**：⭐⭐⭐ 深度（高级前端工程师考察）

**Review 清单**：

- [ ] `key` 是否用稳定唯一标识（不是 `index`）
- [ ] scroll 事件是否节流 / rAF 合帧
- [ ] 行组件是否 `memo`，`renderItem` / `getItemKey` 是否 `useCallback` 稳定引用
- [ ] 总高度计算是否正确（包含边距/gap 的情况）
- [ ] `overscan` 边界处理（`Math.max(0, ...)` / `Math.min(items.length, ...)`）
- [ ] 不定高：`ResizeObserver` 是否 `disconnect`（避免内存泄漏）
- [ ] 图片是否固定宽高（避免 layout shift）
- [ ] 是否有 `aria-posinset` / `aria-setsize` 等无障碍属性
- [ ] 容器 resize 时是否更新 `height`

---

## 附录：常见追问链

面试官通常按如下路径深挖，提前准备：

```
"你做过虚拟列表吗？"
  └─ 定高怎么算索引？
       └─ overscan 是什么，怎么决定大小？
            └─ 快速滚动会白屏吗？为什么？
                 └─ rAF 合帧是什么原理？
                      └─ 和 throttle 有什么区别？
                           └─ 不定高怎么做？
                                └─ 二分查找怎么写？
                                     └─ offsets 重算是 O(n)，有更好的数据结构吗？
                                          └─ Fenwick Tree 怎么用？
```

---

> 文档基于 `react-virtual-list-demo` 项目与 `虚拟滚动.md` 整理，结合字节、阿里、腾讯、美团、滴滴、快手等公司前端面试真实考察角度编写。
