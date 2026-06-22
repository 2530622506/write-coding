# React 定高虚拟滚动列表实现思路

## 目标

这个示例实现了一个定高虚拟滚动列表组件 `FixedSizeVirtualList`。它适合每一行高度固定、数据量较大、列表项内容较复杂的场景，例如包含商品标题、商品图片、价格、标签、状态和操作按钮的电商列表。

## 模拟接口

商品数据通过 `fetchProductList` 模拟接口返回，而不是在页面中同步生成。

```ts
fetchProductList({ count: 10000, delayMs: 650, signal });
```

这个接口会模拟网络延迟，并返回：

```ts
type ProductListResponse = {
  items: FeedItem[];
  total: number;
  latencyMs: number;
};
```

页面使用 `AbortController` 在组件卸载时取消请求，并提供 loading、error 和 retry 状态。后续如果要替换成真实后端接口，只需要把 `fetchProductList` 内部的 `setTimeout` 替换成 `fetch('/api/products')`。

## 核心思路

浏览器不直接渲染全部 10,000 条数据，而是只渲染当前滚动窗口附近的一小段数据。

实现分为 4 步：

1. 计算总高度：`totalHeight = items.length * itemHeight`。这个高度用于撑开滚动条，让用户感知完整列表长度。
2. 监听滚动位置：同步记录最新 `scrollTop`，并用 `requestAnimationFrame` 合并滚动更新，每帧最多提交一次 React state。
3. 加入缓冲区：使用 `overscan` 在可视区域上下多渲染几行，降低快速滚动时的空白感。
4. 偏移可见窗口：真实渲染的节点放在绝对定位容器中，通过 `transform: translateY(startIndex * itemHeight)` 移动到正确位置。

## 关键计算

```ts
const totalHeight = items.length * itemHeight;
const visibleCount = Math.ceil(height / itemHeight);
const startIndex = Math.max(Math.floor(scrollTop / itemHeight) - overscan, 0);
const endIndex = Math.min(startIndex + visibleCount + overscan * 2, items.length);
const offsetY = startIndex * itemHeight;
```

`items.slice(startIndex, endIndex)` 得到当前需要渲染的数据。列表滚动时，React 只更新这一段 DOM，而不是同时维护全部列表项。

## 滚动更新优化

滚动事件触发频率可能高于 React 提交渲染的频率。如果每个 `scroll` 事件都立刻调用 `setState`，快速滑动时容易积压更新，导致可视窗口中的 DOM 提交滞后，从而出现短暂白屏。

组件使用 `requestAnimationFrame` 做合帧：

```ts
pendingScrollTopRef.current = event.currentTarget.scrollTop;

if (animationFrameRef.current !== null) {
  return;
}

animationFrameRef.current = window.requestAnimationFrame(() => {
  animationFrameRef.current = null;
  setScrollTop(pendingScrollTopRef.current);
});
```

这样在一帧内多次触发滚动事件时，只会提交最新的一次滚动位置，减少无效渲染。

## 快速滚动白屏的原因

定高虚拟列表出现短暂白屏，通常不是因为总高度或索引计算错误，而是因为滚动位置已经被浏览器推进到很远的位置，但 React 还没有来得及提交新的可视窗口 DOM。

常见触发链路是：

1. 用户快速滚动，浏览器立即更新 `scrollTop`。
2. 组件根据 `scrollTop` 计算新的 `startIndex` 和 `endIndex`。
3. React 需要执行 state 更新、render、diff 和 DOM patch。
4. 如果提交滞后，旧 DOM 还停留在旧偏移位置，新视口区域中会短暂没有可见内容。

这类问题可以通过增加缓冲、减少滚动期间的 React 工作量、提前准备内容来缓解。

## 为什么 Canvas 快速滚动更不容易白屏

DOM 虚拟列表和 Canvas 虚拟列表在滚动后把内容显示到正确位置的路径不同。

DOM 虚拟列表的链路通常是：

1. 浏览器先把滚动条位置更新到新的 `scrollTop`。
2. React 收到 `scroll` 事件，计算新的 `startIndex`。
3. React 重新 render 可见行。
4. React diff。
5. React 提交 DOM patch。
6. 浏览器重新计算样式。
7. 浏览器执行 layout。
8. 浏览器执行 paint 和 composite。
9. 新内容出现在视口。

如果第 3 到第 8 步没有赶上滚动位置变化，视口已经滚到新区域，但新一批 DOM 行还没有提交，旧 DOM 又停留在旧偏移位置，就会出现短暂白屏。

Canvas 版本的链路更短：

1. 浏览器更新 `scrollTop`。
2. 根据 `scrollTop` 计算可见行范围。
3. 清空同一个 canvas。
4. 直接把当前可见内容画到同一个 canvas 上。

核心绘制路径类似：

```ts
ctx.clearRect(0, 0, width, height);
ctx.drawImage(image, x, y, w, h);
ctx.fillText(title, x, y);
```

Canvas 滚动区基本只有：

```html
<div class="canvas-list__spacer">
  <canvas />
</div>
```

它不需要等新一批 DOM 行创建出来，也不需要维护每一行里的图片、标题、标签、价格、按钮、SVG 等 DOM 子树。快速滚动时，只要下一帧把同一块画布重画成新位置内容即可。

Canvas 避免了 DOM 虚拟列表里的这些成本：

- 创建、销毁或移动多行 DOM。
- 每行大量子节点的样式计算。
- 图片、标签、按钮、SVG 的布局。
- React diff 和提交。
- `transform` 偏移和滚动位置之间的提交滞后。

所以在“固定行高、规则布局、弱交互、可视行数有限”的场景下，Canvas 快速滚动更容易稳定，不容易出现 DOM 虚拟列表那种等待提交造成的空白。

但 Canvas 也不是绝对不会白屏。如果出现下面情况，它同样可能空白或卡顿：

- 单帧绘制逻辑超过 16ms。
- 图片还没有加载或解码完成。
- 主线程被其他 JavaScript 阻塞。
- 每帧绘制内容太复杂。
- canvas 尺寸太大，`devicePixelRatio` 太高。
- 每帧仍然触发大量 React state 更新。

当前示例里 Canvas 更稳定，是因为每帧只绘制约 23 行，布局规则固定，滚动区核心 DOM 节点很少；而 DOM 版本每行都有图片、文本、标签、价格、按钮和 SVG，快速滚动时 React 和浏览器需要完成的工作更多。

## DOM 虚拟滚动是否一定会白屏

DOM 虚拟滚动不是必然白屏，但它很难在所有极端快速滚动场景下 100% 保证不白屏。

原因是 DOM 虚拟滚动天然存在一个时间差：

1. 浏览器先更新 `scrollTop`。
2. JavaScript 根据 `scrollTop` 计算新的可视窗口。
3. React 执行 render、diff 和 commit。
4. 浏览器重新计算样式、layout 和 paint。
5. 新 DOM 出现在视口。

如果用户滚动速度非常快，或者主线程刚好被其他任务阻塞，新 DOM 的提交速度就可能追不上滚动位置，从而出现短暂空白。

所以更准确的结论是：

```text
DOM 虚拟滚动很难绝对保证极端快速滚动下永不白屏，但可以通过工程手段把白屏概率和持续时间压得很低。
```

是否会白屏，取决于多个因素：

- 每一行 DOM 的复杂度。
- `overscan` 大小。
- React 更新是否合帧。
- 图片是否提前加载或解码。
- 主线程是否被长任务阻塞。
- 设备性能。
- 滚动容器高度和行高。
- 是否按滚动方向多渲染。
- 是否使用成熟库做更细的调度。

可以降低白屏概率的手段：

1. 增大 `overscan`。
2. 根据滚动速度动态增加 `overscan`。
3. 按滚动方向多渲染前方内容。
4. 用 `requestAnimationFrame` 合并 scroll 更新。
5. 行组件 `memo`，减少 render 成本。
6. 图片预加载、固定尺寸和失败态。
7. 滚动中先渲染轻量占位，停止后补完整内容。
8. 使用 `@tanstack/react-virtual` 或 `react-window` 等成熟库。

如果目标是“无论用户怎么快速拖滚动条，都绝对不白屏”，DOM 虚拟滚动很难给出理论保证。因为只要滚动位置变化速度超过渲染提交速度，就可能短暂追不上。

如果目标是“正常快速滚动下用户基本感知不到白屏”，DOM 虚拟滚动完全可以做到，前提是行内容足够轻、缓冲合理、图片处理好、滚动更新成本低。

Canvas 更不容易出现 DOM 虚拟滚动那种白屏，是因为它没有“新 DOM 还没提交”的问题；它只是在同一块画布上重画当前帧。但 Canvas 也不是绝对不会空白，如果绘制太重、图片没解码、主线程卡住，也会空白或卡顿。

一句话总结：

```text
DOM 虚拟滚动不是必然白屏，但在极端快速滚动下无法给出绝对不白屏的理论保证；工程上通常通过 overscan、合帧、轻量行、预加载和成熟库把它压到用户很难感知。
```

## DOM 虚拟滚动优化手段

### 1. 增大 `overscan`

`overscan` 表示在可视区域外额外渲染的行数。缓冲越大，快速滚动时越不容易看到空白。

```tsx
<FixedSizeVirtualList
  itemHeight={92}
  height={560}
  overscan={24}
/>
```

优点是实现简单，效果直接。代价是 DOM 节点变多，每次滚动需要渲染更多行。

### 2. 动态 `overscan`

慢速滚动时使用较小缓冲，快速滚动时临时增加缓冲。

```ts
const velocity = Math.abs(nextScrollTop - lastScrollTop) / deltaTime;
const dynamicOverscan = velocity > 3 ? 40 : 12;
```

这种方式比固定大缓冲更平衡：慢滚时保持轻量，快滚时提高容错。

### 3. 按滚动方向分配缓冲

用户向下滚动时，下方多渲染，上方少渲染；向上滚动时反过来。

```ts
const before = direction === 'up' ? 24 : 6;
const after = direction === 'down' ? 24 : 6;
```

这样同样的缓冲行数可以覆盖更可能进入视口的方向，减少无效渲染。

### 4. 使用 `requestAnimationFrame` 合并滚动更新

当前组件已经使用这个方案。核心目标是：一帧内无论触发多少次 `scroll`，只提交最新一次 `scrollTop`。

```ts
pendingScrollTopRef.current = event.currentTarget.scrollTop;

if (animationFrameRef.current !== null) {
  return;
}

animationFrameRef.current = window.requestAnimationFrame(() => {
  animationFrameRef.current = null;
  setScrollTop(pendingScrollTopRef.current);
});
```

这可以减少 React state 更新次数，降低滚动期间的提交压力。

### 5. 拆分并 memo 行组件

复杂列表项应该拆成独立组件，并使用 `memo` 避免无意义重渲染。

```tsx
const ProductRow = memo(function ProductRow({ item }: { item: FeedItem }) {
  return <article className="feed-row">...</article>;
});
```

如果父组件频繁更新，还应使用 `useCallback` 固定 `renderItem` 和 `getItemKey` 的引用。

### 6. 图片优化

商品列表里的图片会影响滚动体验，尤其是快速滚动时大量图片进入视口。

可选方案：

- 使用 CDN 缩略图，不加载原图。
- 固定 `width` 和 `height`，避免布局抖动。
- 当前视口附近图片提前预加载。
- 远离视口的图片继续使用 `loading="lazy"`。
- 为图片区域提供固定占位背景或 skeleton。
- 图片加载失败时显示稳定 fallback。

### 7. 服务端分页、搜索和排序

虚拟滚动只减少 DOM 数量，不减少前端持有的数据量。如果数据达到几十万条，不应该一次性把全部数据放进浏览器内存。

更合理的策略是：

- 后端分页或游标分页。
- 只缓存当前页附近的数据。
- 搜索、排序、筛选交给后端。
- 已加载页用 `Map<pageIndex, Product[]>` 缓存。

```ts
const pageCache = new Map<number, FeedItem[]>();
```

### 8. Web Worker 处理重计算

如果必须在前端做大规模筛选、排序、分组，可以放到 Web Worker，避免阻塞主线程滚动。

适合放到 Worker 的任务：

- 大数组 filter。
- 多字段 sort。
- 分组聚合。
- 文本索引匹配。

### 9. 使用成熟虚拟滚动库

如果业务要支持更多边界场景，可以考虑：

- `@tanstack/react-virtual`
- `react-window`

成熟库通常已经处理了滚动同步、边界索引、动态测量、滚动容器变化等细节。

## 大数据量下的整体策略

当数据规模继续变大时，优化重点要从“少渲染 DOM”扩展到“少创建数据、少计算、少下载、少重渲染”。

建议优先级：

1. 后端分页或无限加载，避免一次性持有全部数据。
2. 服务端搜索、排序和筛选。
3. 行组件 `memo`，减少复杂行重渲染。
4. 动态 `overscan` 和方向感知缓冲。
5. 图片缩略图、预加载和失败态。
6. 大规模前端计算迁移到 Worker。
7. 复杂需求使用成熟虚拟滚动库。

## Canvas 对比路由

工程还提供了 `/canvas` 路由，用同一批商品数据绘制 Canvas 版本虚拟列表。

Canvas 版本的结构是：

```tsx
<div className="canvas-list">
  <div style={{ height: totalHeight }}>
    <canvas />
  </div>
</div>
```

滚动容器仍由浏览器原生处理，`canvas` 固定在可视区域内。滚动时根据 `scrollTop` 算出可见范围，然后用 `CanvasRenderingContext2D` 绘制图片、标题、标签、价格和模拟操作按钮。

这个版本用于观察渲染成本差异：

- 滚动区核心 DOM 节点只有 `canvas` 和撑高元素。
- 不创建每一行的 DOM 节点。
- 页面侧边栏会显示本帧绘制行数、最近绘制耗时、滚动区 DOM 节点数量和当前 `scrollTop`。

需要注意，Canvas 绘制出来的按钮不是原生按钮。点击命中、焦点、键盘导航、文本选择和无障碍语义都需要额外实现，所以它更适合做大规模弱交互展示，而不是直接替代复杂业务列表。

## Canvas 为什么可能更快

Canvas 版本可能比 DOM 虚拟列表更快，核心原因是它绕开了大量 DOM 节点和浏览器布局流程。

DOM 虚拟列表虽然只渲染二十多行，但每行仍然包含：

- `article`
- `img`
- `h2`
- `p`
- 多个 `span`
- 价格、店铺、时间
- 多个 `button`
- 按钮里的 `svg`

滚动时浏览器和 React 仍需要处理：

- React state 更新。
- 组件 render。
- diff。
- DOM patch。
- CSS 样式计算。
- layout。
- paint。
- composite。

Canvas 通常只有一个核心节点：

```html
<canvas></canvas>
```

滚动时只需要根据可见范围重新绘制位图：

```ts
ctx.clearRect(0, 0, width, height);
ctx.drawImage(image, x, y, w, h);
ctx.fillText(title, x, y);
```

它减少了：

- 大量 DOM 节点管理。
- 浏览器布局计算。
- React diff 成本。
- CSS 选择器和样式重算成本。
- 复杂 DOM 交互状态维护。

更准确地说，Canvas 在“超大量、规则布局、弱交互、主要展示”的场景下更容易获得性能优势。

## Canvas 性能优化方案

### 1. 减少每帧绘制内容

当前 Canvas 版本每次滚动都会完整清空并重画可视区域。进一步优化可以做“脏区域绘制”：当滚动距离小于一行时，复用上一帧位图，只补顶部或底部新增区域。

这种方式实现复杂，但在超高频滚动场景下收益明显。

### 2. 缓存文本测量和截断结果

`ctx.measureText` 有成本，尤其是 `ellipsize()` 会多次测量。

可以按文本和最大宽度缓存结果：

```ts
const textCache = new Map<string, string>();
const key = `${text}:${maxWidth}`;
```

商品标题、摘要、标签内容通常比较稳定，适合缓存。

### 3. 预计算布局

不要每帧重复计算：

- 标题截断文本。
- 摘要截断文本。
- 标签宽度。
- 状态 pill 宽度。
- 价格位置。
- 按钮 hit area。

可以在数据准备阶段或容器宽度变化时预计算：

```ts
type RowLayout = {
  titleText: string;
  summaryText: string;
  tagRects: Rect[];
  actionRects: Rect[];
};
```

滚动帧只负责按 `scrollTop` 贴到对应位置。

### 4. 限制绘制 DPR

高清屏下 `devicePixelRatio = 2` 时，canvas 实际像素数量是 CSS 尺寸的 4 倍。可以提供性能模式，限制绘制 DPR。

```ts
const renderDpr = Math.min(window.devicePixelRatio, 1.5);
```

这会略微牺牲清晰度，但能减少像素填充成本。

### 5. 图片提前解码

图片绘制前可以提前加载和解码，避免滚动时触发同步解码。

```ts
const image = new Image();
image.src = item.imageUrl;
await image.decode();
```

实际实现时需要处理浏览器兼容和 decode 失败回退。

### 6. 节流 React 指标更新

Canvas 绘制本身可以很快，但如果每帧都 `setStats` 更新 React 指标面板，React 仍然会参与滚动过程。

可以节流指标更新：

```ts
if (now - lastStatsUpdate > 200) {
  setStats(nextStats);
}
```

性能测试时尤其应该避免统计面板干扰滚动本身。

### 7. 滚动中降级绘制

快速滚动时先绘制轻量版本：

- 不画图片，只画占位块。
- 不画按钮边框。
- 不画标签。
- 只画标题和价格。

滚动停止 100ms 后再补完整细节。这是很多高密度可视化列表会采用的策略。

### 8. OffscreenCanvas + Worker

如果绘制逻辑继续变复杂，可以把 Canvas 控制权转移到 Worker。

```ts
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: offscreen }, [offscreen]);
```

这样主线程主要处理滚动和交互，Worker 负责绘制。代价是实现成本更高，交互、图片加载、字体、兼容性都要单独评估。

## 离屏 Canvas 为什么会快

离屏 Canvas 不是因为“离线”本身更快，而是因为它把重复绘制提前算好，让滚动时只拷贝已经画好的像素。

常见形式有两种：

```ts
const cacheCanvas = document.createElement('canvas');
```

或者：

```ts
const offscreen = new OffscreenCanvas(width, height);
```

假设每一帧都重复绘制圆角图片、标签和按钮：

```ts
roundedRect(ctx, x, y, w, h, r);
ctx.fill();
ctx.clip();
ctx.drawImage(image, x, y, w, h);
ctx.measureText(tag);
ctx.fillText(tag, x, y);
```

可以提前画到离屏 Canvas：

```ts
const cacheCanvas = new OffscreenCanvas(rowWidth, rowHeight);
const cacheCtx = cacheCanvas.getContext('2d');

drawProductRow(cacheCtx, item);
```

滚动时只做：

```ts
ctx.drawImage(cacheCanvas, 0, rowY);
```

它的收益来自：

- 减少重复计算。
- 减少 Canvas 状态切换。
- 避免重复圆角路径和裁剪。
- 图片可以提前裁成圆角结果。
- 主 Canvas 滚动路径更简单。

但离屏缓存不是免费优化：

- 会增加内存占用。
- 如果缓存全部 10,000 行，内存可能很大。
- 宽度变化、主题变化、图片加载完成、数据更新时都要处理缓存失效。
- `OffscreenCanvas` 兼容性和 Worker 通信复杂度更高。

更实际的缓存策略是分层缓存：

1. 缓存圆角图片结果。
2. 缓存重复标签 pill。
3. 缓存按钮底图。
4. 只用 LRU 缓存最近访问的若干行，而不是缓存全部行。

```ts
const rowCache = new Map<number, HTMLCanvasElement>();

if (!rowCache.has(item.id)) {
  rowCache.set(item.id, renderRowToCanvas(item));
}

ctx.drawImage(rowCache.get(item.id)!, 0, rowY);
```

一句话总结：离屏 Canvas 快，是因为它把“复杂绘制”变成了“贴一张已经画好的图”。

## DOM 虚拟列表与 Canvas 的选择

| 维度 | DOM 虚拟列表 | Canvas 虚拟列表 |
| --- | --- | --- |
| 普通按钮、链接、表单 | 原生支持 | 需要自己实现命中检测 |
| 文本选择、复制、右键菜单 | 原生支持 | 需要额外实现 |
| 无障碍语义 | 原生更好做 | 需要额外 DOM 镜像或说明 |
| 超大规模弱交互展示 | 有 DOM 上限 | 更有优势 |
| 开发维护成本 | 较低 | 较高 |
| 样式和响应式 | CSS 更方便 | 坐标和绘制逻辑手写 |
| 极限滚动性能 | 好 | 更容易做到更高上限 |

当前商品列表包含图片、标签、状态和多个操作按钮。如果是业务落地，优先使用 DOM 虚拟列表；如果是百万级弱交互展示、监控日志、行情列表、热力图等场景，可以考虑 Canvas。

## 组件 API

```ts
type FixedSizeVirtualListProps<T> = {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  getItemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
};
```

- `items`：完整数据源。
- `itemHeight`：每一行的固定高度。
- `height`：滚动容器高度。
- `overscan`：额外渲染的缓冲行数。
- `getItemKey`：生成稳定 key，避免滚动时无意义重建节点。
- `renderItem`：把数据渲染成具体行内容。

## 为什么要求定高

定高列表可以用简单数学公式从 `scrollTop` 直接推导索引，计算成本稳定，不需要测量每一项真实高度。可变高度列表需要维护高度缓存和前缀和，复杂度更高，也更容易出现滚动跳动。

## 不定高虚拟滚动入口

工程提供 `/variable` 路由，用于演示不定高虚拟滚动。

不定高列表的每一行高度由真实内容决定。示例中有些商品行只有一段详情，有些商品行包含多段详情和更多标签，因此实际高度会在不同商品之间变化。

不定高虚拟滚动不能直接使用：

```ts
const startIndex = Math.floor(scrollTop / itemHeight);
```

因为每一行高度不同，`scrollTop` 和索引之间不再是固定倍数关系。

当前实现使用 `VariableSizeVirtualList`，核心策略是：

1. 先给每一行一个预估高度 `estimatedItemHeight`。
2. 用预估高度生成初始 offsets 前缀和。
3. 行渲染后使用 `ResizeObserver` 测量真实高度。
4. 把真实高度缓存到 `Map<itemKey, height>`。
5. 高度变化后重新计算 offsets。
6. 根据 `scrollTop` 在 offsets 中二分查找可视起点。
7. 只渲染可视范围加 `overscan` 的行。

核心计算结构：

```ts
const offsets = [0];

for (let index = 0; index < items.length; index += 1) {
  const itemKey = getItemKey(items[index], index);
  const measuredHeight = measuredHeights.get(itemKey);
  offsets[index + 1] = offsets[index] + (measuredHeight ?? estimatedItemHeight);
}
```

查找可视起点时使用二分：

```ts
function findStartIndex(offsets: number[], scrollTop: number) {
  let low = 0;
  let high = offsets.length - 1;

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

行定位方式也和定高版本不同。定高版本可以用一个窗口整体 `translateY(offsetY)`；不定高版本需要每一行按照自己的 `offsets[index]` 定位：

```tsx
<div
  className="variable-list__row"
  style={{ transform: `translateY(${offsets[index]}px)` }}
>
  {renderItem(item, index)}
</div>
```

测量逻辑：

```ts
const observer = new ResizeObserver(() => {
  const height = row.getBoundingClientRect().height;
  measuredHeights.set(itemKey, Math.ceil(height));
});

observer.observe(row);
```

不定高虚拟滚动的难点：

- 初始预估高度不准时，滚动条总高度会在测量后修正。
- 如果当前视口上方的行高度被修正，可能造成轻微滚动跳动。
- 行内容异步变化时，例如图片加载、展开折叠、远程数据补齐，都需要重新测量。
- 大数据下每次重新构建完整 offsets 是 `O(n)`，极大数据量可以考虑 Fenwick Tree 或分块前缀和优化。

适用场景：

- 评论列表。
- 商品卡片瀑布式详情。
- 搜索结果摘要长度不同。
- 消息流、动态流。
- 日志详情可展开的列表。

如果业务可以接受固定行高，优先使用定高方案；只有内容高度确实不可控时，再使用不定高方案。

## 示例内容结构

示例中的商品列表项包含：

- 在线商品图片，使用 `loading="lazy"` 延迟加载。
- 商品标题和卖点摘要。
- 商品价格。
- 多个标签。
- 状态标识。
- 店铺名称和更新时间。
- 4 个图标操作按钮，并提供 `aria-label`。

## 可访问性与体验处理

- 滚动容器设置 `role="list"`，每行设置 `role="listitem"`。
- 每个虚拟行提供 `aria-posinset` 和 `aria-setsize`，让辅助技术理解当前位置和总量。
- 图标按钮使用明确的 `aria-label`。
- 图片提供 `alt`。
- 交互控件最小尺寸为 `44px`。
- 使用 `prefers-reduced-motion` 关闭不必要动画。

## 适用与限制

适用：

- 数据量大于几十条。
- 每行高度固定。
- 列表项内容较复杂，直接全量渲染会造成卡顿。

限制：

- 不适合动态高度内容。
- 不包含分组吸顶、键盘范围选择等高级交互。
- 服务端分页或远程搜索需要在外层组合实现。

## 运行方式

```bash
npm install
npm run dev
```

## 简历中可以怎么描述

如果把这个虚拟滚动项目写进简历，不建议只写“实现了虚拟滚动列表”。更好的写法是把场景、规模、技术方案和效果说清楚。

### 简历 bullet 示例

偏前端性能优化：

```text
- 设计并实现商品列表虚拟滚动方案，支持 10,000+ 条复杂商品数据渲染，列表项包含图片、标签、价格和操作按钮，将页面实际渲染 DOM 控制在可视区域附近，降低长列表首屏和滚动渲染压力。
```

突出技术细节：

```text
- 基于 scrollTop、固定行高、总高度占位和 translateY 偏移实现定高虚拟列表，并通过 requestAnimationFrame 合并 scroll 更新，减少快速滚动时的状态更新和白屏概率。
```

突出不定高能力：

```text
- 扩展实现不定高虚拟滚动，使用预估高度、ResizeObserver 实测高度缓存、offsets 前缀和和二分查找定位可视区，支持内容高度动态变化的商品详情列表。
```

突出 Canvas 对比：

```text
- 实现 Canvas 虚拟列表对比方案，通过单 canvas 绘制可视商品行，验证弱交互大数据列表下 Canvas 相比 DOM 虚拟列表在节点数量和滚动稳定性上的优势。
```

偏业务结果：

```text
- 优化大数据商品列表渲染体验，通过虚拟滚动、图片懒加载、滚动更新合帧和动态高度测量，将长列表从全量渲染改为窗口化渲染，提升滚动流畅度和页面响应速度。
```

### 项目介绍口径

面试时可以这样讲：

```text
这个项目主要是为了解决大数据列表渲染的问题。我做了三个版本：定高 DOM 虚拟滚动、不定高 DOM 虚拟滚动和 Canvas 虚拟滚动对比版。

定高版本是用总高度撑开滚动条，然后根据 scrollTop 算出当前可视区的 startIndex 和 endIndex，只渲染可视区加 overscan 的数据。为了减少快速滚动时的状态更新，我用了 requestAnimationFrame 合并 scroll 事件。

不定高版本会复杂一些，因为不能再用 scrollTop / itemHeight 直接算索引。我用了 estimatedItemHeight 做初始估算，再用 ResizeObserver 实测每一行高度，维护一个 offsets 前缀和，然后通过二分查找定位可视起点。

Canvas 版本主要是做性能对比，它不创建每一行 DOM，而是用一个 canvas 绘制当前可视行。这个版本能看到 DOM 节点数量会非常少，但交互和无障碍成本会更高。
```

## 面试官可能会问什么

### 1. 你为什么要做虚拟滚动？

可以回答：

```text
主要是因为长列表如果全量渲染，DOM 数量会非常大。比如 10,000 条商品，每条里面还有图片、标签、按钮，真实 DOM 节点可能是几十万级。这样首屏渲染、滚动、样式计算都会变慢。

虚拟滚动的核心思路就是只渲染用户当前看得见的那一小段，再加一点上下缓冲。滚动条还是完整高度，但 DOM 数量始终保持在几十行左右。
```

### 2. 定高虚拟滚动是怎么实现的？

可以回答：

```text
定高比较简单，因为每行高度固定。总高度就是 items.length * itemHeight，用这个高度撑开滚动条。

滚动时拿到 scrollTop，用 Math.floor(scrollTop / itemHeight) 算出起始索引，然后根据容器高度算出可见数量，再加 overscan。真正渲染的就是 slice(startIndex, endIndex) 这一段。

因为渲染出来的内容不是从顶部开始的，所以我会用 transform: translateY(startIndex * itemHeight) 把窗口移动到正确位置。
```

### 3. 什么是 overscan？为什么需要它？

可以回答：

```text
overscan 就是在可视区域之外额外多渲染几行。比如屏幕能看到 10 行，我可能渲染 10 行加上下各 6 行。

它的作用是给快速滚动留缓冲。如果只渲染刚好可见的内容，滚动稍微快一点，React 还没来得及提交新 DOM，用户就可能看到白屏。overscan 可以降低这个概率。

代价就是多渲染一些 DOM，所以需要在流畅度和渲染成本之间取平衡。
```

### 4. 快速滚动出现白屏是什么原因？

可以回答：

```text
白屏通常不是索引算错，而是滚动位置已经变化了，但 React 还没把新的可视行提交到 DOM。

浏览器的 scrollTop 会先变化，然后 React 才执行 setState、render、diff、commit，浏览器还要做样式计算和绘制。如果这些步骤没跟上滚动速度，旧内容在旧位置，新内容还没出来，中间就会短暂空白。

所以我做了几个优化：加 overscan，用 requestAnimationFrame 合并 scroll 更新，减少每帧 state 更新次数，图片也尽量固定尺寸和懒加载。
```

### 5. 为什么要用 requestAnimationFrame 优化 scroll？

可以回答：

```text
scroll 事件触发频率可能非常高，如果每次 scroll 都 setState，React 更新会很密集，反而容易积压。

我这里的做法是先把最新的 scrollTop 存到 ref 里，然后用 requestAnimationFrame 保证一帧最多提交一次 state。这样即使一帧内触发了多次 scroll，我也只用最新的 scrollTop 渲染一次。

简单说，就是减少无效更新，让渲染节奏跟浏览器帧率对齐。
```

### 6. 不定高虚拟滚动为什么更难？

可以回答：

```text
因为定高列表可以用 scrollTop / itemHeight 直接算索引，但不定高不行。每一行高度不同，scrollTop 到底落在哪一行，需要知道前面所有行高度的累加值。

所以不定高一般要维护一个高度缓存和 offsets 前缀和。初始时用 estimatedItemHeight 估算，行渲染出来以后用 ResizeObserver 测真实高度，再更新缓存和总高度。

查找可视起点时，我不是一行行扫，而是在 offsets 里二分查找，这样效率更好。
```

### 7. 不定高列表会有什么坑？

可以回答：

```text
主要有几个坑。

第一个是预估高度不准，滚动条高度会在测量后修正，可能带来轻微跳动。

第二个是异步内容，比如图片加载、内容展开、远程数据补齐，都会改变行高，需要重新测量。

第三个是性能问题，如果每次高度变化都全量重算 offsets，数据特别大时会有成本。一般可以做节流，或者用分块前缀和、Fenwick Tree 这类结构优化。
```

### 8. Canvas 虚拟列表为什么快速滚动更稳？

可以回答：

```text
Canvas 的路径更短。DOM 虚拟列表滚动时需要 React render、diff、commit，还要浏览器做样式计算、layout 和 paint。

Canvas 版本滚动时基本就是计算可见行，然后在同一个 canvas 上 clearRect、drawImage、fillText。它没有每一行的 DOM 子树，也不需要创建和移动一堆节点。

所以在规则布局、弱交互、大数据展示的场景里，Canvas 更容易保持稳定。但它不是万能的，如果绘制很复杂、图片没解码、DPR 太高，也一样会卡。
```

### 9. 那为什么不全部用 Canvas？

可以回答：

```text
因为 Canvas 牺牲了很多浏览器原生能力。

DOM 里的按钮、链接、hover、focus、键盘操作、文本选择、复制、无障碍语义都是现成的。Canvas 画出来的按钮其实只是一块像素，点击区域、hover、focus、键盘导航都要自己实现。

所以我会按场景选。如果是商品管理这种复杂交互列表，我优先用 DOM 虚拟滚动。如果是行情、监控日志、热力图、大规模弱交互展示，Canvas 会更合适。
```

### 10. 离屏 Canvas 为什么会提升性能？

可以回答：

```text
离屏 Canvas 的核心价值是缓存。它不是因为“离屏”这个动作天然更快，而是可以把重复绘制提前画好。

比如圆角图片、标签 pill、按钮底图，如果每一帧都重新画路径、clip、measureText，会有成本。可以先画到一个离屏 canvas，滚动时主 canvas 只 drawImage，把已经画好的结果贴上去。

简单说，就是把复杂绘制变成贴图。但它也会占内存，所以不能无脑缓存所有行，比较合理的是缓存圆角图片、重复标签、按钮底图，或者用 LRU 缓存最近访问的行。
```

### 11. 如果数据量从 1 万变成 100 万怎么办？

可以回答：

```text
虚拟滚动只解决 DOM 渲染数量，不解决数据本身的内存和计算问题。

如果到 100 万条，我不会一次性把所有数据放前端。应该做服务端分页、游标加载、服务端搜索和排序。前端只缓存当前窗口附近的数据，滚动到某个范围再加载对应页。

如果前端确实要做筛选或排序，也应该考虑 Web Worker，避免阻塞主线程。
```

### 12. 你怎么验证虚拟滚动确实生效？

可以回答：

```text
我会从几个角度看。

第一，看 DOM 数量。比如总数据 10,000 条，但页面里实际只有二三十行 DOM。

第二，看滚动到很远位置后内容是否正常，比如 scrollTop 跳到几十万甚至上百万，列表还能显示正确数据。

第三，看控制台有没有 key、layout、图片加载相关错误。

第四，看移动端有没有横向溢出，快速滚动有没有明显白屏。

Canvas 版本还会额外看 drawMs、绘制行数、滚动区 DOM 节点数量。
```

### 13. 如果面试官追问“你这个方案还有什么可以优化？”

可以回答：

```text
DOM 版本可以继续做动态 overscan、按滚动方向分配 overscan、行组件 memo、图片预加载和失败态。

不定高版本可以优化 offsets 重算，比如用分块前缀和，减少高度变化时的全量计算。

Canvas 版本可以缓存 measureText 结果，限制 DPR，节流 stats 更新，用离屏 canvas 缓存圆角图片和标签，复杂场景下还可以考虑 OffscreenCanvas + Worker。

如果是生产项目，我还会结合业务看是否需要直接使用 @tanstack/react-virtual 这种成熟库。
```

### 14. 可以怎么一句话总结这个项目？

可以回答：

```text
我做的是一个大数据商品列表渲染优化 demo，包含定高、不定高和 Canvas 三种虚拟滚动方案。核心目标是把全量列表渲染变成窗口化渲染，并对比不同方案在滚动性能、交互能力和实现复杂度上的取舍。
```
