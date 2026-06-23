import {
  CheckCircle2,
  CirclePause,
  FileArchive,
  FolderUp,
  Gauge,
  Hash,
  ListChecks,
  RefreshCcw,
  RotateCcw,
  Server,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 前端切片大小。示例固定为 2 MB，便于观察多个分片的上传和合并过程。
const CHUNK_SIZE = 2 * 1024 * 1024;
// 默认并发数设置为 3，既能提升速度，也不会轻易触发浏览器同域连接限制。
const DEFAULT_CONCURRENT_UPLOADS = 3;
// 单个分片失败后最多重试 3 次，用于抵抗短暂网络抖动。
const MAX_RETRY_COUNT = 3;
const RESUME_STORAGE_KEY = 'large-file-upload-demo:last-record';

// 上传阶段用于驱动按钮禁用、状态标签和提示文案。
type UploadPhase = 'idle' | 'hashing' | 'checking' | 'uploading' | 'paused' | 'merging' | 'done' | 'error';
type ChunkStatus = 'pending' | 'uploading' | 'success' | 'retrying' | 'failed' | 'skipped';

interface UploadStatusResponse {
  ok: boolean;
  shouldUpload: boolean;
  message?: string;
  uploadedChunks: number[];
  file?: UploadedFile;
}

interface UploadedFile {
  fileName: string;
  originalName?: string;
  fileHash?: string;
  size: number;
  updatedAt: string;
}

interface ChunkItem {
  index: number;
  size: number;
  progress: number;
  uploadedBytes: number;
  retries: number;
  status: ChunkStatus;
}

interface ResumeRecord {
  fileHash: string;
  fileName: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  updatedAt: string;
}

interface HashWorkerMessage {
  type: 'progress' | 'done' | 'error';
  percentage?: number;
  hash?: string;
  message?: string;
}

function formatBytes(value: number) {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '--';
  return `${formatBytes(bytesPerSecond)}/s`;
}

function getFileSuffix(fileName: string) {
  const segments = fileName.split('.');
  return segments.length > 1 ? segments[segments.length - 1] || '' : '';
}

function getChunkSize(file: File, chunkIndex: number) {
  // 最后一个分片通常小于 CHUNK_SIZE，需要按文件实际剩余大小计算。
  const start = chunkIndex * CHUNK_SIZE;
  return Math.max(0, Math.min(CHUNK_SIZE, file.size - start));
}

function createInitialChunks(file: File): ChunkItem[] {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  return Array.from({ length: totalChunks }, (_, index) => ({
    index,
    size: getChunkSize(file, index),
    progress: 0,
    uploadedBytes: 0,
    retries: 0,
    status: 'pending' as ChunkStatus,
  }));
}

function getCompletedBytes(items: ChunkItem[]) {
  // success/skipped 代表完整分片已在服务端，uploading 用实时 uploadedBytes 计算总进度。
  return items.reduce((total, item) => {
    if (item.status === 'success' || item.status === 'skipped') {
      return total + item.size;
    }

    return total + item.uploadedBytes;
  }, 0);
}

async function parseResponse<T>(response: Response): Promise<T> {
  // 代理失败或后端异常时可能返回空 body / 非 JSON，先读文本以便给出可读错误。
  const rawText = await response.text();
  const statusText = `HTTP ${response.status}`;

  if (!rawText.trim()) {
    throw new Error(
      response.ok ? '服务端返回空响应。' : `后端服务不可用或代理请求失败（${statusText}）。`,
    );
  }

  let payload: (T & { ok?: boolean; message?: string }) | null = null;

  try {
    payload = JSON.parse(rawText) as T & { ok?: boolean; message?: string };
  } catch {
    throw new Error(
      response.ok
        ? '服务端返回了非 JSON 响应。'
        : rawText.slice(0, 120) || `请求失败，请重试（${statusText}）。`,
    );
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `请求失败，请重试（${statusText}）。`);
  }

  return payload;
}

function readResumeRecord() {
  try {
    const raw = localStorage.getItem(RESUME_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ResumeRecord) : null;
  } catch {
    return null;
  }
}

function saveResumeRecord(record: ResumeRecord) {
  // localStorage 只记录续传线索，不保存 File 对象；刷新后仍需要用户重新选择文件。
  localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(record));
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState('');
  const [hashProgress, setHashProgress] = useState(0);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [chunkItems, setChunkItems] = useState<ChunkItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENT_UPLOADS);
  const [message, setMessage] = useState('请选择一个文件开始上传。');
  const [resumeMessage, setResumeMessage] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState('');
  // 保存每个正在上传分片的 XHR，用于暂停时批量中断请求。
  const xhrsRef = useRef<XMLHttpRequest[]>([]);
  // hash worker 也需要保存引用，重置时可以终止后台计算。
  const hashWorkerRef = useRef<Worker | null>(null);
  // pausedRef 不触发渲染，适合给并发 worker 判断是否应该停止取新任务。
  const pausedRef = useRef(false);

  const totalChunks = chunkItems.length;
  const uploadedCount = chunkItems.filter((item) => item.status === 'success' || item.status === 'skipped').length;
  const uploadedBytes = useMemo(() => getCompletedBytes(chunkItems), [chunkItems]);
  const failedCount = chunkItems.filter((item) => item.status === 'failed').length;
  const retryingCount = chunkItems.filter((item) => item.status === 'retrying').length;
  const canUpload = Boolean(file) && !['hashing', 'checking', 'uploading', 'merging'].includes(phase);
  const canPause = phase === 'uploading';
  const visibleChunks = chunkItems.slice(0, 30);

  const loadFiles = useCallback(async () => {
    try {
      // 页面加载和上传成功后刷新服务端文件列表，方便确认合并结果。
      const response = await fetch('/api/files');
      const payload = await parseResponse<{ files: UploadedFile[] }>(response);
      setFiles(payload.files);
    } catch {
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  function updateChunks(nextItems: ChunkItem[], currentFile: File, startedAt?: number) {
    setChunkItems(nextItems);
    setProgress(Math.round((getCompletedBytes(nextItems) / currentFile.size) * 100));

    if (startedAt) {
      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.1);
      const transferredBytes = nextItems
        .filter((item) => item.status !== 'skipped')
        .reduce((total, item) => total + item.uploadedBytes, 0);
      setSpeed(transferredBytes / elapsedSeconds);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] || null;
    // 选择新文件时清空上一轮上传状态，避免进度和分片统计串到新文件上。
    setFile(nextFile);
    setFileHash('');
    setHashProgress(0);
    setChunkItems(nextFile ? createInitialChunks(nextFile) : []);
    setProgress(0);
    setSpeed(0);
    setError('');
    setResumeMessage('');
    setPhase('idle');
    setMessage(nextFile ? '文件已选择，可以开始上传。' : '请选择一个文件开始上传。');
  }

  function resetUpload() {
    // 重置时先中断还在进行中的请求，再恢复页面到待上传状态。
    xhrsRef.current.forEach((xhr) => xhr.abort());
    xhrsRef.current = [];
    hashWorkerRef.current?.terminate();
    hashWorkerRef.current = null;
    pausedRef.current = false;
    setFileHash('');
    setHashProgress(0);
    setChunkItems(file ? createInitialChunks(file) : []);
    setProgress(0);
    setSpeed(0);
    setError('');
    setResumeMessage('');
    setPhase('idle');
    setMessage(file ? '已重置本次上传状态。' : '请选择一个文件开始上传。');
  }

  function calculateHash(currentFile: File) {
    setPhase('hashing');
    setHashProgress(0);
    setMessage('正在使用 Web Worker 计算文件内容 hash。');

    return new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL('./workers/hashWorker.ts', import.meta.url), { type: 'module' });
      hashWorkerRef.current = worker;

      worker.onmessage = (event: MessageEvent<HashWorkerMessage>) => {
        const payload = event.data;

        if (payload.type === 'progress') {
          setHashProgress(payload.percentage || 0);
          return;
        }

        if (payload.type === 'done' && payload.hash) {
          worker.terminate();
          hashWorkerRef.current = null;
          setHashProgress(100);
          resolve(payload.hash);
          return;
        }

        worker.terminate();
        hashWorkerRef.current = null;
        reject(new Error(payload.message || '文件 hash 计算失败。'));
      };

      worker.onerror = () => {
        worker.terminate();
        hashWorkerRef.current = null;
        reject(new Error('文件 hash worker 执行失败。'));
      };

      worker.postMessage({ file: currentFile, chunkSize: CHUNK_SIZE });
    });
  }

  async function checkUploadStatus(currentFile: File, hash: string) {
    const params = new URLSearchParams({
      fileHash: hash,
      fileName: currentFile.name,
      totalChunks: String(Math.ceil(currentFile.size / CHUNK_SIZE)),
      totalSize: String(currentFile.size),
      chunkSize: String(CHUNK_SIZE),
      suffix: getFileSuffix(currentFile.name),
    });
    // 断点续传的关键：先问后端已经有哪些分片，只补传缺失部分。
    const response = await fetch(`/api/upload/status?${params.toString()}`);
    return parseResponse<UploadStatusResponse>(response);
  }

  async function mergeFile(currentFile: File, hash: string) {
    // 所有分片上传完成后只发送元信息，真正的大文件合并发生在后端。
    const response = await fetch('/api/upload/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileHash: hash,
        fileName: currentFile.name,
        suffix: getFileSuffix(currentFile.name),
        totalChunks: Math.ceil(currentFile.size / CHUNK_SIZE),
        totalSize: currentFile.size,
        chunkSize: CHUNK_SIZE,
      }),
    });

    await parseResponse(response);
  }

  function uploadChunkByXhr(
    currentFile: File,
    hash: string,
    item: ChunkItem,
    onProgress: (loaded: number) => void,
  ) {
    // XHR 可以拿到 upload.onprogress，fetch 当前无法直接提供上传进度。
    return new Promise<void>((resolve, reject) => {
      const start = item.index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, currentFile.size);
      const formData = new FormData();
      const xhr = new XMLHttpRequest();

      formData.append('fileHash', hash);
      formData.append('fileName', currentFile.name);
      formData.append('suffix', getFileSuffix(currentFile.name));
      formData.append('chunkIndex', String(item.index));
      formData.append('totalChunks', String(Math.ceil(currentFile.size / CHUNK_SIZE)));
      formData.append('totalSize', String(currentFile.size));
      formData.append('chunkSize', String(CHUNK_SIZE));
      formData.append('chunk', currentFile.slice(start, end), currentFile.name);

      xhrsRef.current.push(xhr);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded);
        }
      };
      xhr.onload = () => {
        xhrsRef.current = xhrsRef.current.filter((current) => current !== xhr);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }

        try {
          const payload = JSON.parse(xhr.responseText);
          reject(new Error(payload.message || '分片上传失败。'));
        } catch {
          reject(new Error('分片上传失败。'));
        }
      };
      xhr.onerror = () => {
        xhrsRef.current = xhrsRef.current.filter((current) => current !== xhr);
        reject(new Error('网络异常，分片上传失败。'));
      };
      xhr.onabort = () => {
        xhrsRef.current = xhrsRef.current.filter((current) => current !== xhr);
        reject(new DOMException('上传已暂停。', 'AbortError'));
      };
      xhr.open('POST', '/api/upload/chunk');
      xhr.send(formData);
    });
  }

  async function uploadChunkWithRetry(
    currentFile: File,
    hash: string,
    item: ChunkItem,
    getItems: () => ChunkItem[],
    commitItems: (items: ChunkItem[]) => void,
    startedAt: number,
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRY_COUNT; attempt += 1) {
      if (pausedRef.current) {
        throw new DOMException('上传已暂停。', 'AbortError');
      }

      const nextStatus: ChunkStatus = attempt === 0 ? 'uploading' : 'retrying';
      commitItems(
        getItems().map((chunk) =>
          chunk.index === item.index
            ? { ...chunk, status: nextStatus, retries: attempt, uploadedBytes: 0, progress: 0 }
            : chunk,
        ),
      );

      try {
        await uploadChunkByXhr(currentFile, hash, item, (loaded) => {
          commitItems(
            getItems().map((chunk) =>
              chunk.index === item.index
                ? {
                    ...chunk,
                    status: nextStatus,
                    uploadedBytes: Math.min(loaded, chunk.size),
                    progress: Math.round((Math.min(loaded, chunk.size) / chunk.size) * 100),
                  }
                : chunk,
            ),
          );
          updateChunks(getItems(), currentFile, startedAt);
        });

        commitItems(
          getItems().map((chunk) =>
            chunk.index === item.index
              ? { ...chunk, status: 'success', uploadedBytes: chunk.size, progress: 100, retries: attempt }
              : chunk,
          ),
        );
        updateChunks(getItems(), currentFile, startedAt);
        return;
      } catch (error) {
        lastError = error;

        if (pausedRef.current || (error instanceof DOMException && error.name === 'AbortError')) {
          throw error;
        }

        if (attempt < MAX_RETRY_COUNT) {
          // 退避时间随失败次数增长，避免瞬时重试继续压垮网络。
          await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
    }

    commitItems(
      getItems().map((chunk) =>
        chunk.index === item.index
          ? { ...chunk, status: 'failed', uploadedBytes: 0, progress: 0, retries: MAX_RETRY_COUNT }
          : chunk,
      ),
    );
    updateChunks(getItems(), currentFile, startedAt);
    throw lastError instanceof Error ? lastError : new Error(`分片 ${item.index} 上传失败。`);
  }

  async function startUpload() {
    if (!file) return;
    // 固定本次上传使用的文件对象，避免异步过程中用户重新选择文件带来歧义。
    const currentFile = file;

    pausedRef.current = false;
    xhrsRef.current = [];
    setError('');

    try {
      const hash = fileHash || (await calculateHash(currentFile));
      const chunks = createInitialChunks(currentFile);
      let currentItems = chunks;
      const getItems = () => currentItems;
      const commitItems = (items: ChunkItem[]) => {
        currentItems = items;
        setChunkItems(items);
      };

      setFileHash(hash);
      const previousRecord = readResumeRecord();
      saveResumeRecord({
        fileHash: hash,
        fileName: currentFile.name,
        size: currentFile.size,
        chunkSize: CHUNK_SIZE,
        totalChunks: chunks.length,
        updatedAt: new Date().toISOString(),
      });

      if (previousRecord?.fileHash === hash) {
        setResumeMessage(`检测到同一文件的续传记录：${previousRecord.fileName}。`);
      }

      setPhase('checking');
      setMessage('正在查询服务端文件和已上传分片。');
      const status = await checkUploadStatus(currentFile, hash);

      if (!status.shouldUpload) {
        // 秒传：服务端已经有完整文件，前端不用再上传任何分片。
        const skippedItems = chunks.map((chunk) => ({
          ...chunk,
          status: 'skipped' as ChunkStatus,
          uploadedBytes: chunk.size,
          progress: 100,
        }));
        updateChunks(skippedItems, currentFile);
        setPhase('done');
        setMessage('服务端已存在相同内容文件，已完成秒传。');
        await loadFiles();
        return;
      }

      const uploadedSet = new Set(status.uploadedChunks || []);
      currentItems = chunks.map((chunk) =>
        uploadedSet.has(chunk.index)
          ? { ...chunk, status: 'skipped', uploadedBytes: chunk.size, progress: 100 }
          : chunk,
      );
      updateChunks(currentItems, currentFile);

      const pendingQueue = currentItems.filter((chunk) => chunk.status === 'pending');
      const startedAt = performance.now();

      setPhase('uploading');
      setMessage(pendingQueue.length === 0 ? '分片已齐全，准备合并。' : '正在上传缺失分片。');

      async function worker() {
        // 多个 worker 共享同一个队列；JavaScript 单线程执行 shift，不会出现同一分片被两个 worker 同时取走。
        while (pendingQueue.length > 0 && !pausedRef.current) {
          const nextChunk = pendingQueue.shift();
          if (!nextChunk) return;
          await uploadChunkWithRetry(currentFile, hash, nextChunk, getItems, commitItems, startedAt);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(concurrency, pendingQueue.length || 1) }, () => worker()),
      );

      if (pausedRef.current) {
        // 暂停不是失败，已经落盘的分片会在下次点击继续时复用。
        setPhase('paused');
        setMessage('上传已暂停，已完成的分片会保留在服务端。');
        return;
      }

      setPhase('merging');
      setMessage('分片上传完成，正在合并文件。');
      await mergeFile(currentFile, hash);
      setPhase('done');
      setProgress(100);
      setMessage('上传完成，文件已在服务端合并。');
      await loadFiles();
    } catch (uploadError) {
      if (pausedRef.current) {
        // XHR abort 也会进入 catch，这里把它归类为用户主动暂停。
        setPhase('paused');
        setMessage('上传已暂停，已完成的分片会保留在服务端。');
        return;
      }

      setPhase('error');
      setError(uploadError instanceof Error ? uploadError.message : '上传失败，请重试。');
      setMessage('上传过程出现错误。');
    } finally {
      xhrsRef.current = [];
    }
  }

  function pauseUpload() {
    // 先设置暂停标记，阻止 worker 继续领取新分片，再中断当前正在上传的请求。
    pausedRef.current = true;
    xhrsRef.current.forEach((xhr) => xhr.abort());
    setPhase('paused');
    setMessage('正在暂停上传请求。');
  }

  const statusLabel = {
    idle: '待上传',
    hashing: '计算 Hash',
    checking: '检查中',
    uploading: '上传中',
    paused: '已暂停',
    merging: '合并中',
    done: '已完成',
    error: '失败',
  }[phase];

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="大文件上传工作台">
        <header className="topbar">
          <div>
            <p className="eyebrow">React + Node</p>
            <h1>大文件分片上传工作台</h1>
          </div>
          <div className={`status-pill status-${phase}`} aria-live="polite">
            {phase === 'error' ? <XCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
            <span>{statusLabel}</span>
          </div>
        </header>

        <div className="layout-grid">
          <section className="upload-panel" aria-labelledby="upload-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Upload</p>
                <h2 id="upload-title">选择文件并上传</h2>
              </div>
              <FolderUp size={28} aria-hidden="true" />
            </div>

            <label className="drop-zone">
              <input type="file" onChange={handleFileChange} />
              <UploadCloud size={36} aria-hidden="true" />
              <span>{file ? file.name : '点击选择一个大文件'}</span>
              <small>{file ? `${formatBytes(file.size)} · ${totalChunks} 个分片` : '默认每片 2 MB，支持 hash 秒传、暂停续传和失败重试'}</small>
            </label>

            <div className="progress-block">
              <div className="progress-header">
                <span>{message}</span>
                <strong>{progress}%</strong>
              </div>
              <div className="progress-track" aria-label="上传进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} role="progressbar">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="progress-block compact-progress">
              <div className="progress-header">
                <span>文件 hash 计算进度</span>
                <strong>{hashProgress}%</strong>
              </div>
              <div className="progress-track" aria-label="hash 计算进度" aria-valuenow={hashProgress} aria-valuemin={0} aria-valuemax={100} role="progressbar">
                <span style={{ width: `${hashProgress}%` }} />
              </div>
            </div>

            {fileHash ? (
              <p className="hash-line">
                <Hash size={16} aria-hidden="true" />
                <span>{fileHash}</span>
              </p>
            ) : null}

            {resumeMessage ? <p className="resume-message">{resumeMessage}</p> : null}
            {error ? <p className="error-message" role="alert">{error}</p> : null}

            <div className="control-row">
              <label htmlFor="concurrency">并发数</label>
              <input
                id="concurrency"
                type="range"
                min="1"
                max="6"
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
                disabled={phase === 'uploading'}
              />
              <strong>{concurrency}</strong>
            </div>

            <div className="action-row">
              <button type="button" className="primary-button" disabled={!canUpload} onClick={startUpload}>
                <UploadCloud size={18} aria-hidden="true" />
                <span>{phase === 'paused' ? '继续上传' : '开始上传'}</span>
              </button>
              <button type="button" className="secondary-button" disabled={!canPause} onClick={pauseUpload}>
                <CirclePause size={18} aria-hidden="true" />
                <span>暂停</span>
              </button>
              <button type="button" className="ghost-button" disabled={!file} onClick={resetUpload}>
                <RotateCcw size={18} aria-hidden="true" />
                <span>重置</span>
              </button>
            </div>
          </section>

          <aside className="stats-panel" aria-label="上传状态">
            <div className="metric">
              <span>分片大小</span>
              <strong>{formatBytes(CHUNK_SIZE)}</strong>
            </div>
            <div className="metric">
              <span>已完成分片</span>
              <strong>{uploadedCount}/{totalChunks || 0}</strong>
            </div>
            <div className="metric">
              <span>已上传容量</span>
              <strong>{formatBytes(uploadedBytes)}</strong>
            </div>
            <div className="metric">
              <span>实时速度</span>
              <strong>{formatSpeed(speed)}</strong>
            </div>
            <div className="metric">
              <span>重试/失败</span>
              <strong>{retryingCount}/{failedCount}</strong>
            </div>
          </aside>
        </div>

        <section className="chunk-panel" aria-labelledby="chunk-title">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Chunks</p>
              <h2 id="chunk-title">分片状态</h2>
            </div>
            <ListChecks size={24} aria-hidden="true" />
          </div>
          {visibleChunks.length > 0 ? (
            <div className="chunk-grid">
              {visibleChunks.map((item) => (
                <div className={`chunk-item chunk-${item.status}`} key={item.index}>
                  <span>#{item.index}</span>
                  <strong>{item.progress}%</strong>
                  <small>{item.status}{item.retries ? ` · 重试 ${item.retries}` : ''}</small>
                </div>
              ))}
              {chunkItems.length > visibleChunks.length ? (
                <div className="chunk-more">还有 {chunkItems.length - visibleChunks.length} 个分片未展示</div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state small">
              <Gauge size={24} aria-hidden="true" />
              <p>选择文件后会显示分片队列状态。</p>
            </div>
          )}
        </section>

        <section className="server-panel" aria-labelledby="server-title">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Server Files</p>
              <h2 id="server-title">服务端已合并文件</h2>
            </div>
            <button type="button" className="icon-button" onClick={loadFiles} aria-label="刷新文件列表">
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
          </div>

          {files.length > 0 ? (
            <div className="file-list">
              {files.map((item) => (
                <article className="file-row" key={item.fileName}>
                  <FileArchive size={22} aria-hidden="true" />
                  <div>
                    <h3>{item.originalName || item.fileName}</h3>
                    <p>{formatBytes(item.size)} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</p>
                    {item.fileHash ? <small>{item.fileHash}</small> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Server size={28} aria-hidden="true" />
              <p>服务端暂时没有已合并文件。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
