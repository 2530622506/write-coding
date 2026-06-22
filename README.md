# React 虚拟滚动实验项目

这个仓库用于验证和对比大数据列表在 React 中的几种渲染方案，当前示例围绕商品列表展开，覆盖定高虚拟滚动、不定高虚拟滚动和 Canvas 虚拟滚动。

## 项目入口

示例工程位于：

```bash
react-virtual-list-demo
```

运行方式：

```bash
cd react-virtual-list-demo
npm install
npm run dev
```

启动后访问：

- `http://localhost:5174/`：定高 DOM 虚拟滚动。
- `http://localhost:5174/variable`：不定高 DOM 虚拟滚动。
- `http://localhost:5174/canvas`：Canvas 虚拟滚动对比版本。

如果本地端口被占用，Vite 会自动切换到其他端口，以终端输出为准。

## 已实现能力

- 模拟接口加载 10,000 条商品数据，包含 loading、error、retry 状态。
- 定高虚拟滚动：基于 `scrollTop`、固定行高、总高度占位和 `translateY` 偏移。
- 不定高虚拟滚动：基于预估高度、`ResizeObserver` 实测高度缓存、offsets 前缀和和二分查找。
- Canvas 虚拟滚动：使用单个 `canvas` 绘制可视商品行，用于观察弱交互大数据列表的性能上限。
- 滚动优化：使用 `requestAnimationFrame` 合并高频 scroll 更新，减少快速滚动时的 React state 提交压力。
- 商品行包含图片、标题、摘要、价格、状态、标签、店铺和操作按钮。
- 支持搜索过滤，并保留可访问性标签和基础响应式布局。

## 核心文件

- `react-virtual-list-demo/src/components/FixedSizeVirtualList.tsx`：定高虚拟滚动组件。
- `react-virtual-list-demo/src/components/VariableSizeVirtualList.tsx`：不定高虚拟滚动组件。
- `react-virtual-list-demo/src/components/CanvasVirtualList.tsx`：Canvas 虚拟滚动组件。
- `react-virtual-list-demo/src/data/products.ts`：模拟商品数据和接口。
- `react-virtual-list-demo/docs/virtual-list-implementation.md`：实现思路、优化策略、Canvas 对比、简历写法和面试问答。

## 技术要点

定高列表的关键是用固定公式从滚动位置推导索引：

```ts
const startIndex = Math.floor(scrollTop / itemHeight);
const offsetY = startIndex * itemHeight;
```

不定高列表不能直接使用固定公式，需要维护每一行的累计高度：

```ts
offsets[index + 1] = offsets[index] + measuredHeight;
```

Canvas 版本不创建每一行 DOM，而是在同一块画布上重绘当前可视内容：

```ts
ctx.clearRect(0, 0, width, height);
ctx.drawImage(image, x, y, w, h);
ctx.fillText(title, x, y);
```

## 适用场景

优先选择 DOM 虚拟滚动：

- 商品列表、管理后台、订单列表、评论列表等复杂交互场景。
- 需要按钮、链接、键盘焦点、文本选择和无障碍语义。

可以考虑 Canvas：

- 行情、监控日志、热力图、弱交互超大列表。
- 更关注绘制性能，交互和可访问性要求较低。

## 验证命令

```bash
cd react-virtual-list-demo
npx tsc --noEmit
npm run build
```
