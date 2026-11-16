import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 設定画面に出す版の情報。スマホでどの版が動いているかを確かめるため
const buildTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });
// GitHub Actions でビルドしたときだけコミットが入る(Node の型定義を入れていないので globalThis 経由で読む)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const commit = (env?.GITHUB_SHA ?? '').slice(0, 7);

export default defineConfig({
  base: './',
  define: { __BUILD_INFO__: JSON.stringify(commit ? `${buildTime} (${commit})` : buildTime) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '収支管理',
        short_name: '収支管理',
        description: '個人専用の収支管理アプリ',
        lang: 'ja',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f4f6f8',
        theme_color: '#1f6f5c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
