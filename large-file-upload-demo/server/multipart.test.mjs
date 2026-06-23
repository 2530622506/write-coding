import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMultipartFormData } from './multipart.js';

test('parseMultipartFormData 可以解析字段和文件 Buffer', () => {
  // 手工构造最小 multipart 请求体，验证普通字段和二进制文件字段都能解析。
  const boundary = '----demo-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="fileId"\r\n\r\n'),
    Buffer.from('file-1\r\n'),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="chunk"; filename="demo.bin"\r\n'),
    Buffer.from('Content-Type: application/octet-stream\r\n\r\n'),
    Buffer.from([0, 1, 2, 3]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const result = parseMultipartFormData(`multipart/form-data; boundary=${boundary}`, body);

  assert.equal(result.fields.fileId, 'file-1');
  assert.equal(result.files.chunk.filename, 'demo.bin');
  assert.deepEqual([...result.files.chunk.buffer], [0, 1, 2, 3]);
});

test('parseMultipartFormData 拒绝非 multipart 请求', () => {
  // 上传分片接口只接受 multipart/form-data，其他类型应尽早失败。
  assert.throws(() => parseMultipartFormData('application/json', Buffer.from('{}')), /multipart\/form-data/);
});
