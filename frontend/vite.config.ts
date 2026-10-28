import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // 백엔드(NestJS)가 켜져 있으면 /api 요청을 그쪽으로 넘긴다.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
