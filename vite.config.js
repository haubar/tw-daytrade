import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      // 本機開發時，把對 Netlify Functions 的請求轉發到 `netlify dev` 開的埠（預設 8888）
      // 如果沒有跑 netlify dev，這個 proxy 會失敗，前端會自動改用內建的範例資料（見 src/sampleData.js）
      '/.netlify/functions': 'http://localhost:8888',
    },
  },
});
