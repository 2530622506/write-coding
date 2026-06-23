import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const STORAGE_ROOT = new URL('./storage/', import.meta.url);

const mergingFiles = new Set();

export function safeFileName(fileName) {
  // 只保留安全字符，避免用户文件名里带路径分隔符或特殊控制字符。
  const baseName = path.basename(fileName || 'unknown-file');
  return baseName.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

export function safeSuffix(suffix) {
  // 后缀只允许常见安全字符，避免把用户输入拼进最终路径时产生歧义。
  return String(suffix || 'bin').replace(/[^\w-]/g, '') || 'bin';
}

export function normalizeFileHash(fileHash) {
  // fileHash 由 spark-md5 计算得到，理论上是 32 位十六进制，这里仍做防御性清洗。
  const normalized = String(fileHash || '').replace(/[^\w.-]/g, '');
  if (!normalized) {
    throw Object.assign(new Error('缺少合法的 fileHash。'), { statusCode: 400 });
  }

  return normalized;
}

export function ensureInside(root, target) {
  // 防止 ../ 这类路径穿越输入把文件写到 storage 目录之外。
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('文件路径越界。'), { statusCode: 400 });
  }
}

export function createStorage(rootUrl = STORAGE_ROOT) {
  // import.meta.url 是 URL，不是文件路径；fileURLToPath 可以正确处理空格等转义字符。
  const root = rootUrl instanceof URL ? fileURLToPath(rootUrl) : rootUrl;
  const chunksRoot = path.join(root, 'chunks');
  const filesRoot = path.join(root, 'files');

  return {
    root,
    chunksRoot,
    filesRoot,
    async ensureReady() {
      // 启动时创建分片目录和最终文件目录。
      await mkdir(chunksRoot, { recursive: true });
      await mkdir(filesRoot, { recursive: true });
    },
    getChunkDir(fileHash) {
      // 每个内容 hash 对应一个独立分片目录，文件改名也不会影响断点续传。
      const normalized = normalizeFileHash(fileHash);
      const chunkDir = path.join(chunksRoot, normalized);
      ensureInside(chunksRoot, chunkDir);
      return chunkDir;
    },
    getFinalPath(fileHash, suffix) {
      // 最终文件名采用 hash + 后缀，用于支持秒传和同内容文件复用。
      const normalized = normalizeFileHash(fileHash);
      const finalPath = path.join(filesRoot, `${normalized}.${safeSuffix(suffix)}`);
      ensureInside(filesRoot, finalPath);
      return finalPath;
    },
    getMetadataPath(fileHash) {
      const normalized = normalizeFileHash(fileHash);
      const metadataPath = path.join(filesRoot, `${normalized}.json`);
      ensureInside(filesRoot, metadataPath);
      return metadataPath;
    },
  };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function parseChunkIndex(chunkIndex) {
  // chunkIndex 必须可排序，合并时才能按原始顺序恢复文件。
  const index = Number.parseInt(chunkIndex, 10);
  if (!Number.isInteger(index) || index < 0) {
    throw Object.assign(new Error('chunkIndex 必须是非负整数。'), { statusCode: 400 });
  }

  return index;
}

export async function readFileMetadata(storage, fileHash) {
  try {
    const metadata = await readFile(storage.getMetadataPath(fileHash), 'utf8');
    return JSON.parse(metadata);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

export async function getMergedFile(storage, { fileHash, suffix }) {
  await storage.ensureReady();
  const finalPath = storage.getFinalPath(fileHash, suffix);

  if (!(await pathExists(finalPath))) {
    return null;
  }

  const fileStat = await stat(finalPath);
  const metadata = await readFileMetadata(storage, fileHash);

  return {
    fileName: path.basename(finalPath),
    originalName: metadata?.originalName || path.basename(finalPath),
    fileHash: normalizeFileHash(fileHash),
    size: fileStat.size,
    updatedAt: fileStat.mtime.toISOString(),
  };
}

export async function listUploadedChunks(storage, fileHash) {
  const chunkDir = storage.getChunkDir(fileHash);

  try {
    // 分片文件名固定为 0.part、1.part，读取后转成数字下标。
    const entries = await readdir(chunkDir);
    return entries
      .filter((entry) => entry.endsWith('.part'))
      .map((entry) => Number.parseInt(entry, 10))
      .filter(Number.isInteger)
      .sort((left, right) => left - right);
  } catch (error) {
    // 分片目录不存在表示还没上传过任何分片，返回空数组即可。
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveChunk(storage, { fileHash, chunkIndex, buffer }) {
  const index = parseChunkIndex(chunkIndex);
  const chunkDir = storage.getChunkDir(fileHash);
  await mkdir(chunkDir, { recursive: true });
  // 同一分片重复上传时直接覆盖，便于失败重试和断点续传。
  await writeFile(path.join(chunkDir, `${index}.part`), buffer);

  return listUploadedChunks(storage, fileHash);
}

export async function saveChunkStream(storage, { fileHash, chunkIndex, stream }) {
  const index = parseChunkIndex(chunkIndex);
  const chunkDir = storage.getChunkDir(fileHash);
  await mkdir(chunkDir, { recursive: true });
  const chunkPath = path.join(chunkDir, `${index}.part`);
  ensureInside(chunkDir, chunkPath);
  // Busboy 已经给出文件流，这里直接管道写磁盘，避免把分片整体放进内存。
  await pipeline(stream, createWriteStream(chunkPath));

  return listUploadedChunks(storage, fileHash);
}

export async function mergeChunks(storage, { fileHash, fileName, suffix, totalChunks, totalSize }) {
  const normalizedHash = normalizeFileHash(fileHash);
  const count = Number.parseInt(totalChunks, 10);
  if (!Number.isInteger(count) || count <= 0) {
    throw Object.assign(new Error('totalChunks 必须是正整数。'), { statusCode: 400 });
  }

  const existingFile = await getMergedFile(storage, { fileHash: normalizedHash, suffix });
  if (existingFile) {
    // 幂等处理：如果最终文件已经存在，重复合并直接返回现有文件。
    return existingFile;
  }

  if (mergingFiles.has(normalizedHash)) {
    throw Object.assign(new Error('该文件正在合并中，请稍后刷新状态。'), { statusCode: 409 });
  }

  mergingFiles.add(normalizedHash);

  try {
    const chunkDir = storage.getChunkDir(normalizedHash);
    const uploadedChunks = await listUploadedChunks(storage, normalizedHash);
    const missingChunks = [];

    for (let index = 0; index < count; index += 1) {
      // 合并前先找出缺失分片，避免生成损坏文件。
      if (!uploadedChunks.includes(index)) {
        missingChunks.push(index);
      }
    }

    if (missingChunks.length > 0) {
      throw Object.assign(new Error(`还有 ${missingChunks.length} 个分片未上传。`), {
        statusCode: 409,
        details: { missingChunks },
      });
    }

    await storage.ensureReady();
    const finalPath = storage.getFinalPath(normalizedHash, suffix);
    const tempPath = `${finalPath}.tmp`;
    const output = createWriteStream(tempPath);

    // 按分片下标顺序串行写入，避免大文件一次性进入内存。
    for (let index = 0; index < count; index += 1) {
      await pipeline(createReadStream(path.join(chunkDir, `${index}.part`)), output, {
        end: false,
      });
    }

    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on('error', reject);
    });

    await rename(tempPath, finalPath);
    const fileStat = await stat(finalPath);
    const metadata = {
      fileHash: normalizedHash,
      originalName: safeFileName(fileName),
      suffix: safeSuffix(suffix),
      size: Number.parseInt(totalSize, 10) || fileStat.size,
      updatedAt: fileStat.mtime.toISOString(),
    };
    await writeFile(storage.getMetadataPath(normalizedHash), JSON.stringify(metadata, null, 2), 'utf8');
    // 合并成功后清理临时分片目录，减少磁盘占用。
    await rm(chunkDir, { recursive: true, force: true });

    return {
      fileName: path.basename(finalPath),
      originalName: metadata.originalName,
      fileHash: normalizedHash,
      size: fileStat.size,
      updatedAt: fileStat.mtime.toISOString(),
    };
  } finally {
    mergingFiles.delete(normalizedHash);
  }
}

export async function listMergedFiles(storage) {
  await storage.ensureReady();
  const entries = await readdir(storage.filesRoot);
  const fileEntries = entries.filter((entry) => !entry.endsWith('.json') && !entry.endsWith('.tmp'));
  const files = await Promise.all(
    fileEntries.map(async (entry) => {
      // stat 用于返回文件大小和更新时间，前端文件列表直接展示这些信息。
      const filePath = path.join(storage.filesRoot, entry);
      const fileStat = await stat(filePath);
      const fileHash = entry.split('.').slice(0, -1).join('.') || entry;
      const metadata = await readFileMetadata(storage, fileHash);

      return {
        fileName: entry,
        originalName: metadata?.originalName || entry,
        fileHash,
        size: fileStat.size,
        updatedAt: fileStat.mtime.toISOString(),
      };
    }),
  );

  return files.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}
