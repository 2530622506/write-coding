import http from 'node:http';
import { URL } from 'node:url';
import {
  createStorage,
  getMergedFile,
  listMergedFiles,
  listUploadedChunks,
  mergeChunks,
  saveChunkStream,
} from './storage.js';
import { readMultipartChunk, readRequestBody } from './multipart.js';

const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const storage = createStorage();

function sendJson(response, statusCode, payload) {
  // 示例允许前端开发服务器跨端口访问后端；生产环境应收紧 Origin 白名单。
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  // 合并接口只传元信息，限制 2 MB 足够，避免异常大 JSON 占用内存。
  const body = await readRequestBody(request, 2 * 1024 * 1024);
  if (body.length === 0) return {};

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 请求体格式不正确。'), { statusCode: 400 });
  }
}

function handleError(response, error) {
  // 5xx 错误不把内部堆栈返回给前端，避免泄漏服务端细节。
  const statusCode = error.statusCode || 500;
  const message = statusCode >= 500 ? '服务端处理失败，请稍后重试。' : error.message;

  if (statusCode >= 500) {
    console.error(error);
  }

  sendJson(response, statusCode, {
    ok: false,
    message,
    details: error.details,
  });
}

async function router(request, response) {
  if (request.method === 'OPTIONS') {
    // 处理浏览器 CORS 预检请求。
    sendJson(response, 204, {});
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, message: 'upload server is running' });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/upload/status') {
    // 断点续传查询：先看完整文件是否已存在，存在则直接返回秒传。
    const fileHash = requestUrl.searchParams.get('fileHash');
    const fileName = requestUrl.searchParams.get('fileName') || 'unknown-file';
    const suffix = requestUrl.searchParams.get('suffix') || fileName.split('.').at(-1) || 'bin';
    const existingFile = await getMergedFile(storage, { fileHash, suffix });

    if (existingFile) {
      sendJson(response, 200, {
        ok: true,
        shouldUpload: false,
        uploadedChunks: [],
        file: existingFile,
      });
      return;
    }

    const uploadedChunks = await listUploadedChunks(storage, fileHash);

    sendJson(response, 200, {
      ok: true,
      shouldUpload: true,
      uploadedChunks,
    });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/upload/chunk') {
    // 分片上传接口接收 multipart/form-data，Busboy 会把 chunk 文件流直接写入磁盘。
    const { result: uploadedChunks } = await readMultipartChunk(request, ({ fields, stream }) => {
      return saveChunkStream(storage, {
        fileHash: fields.fileHash,
        chunkIndex: fields.chunkIndex,
        stream,
      });
    });

    sendJson(response, 200, {
      ok: true,
      uploadedChunks,
    });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/upload/merge') {
    // 合并前会校验所有分片是否齐全，缺失时返回 409 和 missingChunks。
    const payload = await readJson(request);
    const file = await mergeChunks(storage, payload);

    sendJson(response, 200, {
      ok: true,
      file,
    });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/files') {
    // 用于前端展示已经合并完成的文件，方便验证上传结果。
    const files = await listMergedFiles(storage);
    sendJson(response, 200, { ok: true, files });
    return;
  }

  sendJson(response, 404, { ok: false, message: '接口不存在。' });
}

await storage.ensureReady();

const server = http.createServer((request, response) => {
  // 所有路由异常都在这里兜底，保证接口始终返回 JSON。
  router(request, response).catch((error) => handleError(response, error));
});

server.listen(PORT, () => {
  console.log(`Upload server: http://localhost:${PORT}`);
});
