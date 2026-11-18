---
title: "Debug Notes"
readMode: optional
priority: medium
category: debug
keywords:
  - debug
  - issue
  - workaround
  - root-cause
  - gotcha
---

# Debug Notes

## Entries



<spec-entry category="debug" keywords="node-esm,fileurltopath,import-meta-url,path-encoding" date="2026-06-22" source="large-file-upload-demo/server/storage.js">

### Node ESM 本地路径应使用 fileURLToPath

在 Node ESM 中，不要直接使用 import.meta.url.pathname 作为本地文件系统路径；当项目路径包含空格等字符时，pathname 会保留 URL 编码（例如 %20），可能导致 mkdir/read/write 指向错误目录。应使用 fileURLToPath(import.meta.url 或目录 URL) 转成真实文件路径，再交给 path.join、fs/promises 等文件系统 API。

</spec-entry>