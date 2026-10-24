import { Readable } from 'node:stream';
import { S3Client, CreateBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import path from 'node:path';

// 仅用于阻止当前 Node.js 进程内对同一文件重复合并；多实例部署需改用分布式锁。
const mergingFiles = new Set();

// 文件名只用于展示和对象 metadata，不直接作为对象 key。
export function safeFileName(fileName) {
  return path.basename(fileName || 'unknown-file').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

// 限制后缀字符，避免未经清理的输入进入最终对象 key。
export function safeSuffix(suffix) {
  return String(suffix || 'bin').replace(/[^\w-]/g, '') || 'bin';
}

// 清理客户端传入的文件 hash，供分片前缀和最终对象 key 共用。
export function normalizeFileHash(fileHash) {
  const normalized = String(fileHash || '').replace(/[^\w.-]/g, '');
  if (!normalized) throw Object.assign(new Error('缺少合法的 fileHash。'), { statusCode: 400 });
  return normalized;
}

function parseChunkIndex(chunkIndex) {
  const index = Number.parseInt(chunkIndex, 10);
  if (!Number.isInteger(index) || index < 0) {
    throw Object.assign(new Error('chunkIndex 必须是非负整数。'), { statusCode: 400 });
  }
  return index;
}

function isNotFound(error) {
  return error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}

// 最终文件统一放在 bucket 的 files 前缀下，并以内容 hash 命名。
function objectKey(hash, suffix) {
  return `files/${normalizeFileHash(hash)}.${safeSuffix(suffix)}`;
}


// 创建 S3 兼容存储适配器；RustFS 凭据只在后端环境变量中读取。
export function createStorage({
  client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || process.env.RUSTFS_ENDPOINT || `http://localhost:${process.env.S3_PORT || 9000}`,
    region: process.env.RUSTFS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.RUSTFS_ACCESS_KEY || 'rustfsadmin',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.RUSTFS_SECRET_KEY || 'rustfsadmin',
    },
    forcePathStyle: true,
  }),
  bucket = process.env.S3_BUCKET || process.env.RUSTFS_BUCKET || 'large-file-upload',
  publicBaseUrl = process.env.S3_PUBLIC_URL || process.env.RUSTFS_PUBLIC_URL || process.env.S3_ENDPOINT || process.env.RUSTFS_ENDPOINT || `http://localhost:${process.env.S3_PORT || 9000}`,
  uploader = (params) => new Upload({ client, params, partSize: 5 * 1024 * 1024, queueSize: 2 }).done(),
} = {}) {
  const baseUrl = publicBaseUrl.replace(/\/$/, '');

  return {
    client,
    bucket,
    publicBaseUrl: baseUrl,
    uploader,
    // 启动时探测 bucket，不存在时创建；其他连接或权限错误向上抛出。
    async ensureReady() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchBucket') throw error;
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (createError) {
          if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists|already exists/i.test(createError?.message || '')) throw createError;
        }
      }
    },
    // 同一文件的应用层分片集中在一个对象 key 前缀下，便于断点续传查询。
    chunkPrefix(fileHash) {
      return `chunks/${normalizeFileHash(fileHash)}/`;
    },
    chunkKey(fileHash, chunkIndex) {
      return `${this.chunkPrefix(fileHash)}${parseChunkIndex(chunkIndex)}.part`;
    },
    finalKey(fileHash, suffix) {
      return objectKey(fileHash, suffix);
    },
  };
}

// 分页列出 RustFS 中已存在的分片对象，并解析出已完成的分片编号。
export async function listUploadedChunks(storage, fileHash) {
  const prefix = storage.chunkPrefix(fileHash);
  const indexes = [];
  let continuationToken;
  do {
    const result = await storage.client.send(new ListObjectsV2Command({
      Bucket: storage.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of result.Contents || []) {
      const match = item.Key?.slice(prefix.length).match(/^(\d+)\.part$/);
      if (match) indexes.push(Number(match[1]));
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return [...new Set(indexes)].sort((a, b) => a - b);
}

// Buffer 版本主要用于测试或小分片；正常 HTTP 上传使用下面的流式版本。
export async function saveChunk(storage, { fileHash, chunkIndex, buffer }) {
  const index = parseChunkIndex(chunkIndex);
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: storage.chunkKey(fileHash, index),
    Body: buffer,
    ContentLength: buffer.length,
  }));
  return listUploadedChunks(storage, fileHash);
}

// 将 Busboy 提供的请求流直接交给 S3 Upload，避免在应用层缓存整个分片。
export async function saveChunkStream(storage, { fileHash, chunkIndex, stream }) {
  const key = storage.chunkKey(fileHash, chunkIndex);
  // lib-storage handles unknown-length streams; each browser chunk is bounded (2 MB by default).
  await storage.uploader({ Bucket: storage.bucket, Key: key, Body: stream, ContentType: 'application/octet-stream' });
  return listUploadedChunks(storage, fileHash);
}

// 使用 HeadObject 判断最终对象是否存在，并从对象 metadata 还原展示信息。
export async function getMergedFile(storage, { fileHash, suffix }) {
  const key = storage.finalKey(fileHash, suffix);
  let head;
  try {
    head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const encodedName = head.Metadata?.originalname;
  let originalName = path.basename(key);
  if (encodedName) {
    try { originalName = decodeURIComponent(encodedName); } catch { originalName = encodedName; }
  }
  return {
    fileName: path.basename(key),
    originalName,
    fileHash: normalizeFileHash(fileHash),
    size: head.ContentLength || 0,
    updatedAt: head.LastModified?.toISOString() || new Date().toISOString(),
    url: `${storage.publicBaseUrl}/${storage.bucket}/${key}`,
  };
}

// 删除合并完成后的应用层分片对象；按页清理以支持较多分片。
async function deleteChunkObjects(storage, fileHash) {
  const prefix = storage.chunkPrefix(fileHash);
  let continuationToken;
  do {
    const page = await storage.client.send(new ListObjectsV2Command({
      Bucket: storage.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (page.Contents || []).filter((item) => item.Key).map(({ Key }) => ({ Key }));
    if (objects.length) {
      await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects, Quiet: true } }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

// 校验分片齐全后按编号串流读取，再上传最终对象；不在 Node 本地拼接文件。
export async function mergeChunks(storage, { fileHash, fileName, suffix, totalChunks, totalSize }) {
  const hash = normalizeFileHash(fileHash);
  const count = Number.parseInt(totalChunks, 10);
  if (!Number.isInteger(count) || count <= 0) throw Object.assign(new Error('totalChunks 必须是正整数。'), { statusCode: 400 });
  const existing = await getMergedFile(storage, { fileHash: hash, suffix });
  if (existing) {
    if (totalSize && Number(totalSize) !== existing.size) {
      throw Object.assign(new Error('合并后的文件大小与上传声明不一致。'), { statusCode: 422 });
    }
    // 上次合并可能在写完最终对象后、清理分片前中断；重试时补做清理。
    await deleteChunkObjects(storage, hash);
    return existing;
  }
  if (mergingFiles.has(hash)) throw Object.assign(new Error('该文件正在合并中，请稍后刷新状态。'), { statusCode: 409 });
  mergingFiles.add(hash);

  try {
    const uploaded = new Set(await listUploadedChunks(storage, hash));
    const missingChunks = Array.from({ length: count }, (_, index) => index).filter((index) => !uploaded.has(index));
    if (missingChunks.length) {
      throw Object.assign(new Error(`还有 ${missingChunks.length} 个分片未上传。`), {
        statusCode: 409,
        details: { missingChunks },
      });
    }

    // 逐片读取对象并依次产出数据块，形成最终对象的输入流。
    const body = Readable.from((async function* streamChunks() {
      for (let index = 0; index < count; index += 1) {
        const response = await storage.client.send(new GetObjectCommand({
          Bucket: storage.bucket,
          Key: storage.chunkKey(hash, index),
        }));
        if (!response.Body) throw new Error(`RustFS 分片为空：${index}`);
        for await (const part of response.Body) yield part;
      }
    })());
    const key = storage.finalKey(hash, suffix);
    const originalName = safeFileName(fileName);
    const encodedName = encodeURIComponent(originalName);
    await storage.uploader({
      Bucket: storage.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
      Metadata: { filehash: hash, originalname: encodedName },
    });

    const file = await getMergedFile(storage, { fileHash: hash, suffix });
    if (!file) throw new Error('文件已上传，但无法从 RustFS 读取对象元数据。');
    if (totalSize && Number(totalSize) !== file.size) {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
      throw Object.assign(new Error('合并后的文件大小与上传声明不一致。'), { statusCode: 422 });
    }
    // 只有最终对象写入且大小校验通过后，才清理可续传用的分片对象。
    await deleteChunkObjects(storage, hash);
    return file;
  } finally {
    mergingFiles.delete(hash);
  }
}

// 分页列出最终对象，并读取 metadata 供前端文件列表展示。
export async function listMergedFiles(storage) {
  const files = [];
  let continuationToken;
  do {
    const page = await storage.client.send(new ListObjectsV2Command({
      Bucket: storage.bucket,
      Prefix: 'files/',
      ContinuationToken: continuationToken,
    }));
    for (const item of page.Contents || []) {
      if (!item.Key) continue;
      try {
        const head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: item.Key }));
        let originalName = path.basename(item.Key);
        if (head.Metadata?.originalname) {
          try { originalName = decodeURIComponent(head.Metadata.originalname); } catch { originalName = head.Metadata.originalname; }
        }
        files.push({
          fileName: path.basename(item.Key),
          originalName,
          fileHash: head.Metadata?.filehash || path.basename(item.Key).split('.')[0],
          size: item.Size || 0,
          updatedAt: item.LastModified?.toISOString() || new Date().toISOString(),
          url: `${storage.publicBaseUrl}/${storage.bucket}/${item.Key}`,
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return files.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}
