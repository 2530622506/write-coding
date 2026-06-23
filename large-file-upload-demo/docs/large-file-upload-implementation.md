# 大文件上传实现说明

## 整体思路

这个示例参考常见的大文件断点续传方案：前端用 `File.prototype.slice()` 把文件拆成多个固定大小分片，用 `spark-md5` 在 Web Worker 中计算文件内容 hash，再把 hash 作为文件唯一标识。上传前先询问服务端完整文件是否已存在；如果存在则直接秒传，否则只上传服务端缺失的分片。所有分片齐全后，后端按分片下标顺序合并成最终文件。

## 前端实现

核心文件：

- `src/App.tsx`：页面状态、hash 计算、上传队列、暂停继续、进度和分片状态。
- `src/workers/hashWorker.ts`：后台计算文件内容 hash。
- `src/types/spark-md5.d.ts`：补充 `spark-md5` 类型声明。

前端流程：

1. 选择文件后，按 2 MB 生成分片队列。
2. 点击上传时，把文件发送给 Web Worker，逐片读取并计算 MD5 hash。
3. 计算完成后，请求 `/api/upload/status` 查询是否可以秒传，以及已经存在的分片下标。
4. 如果 `shouldUpload=false`，直接显示完成，不再上传分片。
5. 如果需要上传，过滤已存在分片，只上传缺失分片。
6. 分片上传使用 `XMLHttpRequest`，通过 `xhr.upload.onprogress` 获取实时上传进度。
7. 分片失败后最多重试 3 次，并用短暂退避避免立即反复打爆连接。
8. 上传中可以暂停，暂停时调用 `xhr.abort()` 终止当前请求。
9. 分片全部上传完成后，调用 `/api/upload/merge` 通知后端合并。
10. 页面用分片状态列表展示 `pending`、`uploading`、`retrying`、`success`、`failed`、`skipped`。
11. `localStorage` 记录最近一次文件 hash、文件名、大小和分片数量。刷新后用户重新选择同一文件，可以识别续传记录。

## 后端实现

核心文件：

- `server/index.js`：HTTP 路由和接口响应。
- `server/storage.js`：hash 存储、秒传判断、分片保存、路径安全、合并锁和文件合并。
- `server/multipart.js`：`Busboy` 流式解析 `multipart/form-data`。

接口说明：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/upload/status` | 查询完整文件是否存在，以及已上传分片 |
| `POST` | `/api/upload/chunk` | 流式保存单个分片 |
| `POST` | `/api/upload/merge` | 校验分片完整性并合并文件 |
| `GET` | `/api/files` | 查询已合并文件列表 |
| `GET` | `/api/health` | 健康检查 |

`/api/upload/status` 返回示例：

```json
{
  "ok": true,
  "shouldUpload": true,
  "uploadedChunks": [0, 1]
}
```

如果服务端已经存在同 hash 文件：

```json
{
  "ok": true,
  "shouldUpload": false,
  "uploadedChunks": [],
  "file": {
    "fileName": "4d186321c1a7f0f354b297e8914ab240.zip",
    "originalName": "demo.zip",
    "fileHash": "4d186321c1a7f0f354b297e8914ab240",
    "size": 10485760,
    "updatedAt": "2026-06-22T09:00:00.000Z"
  }
}
```

## 后端存储结构

```text
server/storage/
  chunks/
    <fileHash>/
      0.part
      1.part
      2.part
  files/
    <fileHash>.<suffix>
    <fileHash>.json
```

`<fileHash>.json` 保存原始文件名、hash、大小和更新时间，用于前端文件列表展示。

## 秒传为什么可行

文件 hash 由文件内容决定，不依赖文件名或修改时间。只要服务端已经存在相同 hash 的最终文件，前端即使重新选择了改名后的同内容文件，也能通过 `/api/upload/status` 得到 `shouldUpload=false`，从而直接完成秒传。

## 断点续传为什么可行

每个分片都由 `fileHash + chunkIndex` 唯一定位。服务端保存分片后，前端可以随时查询已存在的分片下标。用户暂停、网络失败或刷新页面后，只要重新选择同一文件并重新计算出同一个 hash，就能继续补传缺失分片。

## 流式上传和合并

分片上传接口用 `Busboy` 解析 `multipart/form-data`。`chunk` 文件字段不会先聚合成完整 Buffer，而是直接通过 `pipeline(stream, createWriteStream(...))` 写入磁盘。

合并时使用 `createReadStream()` 和 `createWriteStream()`，按下标顺序逐个把 `.part` 文件写入 `.tmp` 文件。全部写入成功后再 `rename()` 成最终文件，避免中途失败留下损坏的最终文件。同一个 hash 合并时会放入内存锁，避免重复合并互相干扰。

## 路径安全处理

后端没有直接信任前端传来的文件名和 hash：

- `safeFileName()` 清洗原始文件名。
- `safeSuffix()` 清洗文件后缀。
- `normalizeFileHash()` 清洗 hash。
- `ensureInside()` 确认分片目录、最终文件和 metadata 都没有逃出存储根目录。

这些处理可以避免 `../` 这类路径穿越输入影响本地文件系统。

## 仍可继续优化

- 增加数据库记录文件、用户、上传状态和过期时间。
- 给临时分片目录增加定时清理任务，避免长期占用磁盘。
- 上传到对象存储时改用 S3 Multipart Upload 或 OSS Multipart Upload。
- 大量并发用户场景下，把合并锁从内存迁移到 Redis 或数据库锁。
