// tests/visual/dashboard.spec.js
//
// 首頁 Dashboard 的視覺回歸測試。這裡刻意不打真正的 API——`npm run preview` 起的是
// 純靜態伺服器，沒有 Netlify Functions，`/.netlify/functions/latest` 一定會是 404，
// App.vue 遇到 404 會自動退回 sampleData.js 的假資料（見 App.vue 的 loadData 說明），
// 這正是我們要的：畫面內容固定、不受今天股價影響，截圖比對才有意義。
//
// 命名規則：每個 test() 的截圖檔名要能一眼看出「測的是哪個畫面 + 哪個狀態」，
// 不要用 'screenshot1' 這種名字，之後看到测试失败才知道是哪裡壞了。

import { test, expect } from '@playwright/test';

test.describe('首頁 Dashboard', () => {
  test('預設畫面（範例資料橫幅 + 多空觀察榜）', async ({ page }) => {
    await page.goto('/');

    // 等範例資料橫幅出現，代表 App.vue 已經完成 loadData 的 fallback 流程、畫面資料穩定下來，
    // 不要一 goto 完就馬上截圖，那時候可能還在「正在讀取今日觀察榜…」的過渡畫面。
    await expect(page.getByText('目前顯示的是範例資料')).toBeVisible();
    // 觀察榜的股票列表也要等到真的渲染出來，避免截到內容還沒 render 完的中間狀態
    await expect(page.getByText('多方觀察榜')).toBeVisible();

    await expect(page).toHaveScreenshot('dashboard-default.png', { fullPage: true });
  });

  test('篩選面板：拉高最小成交量門檻後的畫面', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('多方觀察榜')).toBeVisible();

    // 把「最小成交量」滑桿拉到最大值（1萬張），驗證篩選後畫面的呈現（榜單檔數變化、
    // 「已套用篩選」提示文字），這是 P1/P3 那幾項篩選功能疊代後最容易不小心弄壞版面的地方。
    const volumeSlider = page.getByLabel('最小成交量');
    await volumeSlider.fill('5'); // VOLUME_OPTIONS 最後一個索引（1萬張以上）
    await expect(page.getByText(/已套用篩選/)).toBeVisible();

    await expect(page).toHaveScreenshot('dashboard-volume-filter-max.png', { fullPage: true });
  });

  test('篩選面板：開啟「隱藏不可當沖股票」', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('多方觀察榜')).toBeVisible();

    // 對應《後續修改清單》P3「當沖資格過濾」新增的核取方塊，是本次疊代新加的 UI，
    // 特別開一個獨立截圖案例，往後如果動到 FilterPanel.vue 的版面容易在這裡先抓到問題。
    await page.getByLabel('隱藏今天不可現股當沖的股票').check();

    await expect(page).toHaveScreenshot('dashboard-hide-daytrade-ineligible.png', { fullPage: true });
  });

  test('觀察榜卡片：法人資料暫缺 / 不可當沖徽章特寫', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('多方觀察榜')).toBeVisible();

    // 只截「法人資料暫缺」徽章第一次出現的那張卡片，而不是整頁——這類小徽章的顏色/間距
    // 問題在整頁截圖裡容易被忽略，獨立截一張特寫比較容易在 review 時看出差異。
    const badgedRow = page.getByText('法人資料暫缺').first().locator('xpath=ancestor::li[1]');
    await expect(badgedRow).toBeVisible();
    await expect(badgedRow).toHaveScreenshot('watchlist-row-institutional-missing-badge.png');
  });
});

test.describe('首頁 Dashboard（手機版）', () => {
  test.use({ viewport: undefined }); // 使用 playwright.config.js 裡 mobile-chromium 專案的裝置設定

  test('預設畫面（窄螢幕排版）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('多方觀察榜')).toBeVisible();

    await expect(page).toHaveScreenshot('dashboard-mobile-default.png', { fullPage: true });
  });
});
