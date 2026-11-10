import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // 백엔드(NestJS)가 켜져 있으면 /api 요청을 그쪽으로 넘긴다.
    // 라이브 미니게임 소켓 서버(realtime)가 켜져 있으면 /rt 웹소켓도 그쪽으로 넘긴다.
    proxy: { '/api': 'http://localhost:3000', '/rt': { target: 'ws://localhost:3001', ws: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
