import busboy from 'busboy';

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');

export class MultipartError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'MultipartError';
    this.statusCode = statusCode;
  }
}

export function readRequestBody(request, maxBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on('data', (chunk) => {
      // 示例后端先把单个分片读入内存，必须限制单片大小，避免请求体过大。
      total += chunk.length;
      if (total > maxBytes) {
        reject(new MultipartError('单个分片超过服务端限制，请调小前端 chunkSize。', 413));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function readMultipartChunk(request, onChunk) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const bb = busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fileSize: 64 * 1024 * 1024,
      },
    });
    let uploadPromise = null;

    bb.on('field', (name, value) => {
      // FormData 会先追加元信息再追加 chunk 文件，这里收集 fileHash、chunkIndex 等字段。
      fields[name] = value;
    });

    bb.on('file', (name, stream) => {
      if (name !== 'chunk') {
        stream.resume();
        return;
      }

      if (!fields.fileHash || fields.chunkIndex === undefined) {
        stream.resume();
        reject(new MultipartError('缺少 fileHash 或 chunkIndex 字段。'));
        return;
      }

      // 直接把文件流交给存储层写入磁盘，避免先聚合成 Buffer。
      uploadPromise = onChunk({ fields, stream });
      uploadPromise.catch(reject);
    });

    bb.on('filesLimit', () => {
      reject(new MultipartError('一次只能上传一个分片文件。', 413));
    });

    bb.on('error', reject);
    bb.on('finish', async () => {
      try {
        if (!uploadPromise) {
          throw new MultipartError('缺少 chunk 文件字段。');
        }

        const result = await uploadPromise;
        resolve({ fields, result });
      } catch (error) {
        reject(error);
      }
    });

    request.pipe(bb);
  });
}

function getBoundary(contentType) {
  // multipart/form-data 依靠 boundary 分隔字段和文件内容。
  const boundary = contentType
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('boundary='));

  if (!boundary) {
    throw new MultipartError('缺少 multipart boundary。');
  }

  return boundary.slice('boundary='.length);
}

function parseDisposition(value) {
  // Content-Disposition 中包含字段名 name 和文件名 filename。
  const result = {};
  const parts = value.split(';').map((part) => part.trim());

  for (const part of parts.slice(1)) {
    const [key, rawValue] = part.split('=');
    if (!key || rawValue === undefined) continue;
    result[key] = rawValue.replace(/^"|"$/g, '');
  }

  return result;
}

function parseHeaders(headerText) {
  // 每个 multipart part 都有自己的头部，这里统一转成小写 key。
  const headers = {};

  for (const line of headerText.split('\r\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    headers[key] = line.slice(separatorIndex + 1).trim();
  }

  return headers;
}

export function parseMultipartFormData(contentType, body) {
  if (!contentType.includes('multipart/form-data')) {
    throw new MultipartError('请求类型必须是 multipart/form-data。');
  }

  const boundary = getBoundary(contentType);
  // 第一个 boundary 前面没有 CRLF，后续 boundary 都带有 \r\n 前缀。
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const boundaryWithPrefix = Buffer.from(`\r\n--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = body.indexOf(boundaryBuffer);

  if (cursor === -1) {
    throw new MultipartError('没有找到 multipart 数据边界。');
  }

  cursor += boundaryBuffer.length;

  while (cursor < body.length) {
    // boundary 后紧跟 -- 表示整个 multipart 消息结束。
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (body.subarray(cursor, cursor + CRLF.length).equals(CRLF)) {
      cursor += CRLF.length;
    }

    const headerEnd = body.indexOf(HEADER_END, cursor);
    if (headerEnd === -1) break;

    const headers = parseHeaders(body.subarray(cursor, headerEnd).toString('utf8'));
    const dataStart = headerEnd + HEADER_END.length;
    // 当前 part 的内容一直到下一个 boundary 之前。
    const dataEnd = body.indexOf(boundaryWithPrefix, dataStart);

    if (dataEnd === -1) break;

    const disposition = headers['content-disposition'];
    if (disposition) {
      const meta = parseDisposition(disposition);
      const data = body.subarray(dataStart, dataEnd);

      if (meta.filename) {
        // 有 filename 的 part 视为文件字段，保留 Buffer 给存储层写入磁盘。
        files[meta.name] = {
          filename: meta.filename,
          contentType: headers['content-type'] || 'application/octet-stream',
          buffer: data,
        };
      } else if (meta.name) {
        // 普通表单字段转成字符串，例如 fileId、chunkIndex、totalChunks。
        fields[meta.name] = data.toString('utf8');
      }
    }

    cursor = dataEnd + boundaryWithPrefix.length;
  }

  return { fields, files };
}
