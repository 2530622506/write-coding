import { spawn } from 'node:child_process';

// 一个命令同时启动后端和前端，方便本地演示完整上传链路。
const commands = [
  ['server', 'npm', ['run', 'dev:server']],
  ['client', 'npm', ['run', 'dev:client']],
];

const children = commands.map(([name, command, args]) => {
  // stdio 继承到当前终端，便于直接看到 Vite 和 Node 服务日志。
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exitCode = code;
    }
  });

  return child;
});

const stop = () => {
  // 父进程退出时同步停止子进程，避免端口被残留服务占用。
  for (const child of children) {
    child.kill('SIGTERM');
  }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
