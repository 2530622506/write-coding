# React 工程化实验合集

这个仓库用于沉淀 React 前端工程中的典型能力实现，目前包含两个独立示例：

- `large-file-upload-demo`：大文件分片上传、秒传、断点续传、暂停继续和失败重试。
- `react-virtual-list-demo`：大数据列表虚拟滚动，覆盖定高、不定高和 Canvas 绘制方案。

每个示例都可以独立安装依赖、启动和验证。

## 项目结构

```text
.
├── large-file-upload-demo       # React + Vite + Node 原生 HTTP 的大文件上传示例
└── react-virtual-list-demo      # React + Vite 的虚拟滚动示例
```

## 大文件分片上传示例

示例工程位于：

```bash
large-file-upload-demo
```

这是一个前后端完整示例：前端使用 React + Vite，后端使用 Node 原生 HTTP 模块。它演示了大文件上传常见的内容 hash、秒传、分片上传、断点续传、暂停继续、失败重试和服务端合并流程。

### 运行方式

```bash
cd large-file-upload-demo
npm install
npm run dev
```

默认地址：

- 前端：`http://localhost:5175`
- 后端：`http://localhost:3001`

也可以分开启动：

```bash
npm run dev:server
npm run dev:client
```

如果 `3001` 被占用，可以切换后端端口，并让 Vite 代理到新端口：

```bash
PORT=3002 npm run dev:server
VITE_API_TARGET=http://localhost:3002 npm run dev:client
```

如果 `5175` 被占用，Vite 会自动切换到其他端口，以终端输出为准。

### 已实现能力

- 前端按 2 MB 固定大小切分文件分片。
- 使用 Web Worker + `spark-md5` 计算文件内容 hash，避免阻塞主线程。
- 上传前调用 `/api/upload/status` 查询完整文件和已上传分片。
- 服务端已有相同 hash 文件时直接秒传。
- 服务端已有部分分片时只补传缺失分片。
- 支持 1-6 个分片并发上传，页面可调节并发数。
- 支持暂停当前上传请求，继续时复用服务端已保存分片。
- 使用 `XMLHttpRequest` 展示实时上传进度。
- 单个分片失败后最多自动重试 3 次，并带短暂退避。
- 页面展示每个分片的上传状态和重试次数。
- 后端使用 `Busboy` 流式保存分片，避免把分片请求整体读入内存。
- 所有分片上传完成后，后端按分片下标顺序流式合并文件。
- 页面展示上传进度、速度、分片数量、已上传容量和服务端已合并文件列表。
- 前端对空响应、非 JSON 响应和代理失败做了可读错误提示，便于定位后端服务不可用问题。

### 核心流程

```text
选择文件
  ↓
按 2 MB 生成分片队列
  ↓
Web Worker 计算文件 hash
  ↓
查询服务端上传状态
  ↓
秒传 / 跳过已存在分片 / 上传缺失分片
  ↓
分片失败自动重试
  ↓
所有分片齐全后通知后端合并
  ↓
刷新已合并文件列表
```

### 后端接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/upload/status` | 查询完整文件是否存在，以及已上传分片 |
| `POST` | `/api/upload/chunk` | 流式保存单个分片 |
| `POST` | `/api/upload/merge` | 校验分片完整性并合并文件 |
| `GET` | `/api/files` | 查询已合并文件列表 |

### 测试断点续传和失败重试

- 暂停继续：上传大文件时点击暂停，再点击继续，观察已完成分片是否保持 `skipped` / `success`，只补传剩余分片。
- 刷新页面续传：上传一部分后刷新页面，重新选择同一文件并上传，观察是否先查询服务端已存在分片。
- 断网恢复：在浏览器 DevTools 的 Network 面板切换 `Offline`，恢复网络后重新上传，观察失败分片是否重试或可继续。
- 后端中断：上传中停止后端服务，再重新启动后端，检查前端是否展示明确错误，并在重新上传时复用已落盘分片。
- 分片重试：使用弱网、代理工具或临时让接口失败，观察单个分片是否最多重试 3 次。

### 核心文件

- `large-file-upload-demo/src/App.tsx`：页面状态、上传队列、暂停继续、进度、重试和错误处理。
- `large-file-upload-demo/src/workers/hashWorker.ts`：后台计算文件内容 hash。
- `large-file-upload-demo/server/index.js`：Node HTTP 路由和接口响应。
- `large-file-upload-demo/server/storage.js`：分片保存、秒传判断、路径安全、合并锁和文件合并。
- `large-file-upload-demo/server/multipart.js`：`Busboy` 流式解析 `multipart/form-data`。
- `large-file-upload-demo/docs/large-file-upload-implementation.md`：完整实现说明。

### 验证命令

```bash
cd large-file-upload-demo
npm run test
npm run typecheck
npm run build
```

## React 虚拟滚动实验项目

示例工程位于：

```bash
react-virtual-list-demo
```

这个示例围绕商品列表展开，用于验证和对比大数据列表在 React 中的几种渲染方案，覆盖定高虚拟滚动、不定高虚拟滚动和 Canvas 虚拟滚动。

### 运行方式

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

### 已实现能力

- 模拟接口加载 10,000 条商品数据，包含 loading、error、retry 状态。
- 定高虚拟滚动：基于 `scrollTop`、固定行高、总高度占位和 `translateY` 偏移。
- 不定高虚拟滚动：基于预估高度、`ResizeObserver` 实测高度缓存、offsets 前缀和和二分查找。
- Canvas 虚拟滚动：使用单个 `canvas` 绘制可视商品行，用于观察弱交互大数据列表的性能上限。
- 滚动优化：使用 `requestAnimationFrame` 合并高频 scroll 更新，减少快速滚动时的 React state 提交压力。
- 商品行包含图片、标题、摘要、价格、状态、标签、店铺和操作按钮。
- 支持搜索过滤，并保留可访问性标签和基础响应式布局。

### 核心文件

- `react-virtual-list-demo/src/components/FixedSizeVirtualList.tsx`：定高虚拟滚动组件。
- `react-virtual-list-demo/src/components/VariableSizeVirtualList.tsx`：不定高虚拟滚动组件。
- `react-virtual-list-demo/src/components/CanvasVirtualList.tsx`：Canvas 虚拟滚动组件。
- `react-virtual-list-demo/src/data/products.ts`：模拟商品数据和接口。
- `react-virtual-list-demo/docs/virtual-list-implementation.md`：实现思路、优化策略、Canvas 对比、简历写法和面试问答。

### 技术要点

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

### 适用场景

优先选择 DOM 虚拟滚动：

- 商品列表、管理后台、订单列表、评论列表等复杂交互场景。
- 需要按钮、链接、键盘焦点、文本选择和无障碍语义。

可以考虑 Canvas：

- 行情、监控日志、热力图、弱交互超大列表。
- 更关注绘制性能，交互和可访问性要求较低。

### 验证命令

```bash
cd react-virtual-list-demo
npx tsc --noEmit
npm run build
```
