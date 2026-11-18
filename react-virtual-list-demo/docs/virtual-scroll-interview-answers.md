# 虚拟滚动面试题 — 参考答案

> 每题按"分点作答"格式整理，可直接对照 `virtual-scroll-interview-qa.md` 题单使用。  
> 答案风格模拟面试口述，建议自己先答一遍再对照。

---

## 一、基础原理

### Q1. 为什么长列表会卡顿？虚拟滚动解决了什么问题？

**参考答案：**

1. **DOM 节点数量问题**：10,000 条商品数据，每行包含图片、标签、按钮、SVG 图标，单行 DOM 节点约 20 个，总计可达 20 万个节点。浏览器需要把这些节点全部纳入内存管理。

2. **浏览器渲染成本**：所有节点都要经历样式计算（Recalculate Style）→ 布局（Layout）→ 绘制（Paint）→ 合成（Composite）这条完整流水线，节点越多耗时越长，首屏渲染和每次更新都会变慢。

3. **React 自身成本**：React 要对整棵组件树做 render → diff → commit，即使本次更新只改了搜索关键词，仍然要面对几万个组件节点。

4. **浪费**：用户视口高度通常只能看到 7～10 行，剩下 9,990 行的 DOM 在此刻对用户毫无价值，却占着内存和渲染时间。

**虚拟滚动解决的核心问题**：  
- 数据可以有 10,000 条，但 DOM 始终只维护可视区域附近的 20～30 行。  
- 滚动时不是"创建新行、销毁旧行"，而是用同一批 DOM 节点"换内容"。  
- 注意：虚拟滚动**只解决 DOM 渲染数量**，不解决数据本身的内存问题。

---

### Q2. 虚拟列表的核心结构是什么？滚动条为什么能显示正确高度？

**参考答案：**

1. **整体结构**分三层：
   - 最外层：**滚动容器**（`overflow: auto`，固定高度），负责产生滚动条
   - 第二层：**撑高元素**（`height = items.length × itemHeight`），高度等于完整列表，但不渲染任何内容，只负责撑开滚动条
   - 第三层：**可见内容区**（`position: absolute`），只包含当前可见的 20～30 行，用 `transform: translateY(offsetY)` 移到正确位置

2. **滚动条为什么正确**：  
   - 浏览器的滚动条高度和位置由滚动容器的内容总高度决定  
   - 撑高元素的 `height` 等于所有行的真实总高度（如 10,000 × 92px = 920,000px），所以浏览器渲染出来的滚动条和"真正有 10,000 行"时完全一样  
   - 用户拖动滚动条时，`scrollTop` 的变化范围也是正确的

3. **关键点**：撑高元素和可见内容区是**兄弟关系**（都在滚动容器里），撑高元素不包裹可见内容区，否则绝对定位的基准会出问题。

---

### Q3. 虚拟滚动和分页各自适合什么场景？

**参考答案：**

1. **数据量较小（< 500 条）**：直接全量渲染，实现最简单，不引入额外复杂度。

2. **中等数据量（1,000～50,000 条）+ 需要连续滚动体验**：虚拟滚动最合适，用户感觉像在浏览完整列表，DOM 数量始终可控。

3. **超大数据量（> 50,000 条）或搜索/排序由后端完成**：服务端分页 + 虚拟滚动组合，前端不一次性持有全量数据，只缓存当前窗口附近几页。

4. **移动端信息流、评论、微博**：无限滚动（游标分页 + 虚拟滚动），下滑时追加加载，配合虚拟列表避免页面越刷越卡。

5. **选型原则**：分页适合"离散翻页"场景（表格、管理后台）；虚拟滚动适合"连续滚动"场景（商品流、日志、消息流）。两者不是互斥的，可以组合。

---

## 二、定高虚拟列表实现

### Q4. 请讲解定高虚拟列表的核心计算公式。

**参考答案：**

定高的核心优势是**从 `scrollTop` 直接推导索引，不需要遍历或测量**：

```ts
// 1. 完整列表总高度，用于撑开滚动条
const totalHeight = items.length * itemHeight;

// 2. 视口内最多能容纳几行（向上取整，确保底部不缺行）
const visibleCount = Math.ceil(containerHeight / itemHeight);

// 3. 可见起始索引（减去 overscan，保证上方有缓冲；clamp 到 0）
const startIndex = Math.max(Math.floor(scrollTop / itemHeight) - overscan, 0);

// 4. 可见结束索引（加上 overscan * 2，保证下方有缓冲；clamp 到数组末尾）
const endIndex = Math.min(startIndex + visibleCount + overscan * 2, items.length);

// 5. 内容区的 Y 轴偏移，让它"对齐"到正确位置
const offsetY = startIndex * itemHeight;
```

关键点逐条说明：
- `Math.floor(scrollTop / itemHeight)`：整除得到当前滚动位置落在第几行
- `- overscan`：往上多缓冲几行，快速上滑时不白屏
- `+ overscan * 2`：上下各 overscan 行，所以乘 2
- `offsetY = startIndex * itemHeight`：内容区从 `startIndex` 行开始，要向下偏移这么多才能对齐

渲染时取 `items.slice(startIndex, endIndex)`，容器用 `transform: translateY(offsetY)` 定位。

---

### Q5. 为什么要用 `transform: translateY` 而不是 `margin-top` 或 `top`？

**参考答案：**

1. **`margin-top`**：属于普通文档流属性，修改后浏览器必须重新做 **Layout（布局）**，重新计算受影响元素的位置和尺寸，代价较高。

2. **`position: absolute` + `top`**：虽然脱离文档流，但修改 `top` 仍然会触发 **Layout**，因为浏览器需要重新计算绝对定位元素在包含块内的确切位置。

3. **`transform: translateY`**：  
   - 这是一个纯合成（Composite）阶段的属性，不影响文档流，不触发 Layout，不触发 Paint  
   - 浏览器会把带有 `transform` 的元素提升到独立图层，位移完全由 GPU 完成  
   - 滚动时每帧都需要更新偏移，`transform` 只影响 Composite，主线程工作量最小

4. **性能结论**：触发路径从长到短：`margin-top`（Layout+Paint+Composite）> `top`（Layout+Composite）> `transform`（Composite only）。虚拟列表的偏移会在每次滚动时更新，选 `transform` 是正确的。

---

### Q6. 定高列表里 `getItemKey` 有什么作用？如果 key 不稳定会怎样？

**参考答案：**

1. **作用**：React 用 `key` 来识别"哪个组件对应哪条数据"，从而决定复用还是重建。

2. **虚拟列表的特殊性**：每次滚动时 `startIndex` 变化，`slice(startIndex, endIndex)` 返回的 items 片段变了，渲染出的子组件顺序和内容都变了。

3. **用 `index` 做 key 的问题**：  
   - React 会认为"第 0 个位置的组件还是那个组件"，直接复用旧 DOM 节点  
   - 旧 DOM 对应的是旧数据，React 只会更新变化的 props，但一些内部状态（如展开/折叠、选中状态）不会重置  
   - 图片 `src` 变了，但如果图片已经加载好，DOM 节点复用后图片可能短暂显示旧图片  
   - 总结：**key 用 index 在虚拟列表里会造成错误的组件复用**

4. **正确做法**：用数据的稳定唯一标识，如 `item.id`。这样 React 知道"这行换了一条新数据，需要把内容更新到这个旧 DOM 节点上"，DOM 被复用但内容正确更新，同时旧数据对应的 DOM 被正确销毁。

---

### Q7. 手写一个最简定高虚拟列表（React）。

**参考答案：**

```tsx
import { useState } from 'react';

function VirtualList<T extends { id: number | string; title: string }>({
  items,
  itemHeight,
  height,
  overscan = 4,
}: {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  // 核心计算
  const totalHeight  = items.length * itemHeight;
  const visibleCount = Math.ceil(height / itemHeight);
  const startIndex   = Math.max(Math.floor(scrollTop / itemHeight) - overscan, 0);
  const endIndex     = Math.min(startIndex + visibleCount + overscan * 2, items.length);
  const offsetY      = startIndex * itemHeight;

  return (
    <div
      style={{ height, overflow: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* 撑高元素：撑开滚动条，不渲染内容 */}
      <div style={{ height: totalHeight, pointerEvents: 'none' }} />

      {/* 可见内容区：绝对定位 + translateY 偏移 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          transform: `translateY(${offsetY}px)`,
        }}
      >
        {items.slice(startIndex, endIndex).map((item) => (
          <div key={item.id} style={{ height: itemHeight, boxSizing: 'border-box' }}>
            {item.title}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**这个版本的不足（追问准备）**：
1. 每次 `scroll` 事件都调用 `setScrollTop`，高频触发会积压 React 更新，应该用 `requestAnimationFrame` 合帧
2. 行组件没有 `memo`，父组件任何状态变化都会触发所有行重渲染
3. 没有处理容器 resize 场景（`height` 是固定 prop，窗口缩放不更新）
4. 没有 `passive: true` 的 touch 事件优化

---

## 三、滚动性能与白屏优化

### Q8. 虚拟列表为什么会出现快速滚动白屏？

**参考答案：**

**根本原因是时间差，不是索引算错**。

完整链路：

1. 用户快速拖动滚动条，浏览器**立即**、**同步**更新 `scrollTop`
2. `scroll` 事件触发，React 拿到新 `scrollTop`，计算新的 `startIndex` 和 `endIndex`
3. React 执行 `setState` → 组件 `render` → 虚拟 DOM `diff` → 真实 DOM `commit`
4. 浏览器对新 DOM 做样式计算 → Layout → Paint → Composite
5. 新内容才最终出现在视口

**白屏发生的时机**：  
- 第 1 步是同步的，视口已经移到了新位置  
- 第 2～4 步是异步的，需要时间  
- 如果用户滚动速度 > React + 浏览器处理速度，旧 DOM 已经移出视口，新 DOM 还没提交，视口区域就会短暂空白

**结论**：  
- DOM 虚拟列表**无法**在极端快速滚动下给出"绝对不白屏"的理论保证  
- 但工程上可以通过多种手段把白屏概率和持续时间压到用户几乎感知不到  
- Canvas 虚拟列表不存在这个问题，因为没有"新 DOM 还没提交"这一步

---

### Q9. 有哪些手段可以降低白屏概率？

**参考答案：**

1. **增大 `overscan`**  
   - 在可视区域上下多渲染更多行，缓冲区越大，快速滚动时越不容易出现空白  
   - 代价：DOM 节点增多，每次滚动渲染的行数增加

2. **动态 `overscan`（按滚动速度调整）**  
   ```ts
   const velocity = Math.abs(currentScrollTop - lastScrollTop) / deltaTime;
   const dynamicOverscan = velocity > 3 ? 40 : 12;
   ```
   - 慢速滚动保持轻量，快速滚动临时增大缓冲，平衡性能和流畅度

3. **按滚动方向分配缓冲**  
   ```ts
   const before = direction === 'up'   ? 24 : 6;
   const after  = direction === 'down' ? 24 : 6;
   ```
   - 下滑时多渲染下方，上滑时多渲染上方，同样的缓冲行数覆盖更有效

4. **`requestAnimationFrame` 合帧**  
   - 一帧内无论触发多少次 `scroll`，只提交最新一次 `scrollTop`  
   - 减少 React state 更新次数，降低每帧提交压力

5. **行组件 `memo`**  
   - `React.memo` 包裹行组件，当 `item` 引用没变时跳过 render  
   - 配合 `useCallback` 固定 `renderItem`、`getItemKey` 的引用，避免每次父组件更新都触发所有行重渲染

6. **图片处理**  
   - 固定 `width`、`height` 避免图片加载后触发 layout shift  
   - CDN 缩略图减少图片尺寸  
   - 图片加载失败时提供稳定 fallback，避免布局塌陷

7. **滚动中降级渲染**  
   - 快速滚动时先渲染轻量占位骨架，滚动停止 100ms 后补完整内容  
   - 高密度可视化列表（行情、日志）常用此策略

---

### Q10. 为什么用 `requestAnimationFrame` 优化 scroll 事件，而不是 `throttle`？

**参考答案：**

1. **`throttle(fn, 16)` 的问题**：  
   - 底层基于 `setTimeout`，定时器精度不准，受主线程任务队列影响  
   - 可能在同一帧触发两次（前一帧末 + 后一帧初），也可能跳过某帧  
   - 和浏览器渲染帧**不对齐**，更新节奏乱

2. **`requestAnimationFrame` 的优势**：  
   - 由浏览器统一调度，和渲染帧**完全对齐**，每帧最多执行一次  
   - 保证在下次绘制之前处理最新的 `scrollTop`，不会出现"本帧已经绘制但 state 还是上帧的"情况

3. **实际写法关键点**：  
   ```ts
   // scrollTop 存在 ref，不存在 state
   // → scroll 事件里不触发 React re-render
   pendingScrollTopRef.current = e.currentTarget.scrollTop;
   
   if (rafRef.current !== null) return; // 已有帧在队列，跳过重复注册
   
   rafRef.current = requestAnimationFrame(() => {
     rafRef.current = null;
     setScrollTop(pendingScrollTopRef.current); // 只更新最新值，触发一次 re-render
   });
   ```
   - 一帧内触发 10 次 scroll → 只 `setScrollTop` 一次 → React 只 render 一次
   - 相比直接在 scroll 里 `setScrollTop`，能减少 80%+ 的无效渲染

---

### Q11. `scroll` 事件监听应该用 passive 模式吗？

**参考答案：**

1. **`scroll` 事件本身**：已经是被动的，浏览器不会等 JS 执行完再滚动，在 `scroll` 回调里调用 `preventDefault()` 也没有效果，所以对 `scroll` 加不加 `passive` 意义不大。

2. **真正重要的是 `touchstart` / `touchmove`**：  
   - 默认情况下，浏览器收到 touch 事件后必须等 JS 执行完才能确认"是否要阻止默认滚动"  
   - 这会导致移动端滚动有明显的延迟卡顿感  
   - 加上 `{ passive: true }` 后，浏览器不再等 JS，可以立即开始滚动，明显流畅

3. **React 的问题**：  
   - React 的合成事件（`onScroll`）不支持 passive 模式  
   - 要获得 passive touch 事件，需要用 `useEffect` + `addEventListener` 手动绑定：
   ```ts
   useEffect(() => {
     const el = containerRef.current;
     const handler = (e) => { /* ... */ };
     el.addEventListener('touchstart', handler, { passive: true });
     return () => el.removeEventListener('touchstart', handler);
   }, []);
   ```

4. **实际影响**：在 iOS Safari 上，不加 passive 的 touch 监听是移动端列表卡顿的常见原因之一。

---

## 四、不定高虚拟列表实现

### Q12. 不定高虚拟列表和定高有什么本质区别？

**参考答案：**

1. **定高的前提**：每行高度相同，所以 `scrollTop` 和 index 之间是固定倍数关系，可以直接用公式：
   ```ts
   startIndex = Math.floor(scrollTop / itemHeight)
   ```

2. **不定高的核心困难**：每行高度不同，`scrollTop = 1000px` 可能落在第 8 行，也可能落在第 12 行，取决于前面每行的实际高度。**公式失效，必须换数据结构**。

3. **解决方案——offsets 前缀和数组**：
   ```ts
   offsets[0] = 0
   offsets[1] = offsets[0] + height(item[0])  // 第 0 行的结束位置
   offsets[2] = offsets[1] + height(item[1])  // 第 1 行的结束位置
   offsets[i] = 第 i 行的起始 y 坐标
   ```
   - `offsets[i]` 就是第 i 行开始渲染的 y 位置
   - 给定 `scrollTop`，在 offsets 数组里**二分查找**第一个 `offsets[i] > scrollTop` 的 `i`，`i - 1` 即为 `startIndex`

4. **行定位方式也不同**：  
   - 定高：所有可见行放在一个容器里，整体用 `translateY(offsetY)` 移位  
   - 不定高：每行单独用 `transform: translateY(offsets[index])` 定位，因为每行的起始位置各不相同

---

### Q13. 不定高列表如何获取每行的真实高度？

**参考答案：**

1. **初始阶段**：用 `estimatedItemHeight`（预估高度，如 148px）生成初始 offsets，让列表可以先渲染出来，不必等所有行测量完。

2. **测量阶段**：每行渲染后，用 `ResizeObserver` 监听其尺寸：
   ```ts
   useEffect(() => {
     const observer = new ResizeObserver(() => {
       const height = rowEl.getBoundingClientRect().height;
       measuredHeights.set(itemKey, Math.ceil(height)); // 存入缓存
       // 触发 offsets 重算
     });
     observer.observe(rowEl);
     return () => observer.disconnect(); // 离开视口时断开，避免内存泄漏
   }, [itemKey]);
   ```

3. **高度缓存**：用 `Map<itemKey, number>` 存储已测量的高度。再次滚动到某行时直接用缓存值，不重新测量。

4. **offsets 重算**：任何行高发生变化时，重新遍历 items 构建 offsets 数组：
   ```ts
   for (let i = 0; i < items.length; i++) {
     const h = measuredHeights.get(getItemKey(items[i], i)) ?? estimatedItemHeight;
     offsets[i + 1] = offsets[i] + h;
   }
   ```

5. **注意**：测量完成后 totalHeight 可能发生变化，导致滚动条长度调整，这是正常的，可以通过让 `estimatedItemHeight` 尽量接近真实值来减小跳动幅度。

---

### Q14. 不定高列表的 offsets 二分查找怎么写？

**参考答案：**

```ts
/**
 * 在 offsets 前缀和数组中，找到最后一个 offsets[i] <= scrollTop 的 i
 * 即：scrollTop 落在第 i 行内
 */
function findStartIndex(offsets: number[], scrollTop: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    // 注意：+1 后再取整，是"向上取整"的写法
    // 目的是避免 low = mid 时出现死循环（当 high = low + 1 时，普通取整 mid = low，永远不前进）
    const mid = Math.floor((low + high + 1) / 2);

    if (offsets[mid] <= scrollTop) {
      low = mid;        // scrollTop 还在 mid 右侧或刚好在 mid，往右找
    } else {
      high = mid - 1;   // scrollTop 在 mid 左侧，往左找
    }
  }

  return low; // 最终 low === high，即目标 index
}
```

**验证边界**：
- `scrollTop = 0`：`offsets[0] = 0 <= 0`，返回 0 ✓
- `scrollTop = offsets[5]`：恰好在第 5 行起始，返回 5 ✓
- `scrollTop = offsets[5] + 10`：在第 5 行内，返回 5 ✓
- `scrollTop > offsets[最后一行]`：返回最后一行 index ✓

**时间复杂度**：O(log n)，相比线性扫描 O(n) 在 10,000 条数据下有明显优势。

---

### Q15. 不定高列表有哪些常见坑？

**参考答案：**

**坑一：预估高度不准 → 滚动条跳动**
- 初始 offsets 基于预估值生成，`totalHeight` 是预估的
- 真实测量完成后 `totalHeight` 修正，滚动条长度突然变化
- 如果用户正在滚动，滚动条跳动会造成迷失感
- **缓解方案**：统计历史实测均值动态更新 `estimatedItemHeight`，或尽量让预估值接近真实均值

**坑二：异步内容改变行高 → 需要重新测量**
- 图片加载完成后高度变大（如果没有固定 height 属性）
- 折叠/展开操作改变行内容
- 远程数据异步补充（如商品详情懒加载）
- `ResizeObserver` 能监听到这些变化，但要注意：高度变化 → 触发重算 → 触发 re-render → 可能又触发高度变化，需要防止无限循环（判断新旧高度是否相同，相同则跳过）

**坑三：全量重算 offsets 是 O(n)**
- 每次任意一行高度变化，都要重算整个 offsets 数组
- 10,000 条时单次重算约 0.5ms，但如果短时间内大量行高同时变化（如全部图片同时加载完），会积压大量重算
- **优化方案**：
  1. 对重算做节流（`debounce(rebuildOffsets, 16)`）
  2. 只重算变化行之后的部分（从变化点往后更新）
  3. 用 Fenwick Tree 把单点更新降到 O(log n)

---

### Q16. 什么是 Fenwick Tree？在虚拟列表里有什么用？

**参考答案：**

1. **Fenwick Tree（树状数组）**是一种支持以下两个操作的数据结构：
   - **单点更新**：修改某个位置的值，O(log n)
   - **前缀查询**：查询 1～i 位置的总和，O(log n)
   - 相比普通数组：前缀和查询 O(1) 但单点更新 O(n)；Fenwick Tree 两者都是 O(log n)，适合频繁更新场景

2. **在不定高虚拟列表里的应用**：
   - 把"每行的高度"存入 Fenwick Tree
   - `query(i)` = 前 i 行的总高度 = `offsets[i]`
   - 某行高度变化时，`update(i, newHeight - oldHeight)` 更新差值，O(log n)
   - 查找 `startIndex` 时，在树上二分查找满足 `query(i) <= scrollTop` 的最大 i，O(log²n)
   
3. **与普通 offsets 数组对比**：
   - 普通数组：单次高度更新 → 重算后续全部 offsets → O(n)
   - Fenwick Tree：单次高度更新 → O(log n)；前缀查询 → O(log n)
   - 10,000 行时，O(n) ≈ 10,000 次操作；O(log n) ≈ 13 次操作

4. **实际工程判断**：10,000 条数据时普通 offsets 数组通常够用，只有在数据量达到 100,000+ 且高度变化非常频繁时，Fenwick Tree 才有明显收益。`@tanstack/react-virtual` 内部也用了类似的分块策略来优化这个问题。

---

## 五、Canvas 虚拟列表

### Q17. Canvas 虚拟列表为什么快速滚动更稳定？

**参考答案：**

1. **DOM 虚拟列表的滚动链路（长）**：
   ```
   scrollTop 变化（同步）
     → scroll 事件触发
     → React setState
     → React render + diff
     → React commit（真实 DOM 更新）
     → 浏览器样式计算
     → 浏览器 Layout
     → 浏览器 Paint
     → 浏览器 Composite
     → 新内容出现
   ```

2. **Canvas 虚拟列表的滚动链路（短）**：
   ```
   scrollTop 变化（同步）
     → 计算可见行范围
     → ctx.clearRect(...)      // 清空画布
     → ctx.drawImage(...)      // 画图片
     → ctx.fillText(...)       // 画文字
     → GPU Composite
     → 新内容出现
   ```

3. **关键差异**：  
   - Canvas 没有"新 DOM 还没提交"这一步，每帧在同一块画布上重画，不存在旧内容/新内容的交替等待  
   - 不需要维护每行的 DOM 子树（`img`、`button`、`span`、`svg`），也不需要经过 React diff  
   - 滚动时主要工作是：计算范围 + `clearRect` + 一组 `drawImage`/`fillText`，远比 DOM 路径短

4. **Canvas 也不是绝对不白屏**：  
   - 单帧绘制逻辑超过 16ms（如绘制内容太复杂）  
   - 图片还未加载或解码完成  
   - 主线程被其他 JS 任务阻塞  
   - 以上情况 Canvas 也会出现空白或卡顿

---

### Q18. Canvas 渲染列表有哪些局限？

**参考答案：**

1. **交互能力缺失**：  
   - Canvas 画出来的"按钮"本质上只是一块像素，没有原生事件  
   - 点击、hover、focus、键盘导航需要自己实现：记录每个元素的绘制区域（hit area），在 `click`/`mousemove` 事件里做坐标命中检测

2. **文本能力缺失**：  
   - 用户无法选中 Canvas 内的文本，无法复制，右键菜单也没有"复制"选项  
   - 对内容展示型产品是较大限制

3. **无障碍（a11y）困难**：  
   - 屏幕阅读器（VoiceOver、NVDA）无法解析 Canvas 内容  
   - 需要额外维护一份"无障碍 DOM 镜像"，在 `canvas` 旁边放隐藏的 `aria-hidden` DOM 结构，实现成本高

4. **开发维护成本高**：  
   - 所有样式和布局都是手写坐标，不能用 CSS flexbox/grid  
   - 响应式需要监听容器尺寸变化，重新计算所有绘制坐标  
   - 字体、图片、高清屏（DPR）都需要单独处理

5. **选型结论**：  
   - **适合**：行情 K 线、日志流、热力图、监控大屏、100 万行弱交互展示  
   - **不适合**：商品管理、CMS 编辑器、需要复杂表单交互的列表

---

### Q19. 什么是离屏 Canvas？为什么能提升性能？

**参考答案：**

1. **核心思想——把"复杂绘制"变成"贴图"**：  
   - 离屏 Canvas 本质是一个缓存机制，不是"离屏"本身让它快  
   - 预先把每行复杂内容画到一个独立的 canvas，滚动时主 canvas 只做 `drawImage`，把已经画好的结果贴过来

2. **实际代码**：
   ```ts
   // 预渲染阶段（数据加载后或宽度变化后执行一次）
   const cacheCanvas = new OffscreenCanvas(rowWidth, rowHeight);
   const cacheCtx = cacheCanvas.getContext('2d');
   drawFullRow(cacheCtx, item);  // 画圆角图片、标签、按钮底图...
   
   // 滚动绘制阶段（每帧执行）
   ctx.drawImage(cacheCanvas, 0, rowY);  // 贴图，极快
   ```

3. **节省的开销**：  
   - 圆角路径计算和 clip（每次重画都需要）  
   - `ctx.measureText()` 文字测量（有成本，尤其在省略号截断时）  
   - 图片解码（已经画进 canvas 的图片不需要再解码）

4. **代价和注意事项**：  
   - 内存占用增加（每行缓存一个 canvas，10,000 行全缓存会很大）  
   - 容器宽度变化、主题切换、数据更新时需要清除对应缓存  
   - **合理策略**：用 LRU 缓存最近访问的 N 行（如 200 行），或只缓存"圆角图片"、"重复标签 pill"、"按钮底图"等复用率高的小件

---

### Q20. OffscreenCanvas + Worker 是什么方案？什么时候用？

**参考答案：**

1. **基本原理**：把 canvas 控制权从主线程转移给 Worker，Worker 负责所有绘制工作，主线程只处理滚动事件和用户交互，两者并行。

2. **代码结构**：
   ```ts
   // 主线程
   const offscreen = canvas.transferControlToOffscreen();
   const worker = new Worker('./canvas-worker.js');
   worker.postMessage({ canvas: offscreen }, [offscreen]); // 转移控制权
   
   // 滚动时发消息给 Worker
   worker.postMessage({ type: 'scroll', scrollTop: e.target.scrollTop });
   ```
   ```ts
   // canvas-worker.js
   let ctx;
   self.onmessage = ({ data }) => {
     if (data.canvas) {
       ctx = data.canvas.getContext('2d');
     } else if (data.type === 'scroll') {
       drawVisibleRows(ctx, data.scrollTop); // 在 Worker 里绘制，不阻塞主线程
     }
   };
   ```

3. **适合场景**：  
   - 单帧绘制逻辑超过 8ms（如复杂数据可视化、粒子系统）  
   - 主线程同时承载较重的交互逻辑（表单、动画、实时计算）  
   - 目标是滚动时主线程完全空闲，让帧率达到 120fps

4. **代价和限制**：  
   - 图片加载必须在主线程（Worker 无法直接访问 DOM 和网络 `<img>`），需要用 `createImageBitmap` 传递图片数据  
   - 字体加载：Worker 里用 `FontFace`，但支持度不如主线程好  
   - 点击事件坐标需要主线程接收后 postMessage 给 Worker 做命中检测  
   - 整体实现复杂度很高，兼容性需要评估（`transferControlToOffscreen` Safari 2022 才支持）

---

## 六、大数据量与工程选型

### Q21. 数据量从 1 万变成 100 万，怎么处理？

**参考答案：**

**核心认知**：虚拟滚动只解决 DOM 渲染数量，不解决数据本身在内存里的问题。100 万条数据即使不渲染，仅存在 JS 内存里也要几百 MB。

**分层处理策略**：

1. **后端分页 / 游标加载**  
   - 前端每次只请求一页（如 200 条），不一次性拿全量  
   - 游标分页比页码分页更适合实时追加场景（评论流、日志流）

2. **前端数据窗口缓存**  
   ```ts
   const pageCache = new Map<number, Item[]>();
   // 滚动到某区域 → 加载对应页 → 存入 cache
   // LRU 淘汰距离当前视口最远的页，释放内存
   ```

3. **搜索、排序、筛选交给后端**  
   - 100 万条数据的 `filter` 或 `sort` 在前端是不可接受的  
   - 前端只做当前页的高亮展示

4. **Web Worker 处理不可避免的前端计算**  
   - 如果业务确实需要前端做大规模数据处理（聚合、分组统计），放到 Worker 避免阻塞主线程滚动

5. **虚拟列表仍然需要**  
   - 即使只缓存 2,000 条数据在内存里，DOM 也不能全部渲染，虚拟滚动依然是必要的

6. **使用成熟库**  
   - `@tanstack/react-virtual` 已经处理了窗口外数据的 unload、动态测量、边界索引等细节

---

### Q22. `@tanstack/react-virtual` 和自己实现有什么区别？什么时候选库？

**参考答案：**

1. **库解决了什么**：  
   - 滚动同步的边界问题（快速滚动时的索引边界保护）  
   - 动态测量（`measureElement` API，自动处理 `ResizeObserver`）  
   - SSR 兼容（服务端渲染时没有 DOM，库会降级处理）  
   - 水平虚拟化、网格虚拟化  
   - Sticky 吸顶元素  
   - `scrollToIndex` / `scrollToOffset` 等编程式滚动

2. **自己实现的场景**：  
   - 需要 Canvas 渲染（库基于 DOM，没有 Canvas 模式）  
   - 需要深度定制测量策略（如测量时机、缓存粒度）  
   - 包体积极度敏感的 H5 项目  
   - **面试 / 学习**：手写是展示理解深度的最佳方式

3. **生产项目建议**：  
   - 优先用 `@tanstack/react-virtual`，它经过大量真实项目验证，边界 case 处理完善  
   - 自己实现容易漏掉：resize 处理、SSR、`key` 问题、边界索引越界、`ResizeObserver` 内存泄漏等细节

---

### Q23. 虚拟列表如何与搜索过滤结合？

**参考答案：**

1. **基本思路**：搜索过滤产生 `filteredItems` 新数组，直接传给虚拟列表组件作为新的 `items` prop，列表根据新数组重新计算索引和高度。

2. **必须重置 scrollTop**：  
   - 过滤后数据量减少，原来的 `scrollTop` 可能超出新的 `totalHeight`  
   - 应该在过滤时把 `scrollTop` 重置为 0：
   ```ts
   const handleSearch = (q: string) => {
     setQuery(q);
     containerRef.current?.scrollTo({ top: 0 });
   };
   ```

3. **前端过滤（本项目做法）**：  
   - `useMemo(() => filterItems(items, query), [items, query])` 计算过滤结果  
   - 适合数据量在 10,000 条以内，实时响应，不需要请求

4. **后端搜索（大数据场景）**：  
   - 输入框 `debounce` 300ms 再发请求，避免每次击键都请求  
   - 用 `AbortController` 取消前一次未完成的请求（本项目已实现）  
   - 显示 loading 状态，搜索结果回来后替换 items

5. **不定高列表的额外注意**：过滤前测量的高度缓存对新 items 仍然有效（key 未变的行高度不变），不需要清除缓存。

---

### Q24. 虚拟列表如何验证确实生效？如何测量性能？

**参考答案：**

**验证虚拟列表是否生效**：

1. **DOM 节点数量**：Chrome DevTools → Elements 面板 → 滚动时数 `.virtual-list` 或等效容器下的子节点数，应该是 20～30 个，而不是 10,000 个

2. **边界滚动正确性**：用 JS 把 `scrollTop` 直接设到接近 `totalHeight` 的位置，列表应该显示最后几条数据，内容和索引正确

3. **key 稳定性**：滚动时在 DevTools → Elements 面板观察 DOM，行内容应该更新，但 DOM 节点不应该频繁销毁重建（观察节点是否闪烁高亮）

**测量性能**：

1. **Chrome Performance 面板**：录制快速滚动，查看：  
   - Long Task（>50ms 的主线程阻塞）  
   - Layout（Recalculate Style + Layout 耗时）  
   - 帧率是否稳定在 60fps

2. **Lighthouse**：测量首屏渲染时间（FCP）、Total Blocking Time（TBT）

3. **Canvas 版本专项指标**（本项目侧边栏展示）：  
   - `drawMs`：本帧 Canvas 绘制耗时  
   - 当前绘制行数  
   - 滚动区 DOM 节点数量

4. **移动端测试**：在中低端 Android 设备上测试快速拖动是否出现白屏，注意 iOS Safari 的惯性滚动是否正常

---

## 七、连环追问 / 综合设计

### Q25. 如何实现一个支持分组吸顶的虚拟列表？

**参考答案：**

1. **数据结构扁平化**：把分组头和普通行统一放进一个 `items` 数组：
   ```ts
   type ListItem =
     | { type: 'group-header'; groupId: string; title: string }
     | { type: 'item'; groupId: string; data: Product };
   ```
   - 分组头和普通行可以有不同高度，用不定高虚拟列表处理

2. **找到当前的吸顶分组头**：滚动时，根据 `scrollTop` 找到最近的一个 `type === 'group-header'` 的项：
   ```ts
   const stickyGroupIndex = findLastGroupHeaderBefore(items, startIndex);
   ```

3. **渲染吸顶元素**：在滚动容器顶部额外渲染一个 `position: sticky` 的分组头，内容跟随 `stickyGroupIndex` 更新：
   ```tsx
   <div style={{ position: 'sticky', top: 0, zIndex: 1 }}>
     {items[stickyGroupIndex]?.title}
   </div>
   ```

4. **被下一个分组头"顶走"**：当虚拟列表里的真实分组头进入视口并触碰吸顶元素时，吸顶元素应该被顶走。可以用 `IntersectionObserver` 监听真实分组头节点，在它进入视口顶部时更新 `stickyGroupIndex`。

5. **注意**：吸顶元素高度不应计入 `scrollTop` 的计算（否则会遮挡第一行）；吸顶元素的高度变化时需要调整 `overscan` 或 `containerHeight`。

---

### Q26. 虚拟列表如何做键盘导航和焦点管理？

**参考答案：**

1. **ARIA 语义**：  
   - 滚动容器：`role="listbox"` 或 `role="list"`  
   - 每行：`role="option"` 或 `role="listitem"`  
   - 提供 `aria-posinset`（当前行在完整列表中的位置）和 `aria-setsize`（完整列表总行数）  
   - 本项目已实现以上属性

2. **维护 `focusedIndex` 状态**：  
   - 键盘 `↓` → `focusedIndex++`，`↑` → `focusedIndex--`  
   - `Home` → 0，`End` → `items.length - 1`

3. **焦点和滚动联动**：当 `focusedIndex` 超出当前渲染范围时：
   ```ts
   // Step 1：先把 scrollTop 调整到目标行可见
   containerEl.scrollTop = targetScrollTop;
   
   // Step 2：等 React commit 后（下一帧），把焦点移到目标行 DOM
   requestAnimationFrame(() => {
     document.getElementById(`row-${focusedIndex}`)?.focus();
   });
   ```

4. **`aria-activedescendant`**：  
   - 在滚动容器上设置 `aria-activedescendant={rowId}`，指向当前聚焦行的 DOM id  
   - 这样屏幕阅读器能知道"焦点在哪行"，即使焦点实际在容器上

5. **键盘选中与激活**：`Enter` 或 `Space` 触发当前焦点行的操作，逻辑和 `onClick` 相同，注意不要忘记键盘用户。

---

### Q27. 虚拟列表如何处理图片懒加载，避免滚动时图片一直重新加载？

**参考答案：**

1. **浏览器图片缓存机制**：  
   - 同一个 `src` URL 的图片，第二次请求会命中浏览器的 disk cache，不会重新发 HTTP 请求  
   - 虚拟列表每次滚动重建 DOM 时，图片节点重新创建，`src` 相同，实际不会重新下载  
   - 前提是图片 URL 稳定，不能带随机参数（`?t=Date.now()` 会让缓存失效）

2. **`loading="lazy"` 的作用和局限**：  
   - 让浏览器只加载视口内的图片，视口外的图片暂不请求  
   - 本项目已使用；适合首次进入视口时懒加载  
   - 局限：已经加载过的图片节点被销毁后重建，虽然不重新下载，但如果图片尺寸不固定，重建时会有闪烁

3. **固定图片尺寸**：  
   - 给 `img` 设置固定 `width` 和 `height` 属性，避免图片加载前后布局抖动  
   - 配合 CSS `aspect-ratio` 或固定高度

4. **预加载即将进入视口的图片**：  
   ```ts
   // 在 overscan 范围外额外预加载若干行图片
   const preloadItems = items.slice(endIndex, endIndex + 5);
   preloadItems.forEach(item => {
     const img = new Image();
     img.src = item.imageUrl; // 触发浏览器预加载，放入 disk cache
   });
   ```

5. **行组件 `memo` 防止销毁**：  
   - 当 `item` 引用未变时，`React.memo` 让行组件跳过 re-render，DOM 节点不销毁，图片不会重新创建  
   - 这是最根本的优化：图片节点存活，就不存在"重新加载"的问题

---

### Q28. 虚拟列表如何处理容器高度变化（窗口 resize）？

**参考答案：**

1. **影响范围**：  
   - 容器高度变化 → `visibleCount` 变化 → `endIndex` 变化 → 需要渲染更多或更少行  
   - 容器宽度变化 → 不定高列表中，文本换行改变 → 每行高度可能变化 → 需要重新测量

2. **监听容器尺寸变化**：
   ```ts
   useEffect(() => {
     const observer = new ResizeObserver(([entry]) => {
       const { height, width } = entry.contentRect;
       setContainerHeight(height);
       setContainerWidth(width); // 不定高需要
     });
     observer.observe(containerRef.current);
     return () => observer.disconnect();
   }, []);
   ```

3. **不定高列表的额外处理**：  
   - 宽度变化时，所有已测量的高度缓存可能失效（文本换行改变了高度）  
   - 需要清除 `measuredHeights`，重新回到预估高度，等 `ResizeObserver` 重新测量  
   - 这个过程会导致临时的 `totalHeight` 不准，滚动条会跳动，是不可避免的

4. **防抖优化**：  
   - `ResizeObserver` 回调在 resize 过程中可能触发非常频繁  
   - 对重算逻辑做 `debounce(16)` 或用 `requestAnimationFrame` 节流

5. **注意 `window.onresize` 和 `ResizeObserver` 的区别**：  
   - `window.onresize` 只监听视口变化  
   - `ResizeObserver` 能监听任意元素的尺寸变化（如侧边栏展开/收起也会改变列表容器宽度）  
   - 推荐用 `ResizeObserver`，更精确

---

### Q29. 一道综合设计题：设计一个支持 100 万条日志的前端展示系统。

**参考答案：**

**整体思路**：分层处理，前端只是展示层，不承载数据存储和计算。

1. **数据获取层**：  
   - 游标分页（Cursor-based pagination），每页 200 条  
   - 滚动到底部时追加加载下一页，滚动到顶部加载上一页（双向）  
   - 支持按时间范围跳转（前端发时间戳给后端，后端返回对应游标）

2. **前端数据管理层**：  
   ```ts
   const pageCache = new Map<number, LogEntry[]>();
   // LRU 策略：最多缓存 20 页（约 4,000 条），淘汰距离当前视口最远的页
   ```
   - 总内存控制在几 MB 以内，不随日志量增长

3. **渲染层**：  
   - 日志行高固定（如 36px），用**定高虚拟列表**，计算简单，性能最好  
   - 或用 Canvas 虚拟列表（日志是弱交互展示场景，Canvas 优势大）

4. **搜索与过滤**：  
   - 搜索走后端全文检索（Elasticsearch / Loki），不在前端扫描  
   - 结果高亮在前端做（对当前页的匹配关键词做文本高亮）

5. **大规模数据处理**：  
   - 如果需要前端聚合统计（如错误率图表），用 Web Worker 处理，不阻塞主线程

6. **性能保障**：  
   - `rAF` 合帧 + `overscan` 保证滚动流畅  
   - 行组件 `memo`  
   - 日志文本内容固定，不需要图片预加载  
   - 时间戳列用 `font-variant-numeric: tabular-nums` 对齐

7. **极端情况**：用户快速跳到 100 万条附近 → 发出时间戳查询请求 → 显示 loading → 后端返回对应页数据 → 渲染，整个过程用户只看到短暂 loading，不会卡死。

---

### Q30. 如果让你 code review 一个虚拟列表实现，你会关注哪些点？

**参考答案：**

**正确性（先看这些，这些错了功能就有问题）**：

1. `key` 是否用稳定唯一标识（`item.id`），不是数组 `index`
2. `startIndex` 和 `endIndex` 是否有 `Math.max(0, ...)` / `Math.min(items.length, ...)` 边界保护
3. `totalHeight` 计算是否正确（有 gap 时要加上 `(items.length - 1) * gap`）
4. `offsetY` 是否正确对应 `startIndex`（用 `startIndex * itemHeight`，不是 `scrollTop`）
5. 不定高：`ResizeObserver` 是否在组件卸载时 `disconnect()`，避免内存泄漏

**性能（再看这些）**：

6. `scroll` 事件是否有 `rAF` 合帧，或至少有节流
7. 行组件是否 `React.memo`，`renderItem` / `getItemKey` 是否 `useCallback`（否则每次父更新都重渲染所有行）
8. 是否有 `passive: true` 的 touch 事件处理（移动端）
9. 图片是否固定 `width` / `height`，避免 layout shift

**工程质量（最后看）**：

10. 容器 resize 时是否更新 `height`（`ResizeObserver` 监听容器）
11. 不定高：`ResizeObserver` 回调是否有防无限循环（新旧高度相同时跳过重算）
12. 是否有 `aria-posinset` / `aria-setsize` 等无障碍属性
13. 是否处理了 `items` 为空数组的边界态

---

## 附录：追问链路速查

```
"你做过虚拟列表吗？"
  └─ 定高怎么算索引？（Q4）
       └─ overscan 是什么？（Q9）
            └─ 快速滚动会白屏吗？为什么？（Q8）
                 └─ rAF 合帧是什么原理？（Q10）
                      └─ 为什么不用 throttle？（Q10）
                           └─ 不定高怎么做？（Q12）
                                └─ 如何测量真实高度？（Q13）
                                     └─ 二分查找怎么写？（Q14）
                                          └─ offsets 重算是 O(n)，有更好的数据结构吗？（Q15）
                                               └─ Fenwick Tree 怎么用？（Q16）
                                                    └─ 数据 100 万条怎么办？（Q21）
```

---

> 参考答案基于 `react-virtual-list-demo` 项目、`虚拟滚动.md` 文档及中大厂面试考察角度整理。
