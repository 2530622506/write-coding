import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createStorage, getMergedFile, listMergedFiles, listUploadedChunks, mergeChunks, safeFileName, saveChunk, saveChunkStream } from './storage.js';

function createMemoryStorage() {
  const objects = new Map();
  const client = {
    async send(command) {
      const { input } = command;
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof CreateBucketCommand) return {};
      if (command instanceof PutObjectCommand) {
        const chunks = [];
        if (Buffer.isBuffer(input.Body)) chunks.push(input.Body);
        else for await (const chunk of input.Body) chunks.push(Buffer.from(chunk));
        objects.set(input.Key, { body: Buffer.concat(chunks), metadata: input.Metadata || {}, lastModified: new Date() });
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        const object = objects.get(input.Key);
        if (!object) throw Object.assign(new Error('Not Found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return { ContentLength: object.body.length, Metadata: object.metadata, LastModified: object.lastModified };
      }
      if (command instanceof GetObjectCommand) {
        const object = objects.get(input.Key);
        if (!object) throw Object.assign(new Error('Not Found'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: Readable.from(object.body) };
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...objects.entries()]
          .filter(([key]) => key.startsWith(input.Prefix || ''))
          .map(([Key, object]) => ({ Key, Size: object.body.length, LastModified: object.lastModified })) };
      }
      if (command instanceof DeleteObjectsCommand) {
        for (const { Key } of input.Delete.Objects) objects.delete(Key);
        return {};
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    },
  };
  const uploader = async ({ Bucket, Key, Body, Metadata, ContentType }) => {
    const chunks = [];
    if (Buffer.isBuffer(Body)) chunks.push(Body);
    else for await (const chunk of Body) chunks.push(Buffer.from(chunk));
    return client.send(new PutObjectCommand({ Bucket, Key, Body: Buffer.concat(chunks), Metadata, ContentType }));
  };
  return createStorage({ client, bucket: 'test-bucket', uploader });
}

test('safeFileName 保留中文、英文、数字和常见文件符号', () => {
  assert.equal(safeFileName('../测试 文件?.zip'), '测试_文件_.zip');
});

test('RustFS 存储支持分片流式保存、续传查询和最终对象合并', async () => {
  const storage = createMemoryStorage();
  await storage.ensureReady();
  await saveChunk(storage, { fileHash: 'filehash1', chunkIndex: '1', buffer: Buffer.from('world') });
  await saveChunkStream(storage, {
    fileHash: 'filehash1',
    chunkIndex: '0',
    stream: Readable.from(Buffer.from('hello ')),
  });

  assert.deepEqual(await listUploadedChunks(storage, 'filehash1'), [0, 1]);
  const file = await mergeChunks(storage, {
    fileHash: 'filehash1', fileName: 'demo 文件.txt', suffix: 'txt', totalChunks: 2, totalSize: 11,
  });
  assert.equal(file.originalName, 'demo_文件.txt');
  assert.equal(file.size, 11);
  assert.equal((await getMergedFile(storage, { fileHash: 'filehash1', suffix: 'txt' })).fileHash, 'filehash1');
  assert.deepEqual(await listUploadedChunks(storage, 'filehash1'), []);
  assert.equal((await listMergedFiles(storage)).length, 1);
});

test('mergeChunks 在分片缺失时返回可续传的 missingChunks', async () => {
  const storage = createMemoryStorage();
  await saveChunk(storage, { fileHash: 'filehash2', chunkIndex: '0', buffer: Buffer.from('hello') });
  await assert.rejects(
    () => mergeChunks(storage, { fileHash: 'filehash2', fileName: 'demo.txt', suffix: 'txt', totalChunks: 2 }),
    (error) => error.statusCode === 409 && error.details.missingChunks[0] === 1,
  );
});

test('mergeChunks 对已完成对象保持幂等', async () => {
  const storage = createMemoryStorage();
  await saveChunk(storage, { fileHash: 'filehash3', chunkIndex: '0', buffer: Buffer.from('hello') });
  const payload = { fileHash: 'filehash3', fileName: 'demo.txt', suffix: 'txt', totalChunks: 1, totalSize: 5 };
  const first = await mergeChunks(storage, payload);
  const second = await mergeChunks(storage, payload);
  assert.equal(first.fileName, second.fileName);
});
