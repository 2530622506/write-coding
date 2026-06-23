import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: {
  env: {
    // 后端端口被占用时，可通过 VITE_API_TARGET 切换代理目标。
    VITE_API_TARGET?: string;
  };
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      // 前端请求 /api 时由 Vite 转发到 Node 服务，浏览器侧不用关心后端端口。
      '/api': process.env.VITE_API_TARGET || 'http://localhost:3001',
    },
  },
});
