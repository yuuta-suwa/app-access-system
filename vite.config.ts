import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_ で始まる変数だけがブラウザに埋め込まれる。秘密鍵には VITE_ を付けないこと。
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  test: { include: ['src/**/*.test.ts'] },
} as never);
