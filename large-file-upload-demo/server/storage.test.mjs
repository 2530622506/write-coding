import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createStorage,
  ensureInside,
  getMergedFile,
  listUploadedChunks,
  mergeChunks,
  safeFileName,
  saveChunk,
  saveChunkStream,
} from './storage.js';

test('safeFileName 保留中文、英文、数字和常见文件符号', () => {
  // 覆盖文件名清洗逻辑，避免路径片段和特殊字符原样进入存储路径。
  assert.equal(safeFileName('../测试 文件?.zip'), '测试_文件_.zip');
});

test('ensureInside 阻止路径逃逸', () => {
  // 路径安全是上传服务的底线，必须阻止目标文件逃出 storage 根目录。
  const root = path.join(os.tmpdir(), 'upload-root');
  assert.doesNotThrow(() => ensureInside(root, path.join(root, 'a.txt')));
  assert.throws(() => ensureInside(root, path.join(root, '../a.txt')), /文件路径越界/);
});

test('saveChunkStream 可以流式保存分片', async () => {
  // Busboy 传入的是 stream，存储层应直接写磁盘而不是先聚合成 Buffer。
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'upload-demo-'));
  const storage = createStorage(tempDir);

  try {
    await storage.ensureReady();
    await saveChunkStream(storage, {
      fileHash: 'hash-stream',
      chunkIndex: '0',
      stream: Readable.from(Buffer.from('stream chunk')),
    });

    assert.deepEqual(await listUploadedChunks(storage, 'hash-stream'), [0]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('saveChunk 和 mergeChunks 可以按下标合并文件并写入 metadata', async () => {
  // 先乱序保存分片，再校验合并后能按下标恢复原始内容。
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'upload-demo-'));
  const storage = createStorage(tempDir);

  try {
    await storage.ensureReady();
    await saveChunk(storage, { fileHash: 'filehash1', chunkIndex: '1', buffer: Buffer.from('world') });
    await saveChunk(storage, { fileHash: 'filehash1', chunkIndex: '0', buffer: Buffer.from('hello ') });

    assert.deepEqual(await listUploadedChunks(storage, 'filehash1'), [0, 1]);

    const file = await mergeChunks(storage, {
      fileHash: 'filehash1',
      fileName: 'demo.txt',
      suffix: 'txt',
      totalChunks: '2',
      totalSize: '11',
    });
    const content = await readFile(path.join(storage.filesRoot, file.fileName), 'utf8');
    const existingFile = await getMergedFile(storage, { fileHash: 'filehash1', suffix: 'txt' });

    assert.equal(content, 'hello world');
    assert.equal(file.originalName, 'demo.txt');
    assert.equal(existingFile.fileHash, 'filehash1');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('mergeChunks 对已合并文件保持幂等', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'upload-demo-'));
  const storage = createStorage(tempDir);

  try {
    await storage.ensureReady();
    await saveChunk(storage, { fileHash: 'filehash2', chunkIndex: '0', buffer: Buffer.from('hello') });

    const first = await mergeChunks(storage, {
      fileHash: 'filehash2',
      fileName: 'demo.txt',
      suffix: 'txt',
      totalChunks: '1',
      totalSize: '5',
    });
    const second = await mergeChunks(storage, {
      fileHash: 'filehash2',
      fileName: 'demo.txt',
      suffix: 'txt',
      totalChunks: '1',
      totalSize: '5',
    });

    assert.equal(first.fileName, second.fileName);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('mergeChunks 会报告缺失分片', async () => {
  // 缺分片时不能生成最终文件，应该返回可恢复的业务错误。
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'upload-demo-'));
  const storage = createStorage(tempDir);

  try {
    await storage.ensureReady();
    await saveChunk(storage, { fileHash: 'filehash3', chunkIndex: '0', buffer: Buffer.from('hello') });

    await assert.rejects(
      () => mergeChunks(storage, { fileHash: 'filehash3', fileName: 'demo.txt', suffix: 'txt', totalChunks: '2' }),
      /还有 1 个分片未上传/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
