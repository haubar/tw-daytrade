// playwright.config.js
//
// 前端視覺回歸測試設定。對應《後續修改清單》P3「前端視覺回歸檢查機制」：
// 目前前端（Vue3 Dashboard、因子解剖條、篩選面板）完全沒有自動化把關，只能靠人工
// 看畫面回報，往後疊代功能時容易漏掉迴歸性的樣式問題。這裡用 Playwright 的
// toHaveScreenshot() 做截圖比對，第一次執行時建立基準圖，之後每次執行都跟基準圖比對，
// 差異超過門檻就會讓測試失敗。
//
// 測試目標固定用 sampleData.js 的假資料（見 tests/visual/dashboard.spec.js 的說明），
// 不依賴任何真實 API 或 Netlify Functions，確保畫面內容是穩定、可重現的，
// 不會因為股價每天變動而讓截圖比對永遠失敗。
//
// 已知限制：這個容器的網路白名單沒有開放 cdn.playwright.dev（瀏覽器執行檔下載來源），
// 所以無法在這個沙盒環境裡實際執行 `npx playwright install` 或跑這些測試、也沒辦法
// 產生真正的基準截圖。設定檔本身已經寫好、邏輯已確認沒問題，但基準圖需要你在本機
// 或 CI（例如 GitHub Actions，那邊網路沒有限制）執行 `npm run test:visual:update`
// 產生，詳見 README「視覺回歸測試」章節。

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  // 截圖比對本身就是要抓「像素有沒有跑掉」，平行跑多個 worker 容易因為字型渲染時機
  // 等因素造成不必要的 flaky，這裡刻意跑單一 worker，比速度更重要的是結果穩定。
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // 螢幕字型渲染在不同機器/CI之間可能有些微差異，容許小幅度的像素差異，
    // 避免「明明畫面沒壞、只是抗鋸齒算法不同」就讓測試變成永遠紅燈。
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // 測試前自動建置 + 啟動 vite preview，不用手動先跑 npm run build。
  // reuse: true 讓本機重複執行時可以沿用已經在跑的 preview server，加快疊代速度；
  // CI 環境每次都是全新啟動，不會有殘留的舊 server 干擾。
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
