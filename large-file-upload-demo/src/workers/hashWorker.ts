import SparkMD5 from 'spark-md5';

interface HashRequest {
  file: File;
  chunkSize: number;
}

type HashWorkerMessage =
  | { type: 'progress'; percentage: number }
  | { type: 'done'; hash: string }
  | { type: 'error'; message: string };

async function readChunk(chunk: Blob) {
  return chunk.arrayBuffer();
}

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  const { file, chunkSize } = event.data;
  const spark = new SparkMD5.ArrayBuffer();
  const totalChunks = Math.ceil(file.size / chunkSize);

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const buffer = await readChunk(file.slice(start, end));

      spark.append(buffer);
      self.postMessage({
        type: 'progress',
        percentage: Math.round(((index + 1) / totalChunks) * 100),
      } satisfies HashWorkerMessage);
    }

    self.postMessage({
      type: 'done',
      hash: spark.end(),
    } satisfies HashWorkerMessage);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '文件 hash 计算失败。',
    } satisfies HashWorkerMessage);
  }
};
