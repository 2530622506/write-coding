# 大文件分片上传示例

这是一个前后端完整示例：前端使用 React + Vite，后端使用 Node 原生 HTTP 模块。它演示了大文件上传常见的内容 hash、秒传、分片上传、断点续传、暂停继续、失败重试和服务端合并流程。

## 运行方式

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

## 验证命令

```bash
npm run test
npm run typecheck
npm run build
```

## 已实现能力

- 前端把文件按 2 MB 切成多个分片。
- 使用 Web Worker + `spark-md5` 计算文件内容 hash。
- 服务端已有相同 hash 文件时直接秒传。
- 上传前先查询服务端已有分片，只补传缺失分片。
- 支持 1-6 个分片并发上传，页面可调节并发数。
- 支持暂停当前上传请求，继续时复用服务端已保存分片。
- 使用 `XMLHttpRequest` 展示实时上传进度。
- 单个分片失败后最多自动重试 3 次。
- 页面展示每个分片的上传状态和重试次数。
- 后端使用 `Busboy` 流式保存分片，避免把分片请求整体读入内存。
- 所有分片上传完成后，后端按顺序流式合并文件。
- 页面展示上传进度、速度、分片数量、已上传容量和服务端已合并文件列表。

## 核心文档

实现细节见：

```bash
docs/large-file-upload-implementation.md
```
