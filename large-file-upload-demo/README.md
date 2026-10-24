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

## RustFS（Docker）

如果已有 RustFS 服务，复制 `.env.example` 为 `.env` 并按实际配置修改即可。需要单独使用 Docker 启动时：

```bash
cp .env.example .env
docker compose up -d rustfs
```

Node 后端从 `.env` 读取 `S3_ENDPOINT`、`S3_PORT`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 和 `S3_BUCKET`，并在启动时检查或创建 bucket。分片对象位于 `chunks/{fileHash}/{index}.part`，完成文件位于 `files/{fileHash}.{suffix}`。Docker named volume 持久化 RustFS 数据。

`.env` 不会提交到 Git。示例凭据仅用于本地演示，生产部署请设置强密钥并限制 RustFS 网络访问。

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
- 后端使用 `Busboy` 接收分片，并将分片对象存入 RustFS（S3 兼容对象存储）。
- 所有分片上传完成后，后端按顺序从 RustFS 流式读取并上传合并对象，成功后清理分片对象。
- 页面展示上传进度、速度、分片数量、已上传容量和服务端已合并文件列表。

## 核心文档

实现细节见：

```bash
docs/large-file-upload-implementation.md
```
