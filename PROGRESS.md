# 開發進度紀錄（PROGRESS.md）

這份文件記錄專案從設計討論到實作的每個階段，方便回顧「為什麼會做成這樣」以及銜接下一步。

---

## 階段 0：需求釐清與設計規劃

**目標**：確認工具用途、資料來源、呈現形式。

**決策**：
- 用途：分階段做——先盤後選股，之後策略回測，最後盤中輔助
- 資料來源：僅使用免費公開資料（TWSE / OTC）
- 呈現形式：網頁互動 Dashboard

**產出**：三階段開發藍圖（Phase 1 盤後選股／Phase 2 回測／Phase 3 盤中輔助）

---

## 階段 1：Phase 1 選股邏輯設計

**目標**：定義 Phase 1 要用哪些因子選股。

**決策**：
- 觀察範圍：全市場（上市＋上櫃）
- 三大量化因子：量能異常（成交量 vs 均量）、開盤跳空幅度、相對大盤強弱勢
- 因子先各自轉百分位排名，再加權加總成綜合評分

---

## 階段 2：加入隔日沖分點因子

**目標**：把「隔日沖券商分點買賣超」納入判斷邏輯。

**關鍵限制**：
- 分點資料只能「輸入股票代號查詢」，無法對全市場逐檔查，因此改成**兩階段流程**：先用三大量化因子篩出候選名單（Top 20~30），再針對候選名單查分點
- 搜尋整理出目前市場常見的隔日沖分點名單（本土＋外資），並確認這份名單每年會變動，設計上要做成可調整設定檔，不寫死在程式裡

**產出**：四因子架構（量能異常 30% + 跳空幅度 20% + 相對強弱 20% + 隔日沖介入 30%，權重可調）

---

## 階段 3：技術棧確認

**目標**：確認實作用的程式語言與部署方式。

**決策**：Node.js（Netlify Functions）+ Vue 3（前端）+ Netlify 部署（原本規劃 Python + React + 本機執行，依需求改為此組合）

**關鍵發現**：Netlify Functions 是雲端執行，沒有本機/沙盒環境的網域限制，可以用 **Netlify Scheduled Functions** 做到「收盤後自動抓取」，不需要使用者手動跑腳本——這比原本「Python 本機腳本」的規劃更好。

**確認的細節**：
- 資料儲存用 Netlify Blobs（免額外資料庫）
- 免費方案：每月 300 credits 共用額度，一般 function 同步執行有 10 秒逾時限制
- HTML 解析分點資料用 `cheerio`

---

## 階段 4：專案骨架 + 資料抓取層（本階段）

**目標**：建立專案骨架，完成「抓取＋正規化」這一層，並驗證邏輯正確性。範圍刻意縮小，避免一次做太多。

**完成事項**：
1. 建立專案結構（`netlify.toml`、`package.json`、`netlify/functions/`）
2. 實際發送請求驗證 **TWSE OpenAPI** 欄位格式（`https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`），確認欄位為 `Code / Name / OpeningPrice / HighestPrice / LowestPrice / ClosingPrice / TradeVolume / Change` 等
3. 寫成 `lib/normalize.mjs`：把 TWSE／TPEx 原始資料轉成統一格式
4. 寫測試腳本 `_test-fetch-daily-quotes.mjs`，用**真實抓到的樣本資料**（台泥正常交易、00625K 零成交量、中福負漲跌價差）驗證正規化邏輯，6/6 測試通過
5. 寫主要 function `fetch-daily-quotes.mjs`，語法檢查通過

**已知未完成 / 待驗證**：
- TPEx（上櫃）欄位名稱因該網域防爬蟲機制擋下測試請求，尚未用真實資料驗證，採用「防禦性欄位對應」寫法（欄位對不上會清楚報錯，列出實際欄位名稱），待部署到 Netlify 後第一次執行即可確認並修正
- 尚未實作因子計算邏輯（量能異常／跳空／相對強弱／隔日沖）
- 尚未建立 Vue 前端
- 隔日沖分點清單尚未做成設定檔

**產出檔案**：
```
netlify.toml
package.json
README.md
PROGRESS.md
netlify/functions/fetch-daily-quotes.mjs
netlify/functions/_test-fetch-daily-quotes.mjs
netlify/functions/lib/normalize.mjs
```

---

## 階段 5：三大量化因子計算邏輯

**目標**：實作量能異常／跳空幅度／相對大盤強弱勢的計算公式，以及百分位評分＋綜合排序機制。刻意只做「純計算邏輯」，不碰網路請求，方便完整測試且不受環境網路限制影響。

**完成事項**：
1. `lib/factors.mjs`：
   - `computeVolumeRatio`：當日量 ÷ 過去 N 日均量
   - `computeGapPercent`：開盤跳空幅度 %
   - `computeRelativeStrength`：個股漲跌幅 − 大盤漲跌幅
   - `computeMarketChangeProxy`：用成交值加權平均漲跌幅近似大盤漲跌幅（因為還沒接大盤指數 API 的暫時替代方案，之後可直接替換成真正的 TAIEX 指數）
   - `toPercentileRanks`：把不同量級的因子轉成 0~100 百分位分數，才能加權合併
   - `computeCompositeScores`：三因子加權合併（預設量能 40% + 跳空 30% + 相對強弱 30%），依分數排序
2. 測試腳本 `_test-factors.mjs`，13 個案例全數通過

**產出檔案（新增）**：
```
netlify/functions/lib/factors.mjs
netlify/functions/_test-factors.mjs
```

---

## 階段 6：歷史資料抓取 + 完整流程串接（本階段）

**目標**：補上量能異常因子需要的「過去 5 日成交量」資料，並把 normalize + history + factors 串接成完整的候選名單產出流程。

**完成事項**：
1. **驗證 TWSE 歷史資料端點**：用真實請求測試 `www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?date=...`，發現：
   - 格式是 **CSV**（中文欄位），跟 `openapi.twse.com.tw` 的 JSON 格式不同
   - **`date` 參數不完全可靠**：實測指定 2026-07-02，卻收到 2026-07-07 的資料。這代表不能盲目信任送出去的參數，一定要用「回傳資料本身標示的日期」來確認實際拿到哪一天
2. `lib/csv.mjs`：輕量 CSV 解析器（處理雙引號欄位），4 個測試通過
3. `lib/normalize.mjs` 新增 `normalizeTwseCsvRow`／`extractDateFromCsvRow`，處理 CSV 格式與民國年日期轉換，5 個測試通過
4. `lib/history.mjs`：
   - `getPastTradingDayCandidates`：產生候選交易日（跳過週末，未處理國定假日）
   - `fetchVolumeHistory`：抓取過去 N 個「獨立」交易日，用回傳日期去重（因應上述 date 參數不可靠的問題），6 個測試通過（含用假的 fetch 模擬「連續兩次拿到同一天資料」的邊界情況）
5. `lib/screen.mjs`：整合 normalize + history + factors，產生多方/空方觀察榜
   - **測試時抓到一個邏輯錯誤**：原本空方觀察榜是「把多方分數倒過來排序」，但這樣「量能很低、沒什麼動作」的股票（分數最低）會排在「爆量下跌」的股票前面——因為量能異常因子被一併倒過來計算，導致「低量」被誤判成空方訊號。已修正為：量能異常方向不反轉（爆量永遠是訊號強，不管方向），只反轉跳空與相對強弱的方向。修正後 8 個測試全數通過
6. `netlify/functions/scan.mjs`：最終會部署的主要進入點，串接「抓今日行情→抓歷史→跑篩選→輸出結果」完整流程，並修正 `netlify.toml` 裡一個指向不存在 function 名稱、實際上不會生效的排程設定錯誤（改為在 `scan.mjs` 內用 `export const config = { schedule: ... }` 正確設定）

**目前總測試數**：38 個，全數通過

**已知未完成 / 待驗證**：
- TPEx（上櫃）欄位名稱仍未用真實資料驗證（環境網路限制）
- 排程執行後結果沒有地方保存查看，還沒接上 Netlify Blobs
- 大盤漲跌幅仍是用近似值，未接真正的 TAIEX 指數 API
- 隔日沖分點因子（Phase 2 規劃）尚未開始實作
- Vue 前端尚未建立
- `getPastTradingDayCandidates` 只跳過週末，沒有處理國定假日，遇到連假可能會拿到比預期更早的資料（不影響正確性，只是「過去 5 日」的區間會拉長一點）

**產出檔案（新增）**：
```
netlify/functions/lib/csv.mjs
netlify/functions/lib/history.mjs
netlify/functions/lib/screen.mjs
netlify/functions/scan.mjs
netlify/functions/_test-csv.mjs
netlify/functions/_test-normalize-csv.mjs
netlify/functions/_test-history.mjs
netlify/functions/_test-screen.mjs
```

---

## 階段 7：Netlify Blobs 儲存層（本階段）

**目標**：讓排程自動執行的結果有地方保存，前端之後才能讀到最新資料，而不用每次都重新抓取整個市場。

**完成事項**：
1. 查證 `@netlify/blobs` 目前（2026）的正確 API：`getStore(name)`、`store.setJSON(key, value)`、`store.get(key, {type:'json'})`，並確認安裝與匯入方式
2. `lib/storage.mjs`：
   - `saveLatestScan`：存一份「最新結果」，同時額外存一份「依日期」的備份（`by-date/YYYY-MM-DD`）方便之後回顧歷史
   - `getLatestScan` / `getScanByDate`：讀取，查無資料時回傳 `null` 而不是拋例外
   - 刻意把 `store` 設計成可注入的參數（預設用真正的 `getStore()`），這樣測試時可以塞一個假的 in-memory store 進去，完全不需要真的連到 Netlify 的 Blobs 環境
3. 測試腳本 `_test-storage.mjs`，用假的 store 驗證：存取正確性、查無資料回傳 null、新結果不會覆蓋掉不同日期的舊備份，5 個案例全過
4. `scan.mjs` 接上儲存：算完結果後存進 Blobs，並且**存檔失敗不會讓整個請求失敗**（只會在回應裡多一個 `storageWarning` 欄位），因為使用者手動打開這支 function 時，還是想看到當次算出來的結果
5. 新增 `latest.mjs`：給前端呼叫的輕量入口，只讀 Blobs 不重新計算，回應快，之後 Vue Dashboard 會呼叫這支

**目前總測試數**：43 個，全數通過

**已知未完成 / 待驗證**：
- TPEx（上櫃）欄位名稱仍未用真實資料驗證（環境網路限制）
- 大盤漲跌幅仍是用近似值，未接真正的 TAIEX 指數 API
- 隔日沖分點因子（Phase 2 規劃）尚未開始實作
- Vue 前端尚未建立
- `getPastTradingDayCandidates` 只跳過週末，沒有處理國定假日
- Netlify Blobs 的正確使用方式是查文件確認的，但因為環境限制沒辦法實際部署測試「真的連到 Netlify Blobs 環境」這件事，部署後第一次執行建議留意 `storageWarning` 欄位有沒有出現

**產出檔案（新增）**：
```
netlify/functions/lib/storage.mjs
netlify/functions/latest.mjs
netlify/functions/_test-storage.mjs
```

---

## 階段 8：Vue 前端 Dashboard（本階段）

**目標**：建立實際會呈現給使用者看的看盤 Dashboard。

**設計規劃**：
- 主題：深色看盤終端機風格，貼近台灣交易者熟悉的看盤軟體語彙，避開「暖米白+襯線+赤陶」「近黑+單一螢光色」「寬版報紙式」這幾種常見的 AI 生成樣板配色
- 色彩：暖墨黑底（#12131A）+ 語意化紅（#E14848，漲/多方）與綠（#1FA37A，跌/空方，**符合台股慣例，跟美股相反**）+ 金色點綴（#D7A233）+ 靛色（#6C7BD9，相對強弱因子專用）
- 字體：`Noto Serif TC`（標題）+ `Noto Sans TC`（內文）+ `IBM Plex Mono`（所有數字，等寬對齊，是看盤軟體的標準做法）
- 簽名元素：「因子解剖條」（ScoreBar）——每檔股票旁一條分段長條，視覺化三個因子對總分的貢獻比例，讓排名「有解釋」而不是黑盒子分數

**完成事項**：
1. **回頭補強後端**：發現 `factors.mjs` 原本只回傳最終總分，沒有保留個別因子的貢獻度，前端「因子解剖條」畫不出東西。修改 `computeCompositeScores` 額外回傳 `volumeContribution`／`gapContribution`／`relativeStrengthContribution`，`screen.mjs` 的空方觀察榜也一併帶出，並補測試驗證「三個貢獻度加總等於總分」
2. 建立 Vite + Vue 3 專案骨架：`vite.config.js`（含本機開發時轉發 API 請求到 `netlify dev` 的 proxy 設定）、`index.html`、`src/tokens.css`（設計 token）
3. 元件：
   - `ScoreBar.vue`：因子解剖條（簽名元素）
   - `WatchlistPanel.vue`：多方/空方觀察榜面板（股票列表）
   - `StatusBar.vue`：頂部狀態列（資料時間、大盤近似漲跌、候選檔數）
   - `App.vue`：抓資料、管理載入/錯誤狀態、組合版面
4. `src/sampleData.js`：格式與 `scan.mjs` 真實輸出完全一致的範例資料（用真實存在的台股代號/名稱，但數字是編的），本機開發沒有真實後端時自動 fallback 使用，並在畫面上明確標示「範例資料」，避免誤導
5. 響應式設計：手機寬度時雙欄改單欄；尊重 `prefers-reduced-motion`；可見的鍵盤 focus 樣式

**驗證方式**（前端無法像後端寫單元測試，這層改用其他方式驗證）：
- `npm run build`：確認整個 Vue 專案能正確編譯，Vue SFC 編譯器會抓出模板/語法錯誤 → 通過
- 啟動 `npm run dev`，用 curl 確認首頁與各元件模組都能被 Vite 正確轉譯、回傳 HTTP 200（代表沒有匯入錯誤或模組解析失敗）→ 通過
- **未能驗證**：實際視覺呈現好不好看、排版是否如預期，因為這個環境沒有瀏覽器可以截圖確認，需要使用者自己跑 `npm run dev` 打開瀏覽器看

**產出檔案（新增）**：
```
vite.config.js
index.html
src/tokens.css
src/main.js
src/App.vue
src/sampleData.js
src/components/ScoreBar.vue
src/components/WatchlistPanel.vue
src/components/StatusBar.vue
```

---

## 階段 9：前端架構重構——元件複用 + CSS 分層 + 導入 Tailwind（本階段）

**目標**：原本 Phase 8 的前端把版面／色彩直接寫死在各元件的 scoped `<style>` 裡，重複程度偏高（例如 `formatPercent` 在兩個元件裡各寫一份、`tone-surge`/`tone-ebb` 顏色規則在三個元件裡各寫一份）。這階段依需求重構：能複用的邏輯/樣式抽成共用元件或函式，CSS 分層並導入框架。

**完成事項**：
1. **導入 Tailwind CSS v4**（`@tailwindcss/vite` plugin，CSS-first 設定，不需要 `tailwind.config.js`）
2. **CSS 分兩層**：
   - `src/styles/theme.css`：只放設計 token，用 Tailwind 的 `@theme` 語法定義（不是普通的 `:root`），好處是色彩／字體 token 會**自動產生對應的工具類別**（例如 `--color-surge` 自動可以用 `text-surge`／`bg-surge`），元件不用再各自手寫顏色 CSS
   - `src/styles/base.css`：引入 `theme.css`，放全域基礎規則
   - 舊的 `src/tokens.css`（純 `:root` 變數）已移除
3. **抽出共用工具函式** `src/utils/format.js`：`formatPercent`／`formatPrice`／`formatDateTime`，取代原本在 `WatchlistPanel.vue` 跟 `StatusBar.vue` 裡各寫一份的重複邏輯
4. **抽出共用基礎元件** `src/components/base/`：
   - `Badge.vue`：通用徽章（目前用在市場標籤「上市/上櫃」，之後 Phase 2 的隔日沖介入標記也能直接複用）
   - `StatItem.vue`：通用「標籤+數值」統計項目，取代 `StatusBar.vue` 裡原本重複寫三次的區塊
5. **重寫三個主要元件**（`ScoreBar.vue`／`WatchlistPanel.vue`／`StatusBar.vue`）與 `App.vue`：版面／間距／色彩改用 Tailwind 工具類別直接寫在 template 裡，移除原本大量的 scoped `<style>` 區塊，只在真的沒有對應工具類別可以表達的地方（因子解剖條的動態寬度）保留少量 `:style` 綁定

**驗證方式**：
- `npm run build`：確認整個 Vue + Tailwind 專案能正確編譯 → 通過
- 檢查編譯後的 CSS 輸出，確認 `.text-surge`／`.bg-panel-raised`／`.font-display`／`.bg-signal` 這些「應該由 `@theme` 自動產生」的工具類別**真的出現在編譯結果裡**，而不是只是猜測設定有生效 → 確認存在
- 啟動 dev server，逐一 curl 所有新增/修改過的檔案模組，確認都回傳 HTTP 200（沒有匯入錯誤）→ 全部通過
- **未能驗證**：實際視覺呈現，同 Phase 8 的限制，需要使用者自己看

**已知未完成 / 待驗證**：
- 同前面階段：TPEx 欄位、TAIEX 真實指數、隔日沖分點因子、實際部署測試、視覺呈現的人工檢查

**產出檔案（新增/修改）**：
```
vite.config.js（修改，加入 tailwindcss() plugin）
src/styles/theme.css（新增）
src/styles/base.css（新增）
src/tokens.css（移除）
src/utils/format.js（新增）
src/components/base/Badge.vue（新增）
src/components/base/StatItem.vue（新增）
src/components/ScoreBar.vue（重寫）
src/components/WatchlistPanel.vue（重寫）
src/components/StatusBar.vue（重寫）
src/App.vue（重寫）
```

---

## 下一階段預告（尚未開始）

- 部署到 Netlify，實測並修正 TPEx 欄位對應、確認 Blobs 真的能存取、**請使用者親自檢查前端視覺呈現**
- 開始 Phase 2：隔日沖分點因子（分點查詢 + 設定檔）

---

## 階段 10：Phase 2 改道——用三大法人買賣超取代隔日沖分點因子（本階段）

**目標**：實作原本規劃的第四個因子。

**關鍵發現（改變了整個 Phase 2 的設計方向）**：
實測 TWSE 分點查詢系統（`bsr.twse.com.tw`）後發現該系統**有圖形驗證碼保護**，查不到乾淨的參數化 API。網路上其他人爬這份資料的做法都是額外接付費的驗證碼辨識服務。這代表：
1. 沒辦法在 Netlify Function 裡完全自動化查詢
2. 用程式繞過驗證碼本身就不是應該做的事（驗證碼是網站刻意設置的防護機制）

跟使用者確認後，改用**三大法人買賣超日報**（外資＋投信＋自營商）取代：免費、官方端點、可完全自動化。而且這個資料源是**全市場一次撈取**（不像分點資料需要「先篩選再逐檔查詢」），架構反而比原本規劃的兩階段設計更簡單。

**完成事項**：
1. 用真實請求驗證 T86 端點（`www.twse.com.tw/fund/T86`），確認欄位包含外資／投信／自營商買賣超明細，以及加總後的「三大法人買賣超股數」欄位可以直接使用
2. `lib/factors.mjs` 新增 `computeInstitutionalRatio`（法人買賣超股數 ÷ 當日成交量，正規化成可比較的比例），`computeCompositeScores` 改成四因子加權（量能 30% + 跳空 20% + 相對強弱 20% + 法人買賣超 30%），並在測試中確認四個貢獻度加總等於總分
3. `lib/institutional.mjs`：抓取 + 用 cheerio 解析 HTML 表格（這個端點回傳的是 HTML 不是乾淨 JSON）。解析邏輯刻意設計成「動態尋找欄位位置」而不是寫死欄位順序，如果報表格式改了、找不到預期欄位，會回傳空結果而不是用錯的欄位算出誤導性數字
4. 測試腳本 `_test-institutional.mjs`：用真實抓到的樣本資料（台泥買超、環泥賣超）重建 HTML fixture 驗證解析邏輯，並測試「格式跟預期不同時安全降級」的邊界情況
5. `lib/screen.mjs`：整合法人因子進候選股物件，**空方觀察榜的方向反轉邏輯也要一併更新**（法人賣超要反轉成正貢獻，邏輯跟跳空/相對強弱一樣，只有量能異常因子不反轉方向）；沒有法人資料的股票（目前只涵蓋上市，上櫃股票沒有這個資料源）預設為中性 0，不會排除或讓程式壞掉
6. `scan.mjs` 接上法人資料抓取，抓取失敗不會讓整個掃描失敗（優雅降級為「本次法人因子全部中性」），並在 `dataSourceStatus` 回報法人資料的抓取狀態
7. 前端：`ScoreBar.vue` 因子解剖條從三段改成四段，新增法人買賣超專用色彩 token（`--color-crest`，青色），`WatchlistPanel.vue`／`sampleData.js` 同步更新

**驗證方式**：
- `npm run test`：57 個測試案例，全數通過
- `npm run build`：確認前端改成四段解剖條後仍能正確編譯，且新色彩 token `.bg-crest` 確實出現在編譯後的 CSS

**已知未完成 / 待驗證**：
- TPEx（上櫃）欄位、TAIEX 真實指數：同前面階段
- 法人買賣超目前只涵蓋上市股票，上櫃股票這個因子固定中性
- ~~T86 端點的 `date` 參數是否可靠尚未驗證~~ → **已在階段 11 補強**
- 實際部署測試、視覺呈現的人工檢查

**產出檔案（新增/修改）**：
```
netlify/functions/lib/factors.mjs（修改）
netlify/functions/lib/institutional.mjs（新增）
netlify/functions/lib/screen.mjs（修改）
netlify/functions/scan.mjs（修改）
netlify/functions/_test-factors.mjs（修改）
netlify/functions/_test-screen.mjs（修改）
netlify/functions/_test-institutional.mjs（新增）
src/styles/theme.css（修改，新增 --color-crest）
src/components/ScoreBar.vue（修改，四段解剖條）
src/components/WatchlistPanel.vue（修改）
src/sampleData.js（修改）
src/App.vue（修改，footer 加入法人資料來源狀態）
```

---

## 階段 11：補強 T86 端點的日期可靠性防禦（本階段）

**目標**：處理階段 10 留下的技術債——T86 端點的 `date` 參數是否可靠沒有驗證過。比照 `history.mjs` 抓歷史資料時的做法：不要盲目信任送出去的參數，要驗證「回傳資料本身宣稱是哪一天」。

**完成事項**：
1. `lib/institutional.mjs` 新增 `extractReportDate`：從報表 HTML 裡擷取「115年05月11日」這種民國年日期格式，轉成西元日期，純函式、可獨立測試
2. `fetchInstitutionalNetBuy` 回傳格式改變：從單純回傳 `Map`，改成回傳 `{netBuyByCode, requestedDate, actualDate, dateMismatch}`，讓呼叫端可以判斷「這次拿到的資料是不是我要的那一天」
3. `scan.mjs` 更新：
   - 日期對不上時不會直接丟棄資料（資料本身可能還是有效的，只是不是當天的），而是在 `dataSourceStatus.institutional` 清楚標記警告，讓看結果的人知道這個因子可能不是當日資料
   - 區分「抓取完全失敗」（HTTP 錯誤等）跟「有抓到資料但日期對不上」兩種不同情況，用不同的狀態訊息呈現
4. 測試補上 `extractReportDate` 的驗證（真實日期格式樣本 + 找不到日期時安全回傳 null 的邊界情況）

**驗證方式**：`npm run test`，59 個測試案例，全數通過

**已知未完成 / 待驗證**：
- TPEx（上櫃）欄位、TAIEX 真實指數
- 法人買賣超只涵蓋上市股票
- T86 的 `date` 參數實際上會不會真的對不上，只有部署後實測才能知道——這次做的是「偵測機制」，不是「保證一定抓得到正確日期」，如果實測發現常態性對不上，可能需要改成比照 `history.mjs` 那樣「往前多試幾天，取回傳日期符合預期的那一次」
- 實際部署測試、視覺呈現的人工檢查

**產出檔案（修改）**：
```
netlify/functions/lib/institutional.mjs
netlify/functions/scan.mjs
netlify/functions/_test-institutional.mjs
```

---

## 階段 12：QA 測試工程師視角驗證（本階段）

**目標**：以測試工程師的角色，對整個專案做一次系統性驗證，確認功能與流程符合預期。詳細內容見獨立的 [TEST_REPORT.md](./TEST_REPORT.md)。

**完成事項摘要**：
1. 回歸測試：既有 51 個單元測試全過
2. **新增端對端整合測試**：之前每個模組都只被個別測試過，這次第一次真正完整執行 `scan.mjs` 的實際 handler（用假的 `fetch` 攔截所有對外請求），驗證模組真的有正確接在一起
3. **新增前後端資料結構一致性測試**：比對 `sampleData.js` 跟 `scan.mjs` 真實輸出的欄位結構，**發現並修正一個問題**——`screen.mjs` 把內部用的 `hasHistory` 標記不小心外洩到最終輸出
4. 新增邊界案例測試：全部資料源失敗、TPEx 欄位對不上時的降級行為
5. 前端建置與模組載入複驗

**總測試數**：87 個，全數通過

**明確劃出測試範圍外的項目**（需要真實網路/部署環境才能驗證，寫在 TEST_REPORT.md 裡，避免自己誤以為「測試都過了所以沒問題」）：TPEx 真實欄位、T86 date 參數可靠性、Netlify Blobs 真實讀寫、排程註冊、前端視覺呈現

**產出檔案（新增/修改）**：
```
netlify/functions/_test-integration-scan.mjs（新增）
netlify/functions/_test-integration-latest.mjs（新增）
netlify/functions/_test-schema-consistency.mjs（新增）
netlify/functions/_test-edge-all-sources-fail.mjs（新增）
netlify/functions/_test-edge-tpex-mismatch.mjs（新增）
netlify/functions/lib/screen.mjs（修改，修正 hasHistory 外洩問題）
TEST_REPORT.md（新增）
```

---

## 階段 13：部署後 debug——修正 scan.mjs 逾時導致 function crash（本階段）

**目標**：使用者實際部署到 Netlify 後，手動觸發 `/scan` 出現「This function has crashed / unknown error」。

**根因排查過程**：
Netlify function log 顯示兩次呼叫的 `Duration` 都剛好是 `30000 ms`——兩次都卡在同一個數字，不是隨機的執行時間分佈，判斷是**逾時**而不是程式碼例外。Netlify 逾時時瀏覽器看到的訊息剛好也是籠統的「unknown error」，跟真正的 crash 長得一樣，容易誤判方向。

**根本原因**：`history.mjs` 的 `fetchVolumeHistory` 用 `for...of` 迴圈序列抓取最多 12 個候選交易日，每次都要完整等上一個請求回應才發下一個；加上 `scan.mjs` 原本是「TWSE+TPEx（平行）→ 等歷史資料 → 等法人資料」的序列結構，三個階段的等待時間加總起來很容易超過 Netlify 的執行時間上限。這是 Phase 1/2 開發時只驗證邏輯正確性、沒有在真實網路延遲下驗證效能的技術債。

**完成事項**：
1. `history.mjs`：`fetchVolumeHistory` 改成用 `Promise.allSettled` 把全部候選日期的請求一次平行發出，不再序列等待；處理結果時依候選日期原本順序（由近到遠）篩選，確保平行化前後的 `datesUsed` 結果順序一致
2. `scan.mjs`：TWSE、TPEx、歷史資料、法人資料四個彼此獨立的資料來源全部改成一次 `Promise.allSettled` 平行發出，不再是「抓完一批才抓下一批」的階段式序列
3. **回歸測試時發現並修正一個測試本身的 bug**：`_test-integration-scan.mjs` 的假 `fetch` 函式裡，`text: async () => historyCsvFixture(historyCallCount)` 直接引用外層可變的 `historyCallCount` 變數（閉包陷阱）。序列版本因為每個請求完整跑完才發下一個，恰好沒有暴露這個問題；改成平行後，所有請求幾乎同時觸發，等到 `.text()` 真正被呼叫時 `historyCallCount` 已經被其他呼叫累加到最終值，導致每筆假資料都拿到同一個（而且格式錯誤）的日期。修正方式：呼叫當下就用區域變數把值快照起來，不要讓返回的閉包直接引用外層可變變數

**驗證方式**：`npm run test`，87 個測試案例，全數通過（過程中先出現 4 個失敗，定位到是測試 mock 本身的閉包問題，修正測試後全過，不是 production code 的問題）

**已知未完成 / 待驗證**：
- 這次修正的是「大幅縮短總執行時間」，但沒有能力在這個環境實測「改完之後在 Netlify 上真的不會逾時了」，需要使用者重新部署後在 DEPLOY_CHECKLIST.md 第 4 步重新驗證
- 如果平行化後還是偶爾逾時（例如 TWSE/TPEx 全市場資料本身回應就很慢），下一步可以考慮把 `scan.mjs` 拆成「排程背景執行」跟「手動查詢」兩支不同的 function，背景執行可以用 Netlify Background Functions（執行時間上限更長），手動查詢則改成讀 Blobs 裡上次背景執行存的結果，不用每次都重新抓一次全市場資料
- TPEx 欄位、T86 date 參數可靠性、Blobs 讀寫、排程註冊、前端視覺呈現：同前面階段

**產出檔案（修改）**：
```
netlify/functions/lib/history.mjs
netlify/functions/scan.mjs
netlify/functions/_test-integration-scan.mjs
```

---

## 下一階段預告（尚未開始）

- 使用者重新部署，重新驗證 DEPLOY_CHECKLIST.md 第 4 步是否還會逾時
- 若仍逾時，考慮拆成排程背景執行 + 手動查詢兩支 function 的架構
- TPEx 欄位對應、T86 date 參數可靠性、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 14：部署後 debug（二）——平行化不夠，找出真正的 30 秒硬上限（本階段）

**目標**：階段 13 把序列請求改成平行後，使用者重新測試仍然 crash。需要更根本的修正。

**根因排查**：查證 Netlify 官方文件（2026 現況）確認：
- `scan.mjs` 因為有 `export const config = { schedule: ... }`，屬於 **Scheduled Function**，這類 function **不管用什麼方式呼叫（含手動打開網址），執行時間上限固定是 30 秒，跟付費方案無關**——這正好解釋了兩次 log 都精準卡在 `30000 ms`
- 免費方案的一般同步 function 更嚴格，只有 10 秒
- Background Functions（15 分鐘上限）**只有付費方案（Pro，$20/月起）才能用**，免費方案完全用不到，不能當作免費方案下的解法

結論：光靠平行化不夠，因為總工作量（多天全市場歷史資料 + 今日行情 + 法人資料）本身就太大，塞不進 30 秒的硬上限，必須真正減少工作量。

**完成事項**：
1. `history.mjs`：
   - 預設抓取天數從 5 天降到 3 天、候選嘗試次數從 12 降到 6，用「均量統計基礎稍微變小」換取「大幅降低逾時風險」
   - 單一天的請求加上 8 秒逾時保護（`AbortSignal.timeout(8000)`），避免單一慢請求拖垮整個預算
2. `scan.mjs`：TWSE／TPEx 主要行情請求也加上 10 秒逾時保護
3. `institutional.mjs`：法人資料端點加上 8 秒逾時保護
4. 更新相關測試的期望值（天數從 5 改成 3）

**驗證方式**：`npm run test`，87 個測試案例，全數通過

**這次沒辦法在這裡驗證的事**：這個環境沒辦法量測「改完之後在 Netlify 真實環境下的實際執行時間」，縮減天數跟加上逾時保護能不能真的塞進 30 秒，還是要使用者重新部署後實測才知道。

**如果這次還是不夠，下一步的備案**（已經比較確定要往這個方向走）：
把「抓資料」跟「算因子」拆開——寫一支獨立的排程 function，每天只抓「今天」的市場快照（一次性、快），累積存進 Netlify Blobs，滾動保留最近幾天。`scan.mjs` 改成從 Blobs 讀取已經存好的歷史資料，而不是每次都重新對 TWSE 發出好幾天份的請求——這樣可以把「多天歷史資料」這個目前最花時間的部分，從單次執行的關遉路徑上整個拿掉。代價是剛部署的前幾天，Blobs 裡還沒有足夠的歷史資料可以用，量能異常因子會暫時是中性值，需要幾天才能「暖機」到有完整資料。

**產出檔案（修改）**：
```
netlify/functions/lib/history.mjs
netlify/functions/lib/institutional.mjs
netlify/functions/scan.mjs
netlify/functions/_test-integration-scan.mjs
```

---

## 下一階段預告（尚未開始）

- 使用者重新部署，重新驗證是否還會逾時
- 若仍逾時，實作「排程抓資料存 Blobs + scan.mjs 只讀 Blobs」的架構調整
- TPEx 欄位對應、T86 date 參數可靠性、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 15：改成 Blobs 累積式歷史資料架構（本階段）

**目標**：階段 14 的平行化＋縮減天數還是逾時，需要真正把「多天歷史資料」這個最花時間的部分從關鍵路徑上拿掉，而不是想辦法把它塞進 30 秒裡。使用者提議「分開區間抓」或「分開排程」，討論後選擇更簡潔的方案：不用兩支協調的排程，讓 `scan.mjs` 每天執行時「順手」把當天資料存進 Blobs 累積，自然形成滾動歷史。

**完成事項**：
1. `lib/volume-archive.mjs`（新增）：
   - `appendDailySnapshot`：把某一天的成交量快照存進 Blobs，同一天重複執行會覆蓋而不是重複累加，並維護一份日期索引
   - `getRecentVolumeHistory`：讀取最近 N 天的快照組成歷史資料，回傳格式跟原本 `history.mjs` 的 `fetchVolumeHistory` 完全一致（`screen.mjs` 完全不用改）
   - 保留最近 15 天，超過的舊快照會被主動刪除，避免 Blobs 無限增長
   - 跟 `storage.mjs` 一樣用「可注入 store」的設計，測試不用連真實 Blobs 環境
2. `scan.mjs` 大改：
   - 移除現場抓多天歷史資料的呼叫，改成平行讀取 Blobs 累積庫（`getRecentVolumeHistory`）
   - 算完之後，把今天的資料存進累積庫（`appendDailySnapshot`），供明天使用
   - `dataSourceStatus` 新增 `historyArchive` 欄位，清楚回報「累積了幾天、夠不夠、有沒有寫入失敗」
3. `backfill-history.mjs`（新增）：一次性手動工具，沿用舊的 `history.mjs` 現場抓取邏輯，把過去幾天的真實資料直接灌進 Blobs 累積庫，讓使用者部署後不用乾等 2-3 天自然暖機。刻意不加排程設定，只給手動觸發，且逾時了也無妨（純加速用，非必需）
4. `history.mjs`（保留但改變角色）：不再被 `scan.mjs` 直接使用，只被 `backfill-history.mjs` 使用
5. 測試大幅調整以反映新架構：
   - 新增 `_test-volume-archive.mjs`（11 案例）
   - `_test-integration-scan.mjs`／`_test-schema-consistency.mjs`／`_test-edge-tpex-mismatch.mjs` 因為這個測試環境沒有真實 Blobs，過去依賴「scan.mjs 現場抓歷史資料」的假資料設計整套失效，改成驗證「沒有 Blobs 時應該優雅降級成空觀察榜＋清楚的狀態訊息」，而不是想辦法在測試裡繞過 Blobs 限制硬湊出資料。原本「排名邏輯本身對不對」的覆蓋率由 `_test-screen.mjs`（不依賴網路/Blobs，直接建構輸入）保留，沒有因此漏掉

**驗證方式**：`npm run test`，94 個測試案例，全數通過；`npm run build` 前端建置正常

**已知未完成 / 待驗證**：
- **這次的修正沒辦法在這個環境驗證「Netlify 上實際執行時間有沒有真的縮短到安全範圍」**，只能確認邏輯正確跟本地測試通過，實際效果要使用者重新部署後才知道
- 剛部署的前幾天（或還沒跑 `backfill-history`）觀察榜會是空的，這是設計上的已知行為，不是 bug，已經寫進 DEPLOY_CHECKLIST.md
- `backfill-history.mjs` 本身還是用舊的現場多天抓取邏輯，理論上還是有機會逼近逾時上限，但因為不在自動化的關鍵路徑上、且是一次性手動工具，风险可以接受
- TPEx 欄位、T86 date 參數可靠性、Blobs 真實讀寫、排程註冊、前端視覺呈現：同前面階段

**產出檔案（新增/修改）**：
```
netlify/functions/lib/volume-archive.mjs（新增）
netlify/functions/backfill-history.mjs（新增）
netlify/functions/scan.mjs（大改）
netlify/functions/_test-volume-archive.mjs（新增）
netlify/functions/_test-integration-scan.mjs（重寫）
netlify/functions/_test-schema-consistency.mjs（重寫）
netlify/functions/_test-edge-all-sources-fail.mjs（修改）
netlify/functions/_test-edge-tpex-mismatch.mjs（修改）
src/sampleData.js（修改，加入 historyArchive 欄位）
```

---

## 階段 16：補上 backfill-history.mjs 的整合測試（本階段）

**目標**：階段 15 新增的 `backfill-history.mjs` 當時只做了語法檢查，沒有像 `scan.mjs` 一樣寫端對端整合測試。使用者追問「這部分完成了嗎」，老實檢視後承認還沒有，補上。

**完成事項**：
`_test-integration-backfill.mjs`：直接呼叫 `backfill-history.mjs` 的 handler，驗證兩種情境：
- 歷史資料抓得到，但這個測試環境沒有真實 Blobs 可寫入 → 應優雅回傳 500 + 清楚錯誤訊息，而不是未捕捉例外崩潰
- 連歷史資料都抓不到（TWSE 端點全部失敗）→ 應回傳 500，且錯誤訊息明確指出「沒有抓到任何歷史交易日資料」

4 個案例全過，確認 `backfill-history.mjs` 在異常情況下的降級行為符合預期。

**驗證方式**：`npm run test`，98 個測試案例，全數通過

**已知的一個小缺口（沒有動手修，先記錄）**：
`backfill-history.mjs` 裡把多天資料寫進 Blobs 的迴圈沒有「單一天寫入失敗不影響其他天」的保護——如果第一天寫入成功、第二天失敗，目前會讓整個請求回傳 500，即使第一天其實已經寫成功了。這在真實 Netlify 環境下風險不高（Blobs 通常要嘛整體能用、要嘛整體不能用，不太會只有某一天寫入特別失敗），而且這支本來就是「錦上添花」的手動工具，不在自動化的關鍵路徑上，先不處理，記錄下來備查。

**產出檔案（新增）**：
```
netlify/functions/_test-integration-backfill.mjs
```

---

## 下一階段預告（尚未開始）

- 使用者重新部署，執行 DEPLOY_CHECKLIST.md（含新增的第 3.5 步 `backfill-history`），確認 `scan` 不再逾時
- TPEx 欄位對應、T86 date 參數可靠性、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 17：避開非交易日 + backfill 改成智慧跳過已存在的天數（本階段）

**目標**：使用者提出兩個要求：(1) 抓取跟回填的資料都要避開週六日 (2) `backfill-history.mjs` 每次都補「還沒存過」的新交易日，而不是每次都補同樣的最近 3 天。

**完成事項**：
1. `lib/trading-day.mjs`（新增）：把「判斷週末」「產生候選交易日清單」抽成共用模組，避免 `history.mjs` 跟 `backfill-history.mjs` 各寫一份容易長出不一致的行為。`history.mjs` 改成從這裡匯入並重新匯出（保留舊有的 import 路徑相容性，不影響既有測試）
2. `history.mjs`：把原本私有的 `fetchOneDay` 開放匯出，讓 `backfill-history.mjs` 可以針對「特定候選日期」個別抓取，不用被綁死在「抓最近 N 天」的固定邏輯裡
3. `volume-archive.mjs` 新增 `getArchivedDates`：讀取目前已經存進 Blobs 累積庫的日期清單，給 backfill 判斷哪些天不用重複補
4. `scan.mjs`：寫入歷史累積庫前先檢查今天是不是週末，是的話跳過寫入（TWSE 端點在週末還是會回傳最近一個交易日的資料，但不該把它標記成「今天（週末）」存進歷史，避免同一份交易日資料被扭曲成兩筆不同的天）
5. `backfill-history.mjs` 整個重寫：
   - 新增純函式 `pickNewTradingDays`：從一批候選日期的抓取結果裡，跳過已存在的日期跟抓取失敗/重複的結果，挑出指定天數的新交易日，往前找直到湊滿或候選清單用完
   - 候選日期一樣全部平行發出（沿用階段 14 的效能教訓）
   - 執行邏輯：讀取已存日期 → 平行抓候選交易日 → 用 `pickNewTradingDays` 挑出新的 3 天 → 逐一存入累積庫
   - 重複執行這支 function 會自動往更早的交易日繼續補，不會補到重複的天

**驗證方式**：
- `_test-trading-day.mjs`（6 案例）：`isWeekend`／`getPastTradingDayCandidates` 純函式測試
- `_test-backfill-pick.mjs`（6 案例）：`pickNewTradingDays` 的核心邏輯完整測試，涵蓋全新／部分已存在／抓取失敗／重複日期／空輸入等情境，**這是這次最重要的測試**，不需要網路或 Blobs 就能驗證核心邏輯對不對
- `_test-volume-archive.mjs` 補上 `getArchivedDates` 測試（新增 2 案例）
- `_test-integration-backfill.mjs` 重寫：老實承認因為 `backfill-history.mjs` 現在一開始就會呼叫 `getArchivedDates()` 讀 Blobs，這個測試環境沒有真實 Blobs，兩個「情境」實際上都會在同一步失敗，原本想測的「TWSE 全部失敗」路徑測不到（因為連 Blobs 都先失敗了）——調整測試誠實反映現況，只驗證「沒有 Blobs 時優雅回傳 500」，核心挑選邏輯已經由 `_test-backfill-pick.mjs` 完整覆蓋
- `npm run test`：**110 個測試案例，全數通過**；`npm run build` 前端建置正常

**已知未完成 / 待驗證**：
- 只排除週六日，沒有排除國定假日（過年、清明連假等），刻意的簡化，已在 README 說明
- `backfill-history.mjs` 平行抓 15 個候選日期會不會逾時，還是要實際部署後才知道（跟階段 15 同樣的限制：這個環境沒辦法量測真實 Netlify 環境下的執行時間）
- TPEx 欄位、T86 date 參數可靠性、Blobs 真實讀寫、排程註冊、前端視覺呈現：同前面階段

**產出檔案（新增/修改）**：
```
netlify/functions/lib/trading-day.mjs（新增）
netlify/functions/lib/history.mjs（修改，改用共用模組、開放 fetchOneDay）
netlify/functions/lib/volume-archive.mjs（修改，新增 getArchivedDates）
netlify/functions/scan.mjs（修改，週末跳過寫入歷史）
netlify/functions/backfill-history.mjs（重寫）
netlify/functions/_test-trading-day.mjs（新增）
netlify/functions/_test-backfill-pick.mjs（新增）
netlify/functions/_test-volume-archive.mjs（修改）
netlify/functions/_test-integration-backfill.mjs（重寫）
```

---

## 下一階段預告（尚未開始）

- 使用者重新部署，執行 DEPLOY_CHECKLIST.md，確認 `scan` 不再逾時、`backfill-history` 的跳過邏輯運作正常
- TPEx 欄位對應、T86 date 參數可靠性、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 18：限制盤後時間才寫入歷史 + 幫 backfill 加診斷資訊（本階段）

**目標**：使用者回報兩件事：(1) `backfill-history` 抓不到之前交易日的資料 (2) `scan` 應該限制在台灣時間下午 2 點後才更新當天資料，確保用的是準確的盤後資料。

**完成事項**：

1. **限制盤後時間**（明確需求，直接實作）：
   - `lib/trading-day.mjs` 新增 `isMarketDataReady`：判斷現在是否已過台灣時間下午 2 點，用 UTC 時間換算（不依賴伺服器時區設定，Netlify Functions 環境比較保險）
   - `scan.mjs`：寫入歷史累積庫前，除了原本的週末檢查，再加一層「是否已過台灣時間下午 2 點」的檢查，沒過就不寫入（但仍會照常抓取、計算、回傳結果給使用者看，只是不會把這次的資料當作「今天的正式收盤資料」存進歷史）。排程本身設定在台灣時間 14:10 觸發，本來就會通過這個檢查，這層防呆主要是給使用者提早手動測試的情況
   - 測試：`_test-trading-day.mjs` 新增 5 個案例，涵蓋剛好卡在下午 2 點的邊界、跨日邊界情況

2. **backfill 抓不到歷史資料**（沒有足夠資訊確定根本原因，先加診斷工具而不是亂猜著改）：
   - 這個環境沒辦法重現真實部署後的網路行為，不能單憑症狀描述就判斷是「TWSE date 參數被完全忽略」「平行請求被擋」還是「資料格式跑掉」，貿然猜一個原因去改很可能改錯方向
   - 改為在 `backfill-history.mjs` 的回應裡加上 `debugInfo` 欄位，列出每個候選日期「送出去的參數」跟「實際拿回來的日期／筆數／錯誤訊息」，不管是哪種原因都能從這份資料直接看出來
   - 已經在 README／DEPLOY_CHECKLIST.md 說明三種可能的判讀方式，並請使用者下次遇到問題時把 `debugInfo` 貼回來

**驗證方式**：`npm run test`，115 個測試案例，全數通過

**已知未完成 / 待驗證**：
- **backfill 抓不到歷史資料的根本原因還沒有定論**，需要使用者用新版的 `debugInfo` 重新跑一次、回報結果，才能真正對症下藥，這是下一步最優先要處理的事
- 只排除週六日，沒有排除國定假日
- TPEx 欄位、T86 date 參數可靠性、Blobs 真實讀寫、排程註冊、前端視覺呈現：同前面階段

**產出檔案（修改）**：
```
netlify/functions/lib/trading-day.mjs
netlify/functions/scan.mjs
netlify/functions/backfill-history.mjs
netlify/functions/_test-trading-day.mjs
```

---

## 下一階段預告（尚未開始）

- **等待使用者提供 `backfill-history` 的 `debugInfo` 回應內容，診斷抓不到歷史資料的根本原因**
- 使用者重新部署，確認 `scan` 在下午 2 點前後的行為符合預期
- TPEx 欄位對應、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 19：找到 backfill 逾時的真正原因——TWSE 併發限制（本階段）

**目標**：使用者回報 `backfill-history` 的 `debugInfo` 顯示所有請求的 `error` 都是 `The operation was aborted due to timeout`，並直接指出解法：一次只發 3 個請求。

**根因確認**：階段 18 加的 `debugInfo` 診斷工具發揮作用了——這次不用再猜，錯誤訊息直接證實是階段 18 列出的三種可能原因之一：「大部分 `error` 有值 → 平行發送太多請求被 TWSE 擋掉（併發限制）」。原本 `backfill-history.mjs` 一次平行發 15 個請求，全部卡在 `AbortSignal.timeout(8000)` 逾時。

**完成事項**：
1. `backfill-history.mjs` 重構：
   - 新增 `chunk` 輔助函式，把候選交易日切成每批 3 個（`BATCH_SIZE = 3`）
   - 改成分批處理：一批一批發送（批次內平行、批次之間循序），每批處理完就檢查是否已經湊滿 3 天新資料，湊滿就提早停止、不發後續批次，兼顧成功率跟速度
   - `pickNewTradingDays` 這個核心挑選邏輯完全沒動（純函式，介面沒變），只是呼叫方式從「一次餵全部候選結果」改成「每批餵一次，用累積的 `seenDates` 跨批次追蹤已經挑到的日期，避免不同批次挑到重複的天」
2. 測試：`chunk` 函式補上 4 個獨立測試案例；`pickNewTradingDays` 的既有 6 個測試不用改（介面沒變，全過確認沒有回歸）

**驗證方式**：`npm run test`，119 個測試案例，全數通過

**這次測試沒辦法完整覆蓋的部分**：`getArchivedDates()` 在這個環境一定會因為沒有真實 Blobs 而失敗，導致沒辦法用完整的 handler 整合測試驗證「分批 + 提早停止」這個新的排程邏輯在真實情況下的行為（例如：第一批 3 個裡有幾個已經是舊資料時，會不會正確接著發第二批）。這個邏輯的正確性目前只能靠程式碼邏輯檢視跟 `chunk`／`pickNewTradingDays` 個別驗證過的純函式組合起來推論，實際行為要部署後再觀察一次 `debugInfo` 確認

**產出檔案（修改）**：
```
netlify/functions/backfill-history.mjs
netlify/functions/_test-backfill-pick.mjs
```

---

## 下一階段預告（尚未開始）

- 使用者重新部署，重新測試 `backfill-history`，確認分批之後不再逾時、確實能補到之前的交易日資料
- TPEx 欄位對應、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 20：分批解決逾時後，發現更根本的問題——date 參數疑似被 CDN 快取忽略（本階段）

**目標**：使用者提供階段 19 修正後的 `debugInfo`，逾時問題確實解決了（`error` 全部是 `null`），但發現新問題：不管送出去的 `date` 參數是哪一天，回傳的 `actualDate` 全部都是同一天（今天）。

**根因研判**：這符合階段 18 列出的第一種可能原因「如果每筆 `actualDate` 都一樣 → date 參數可能被 TWSE 端完全忽略」。進一步推測最可能是 TWSE 網站前面的 CDN 快取沒有把 `date` 參數算進快取鍵值，導致不管請求哪一天，都拿到同一份被快取住的「最新資料」回應。

**完成事項**：
1. `history.mjs` 的 `fetchOneDay` 加上快取破解機制：
   - URL 加上一個每次都不同的亂數參數（cache-busting），強迫請求繞過任何以完整網址比對的快取
   - 加上 `Cache-Control: no-cache` 與 `Pragma: no-cache` 的 request header 雙重保險
2. 順便釐清使用者的疑慮：分批送出（每批 3 個）的邏輯本身沒有跑掉，只是因為每批拿回來的資料都跟已存的日期重複，程式會照設計往前找完所有候選（最多 5 批 × 3 個 = 15 個請求，但同時間確實只有 3 個在跑），這是「一直找不到新資料」的正常延伸行為

**驗證方式**：`npm run test`，119 個測試案例，全數通過（這次修改不影響任何測試邏輯，因為測試用的都是假的 fetch，不會真的送出網址，语法檢查跟既有測試都過)

**這次沒把握能解決問題，老實說清楚**：
加快取破解參數是「值得先試的方向」，但沒辦法保證有效——如果問題其實是 TWSE **伺服器本身**（不是前面的 CDN）就忽略 date 參數、永遠回傳最新資料，那快取破解不會有幫助。已經先想好 Plan B：如果這次還是一樣的症狀，代表這個 TWSE 端點（`www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL`）沒辦法用來取得特定歷史日期的全市場資料，屆時 `backfill-history.mjs` 這個「一次性補資料」的功能會沒辦法達成原本的目的，需要改成完全依賴 `scan.mjs` 每天自然累積（3 個交易日的暖機期無法用 backfill 加速），或是另外找別的資料來源。

**產出檔案（修改）**：
```
netlify/functions/lib/history.mjs
```

---

## 下一階段預告（尚未開始）

- **等待使用者提供加上快取破解後的新 `debugInfo`**，確認是否解決「date 參數被忽略」的問題
- 如果還是一樣的症狀，執行 Plan B：放棄透過這個端點做歷史回填，改成完全依賴 `scan.mjs` 自然累積
- TPEx 欄位對應、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 21：找到正確的歷史資料端點——MI_INDEX 取代 STOCK_DAY_ALL（本階段）

**目標**：階段 20 的快取破解沒有機會驗證是否有效——使用者直接提供了確認可行的正確端點，跳過了「Plan B 放棄回填」的分支。

**使用者提供的關鍵資訊**：`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20260708&type=ALLBUT0999NOTIND&response=json` 這個端點，`date` 參數是真的有效的。用真實請求驗證確認：回傳資料的標題「115年07月08日 每日收盤行情」跟送出去的 `date=20260708` 完全吻合。原本用的 `STOCK_DAY_ALL` 端點才是問題所在——回頭看，先前的「CDN 快取」推測方向是對的（`MI_INDEX` 沒有這個問題），但具體是哪個端點有問題，最終是靠使用者提供的資訊才確定，不是靠我這邊的推測解決的。

**完成事項**：
1. `history.mjs` 整個重寫，改用 `MI_INDEX` 端點，並處理跟原本 `STOCK_DAY_ALL`／CSV 格式完全不同的回應結構：
   - `MI_INDEX` 回傳 JSON，但結構是 `{ tables: [...] }` 陣列，裡面好幾個表格是空的（其他報表類型用的），真正的資料要用 `fields` 裡有沒有「證券代號」動態找出來，不能寫死陣列位置
   - 「漲跌」的正負號是獨立欄位（一段帶顏色的 HTML，`color:green` 是跌、`color:red` 是漲，符合台股慣例），跟漲跌幅度數字（永遠是正數）是分開的兩個欄位，需要合併判讀才能還原出正確帶符號的漲跌值
   - 新增 `parseMiIndexResponse` 純函式處理上述解析邏輯，拆出來方便用固定樣本測試，不用每次都連網路
   - 日期驗證邏輯重用 `institutional.mjs` 的 `extractReportDate`（跟 T86 端點是同一種民國年日期字串格式，避免重複寫一份解析邏輯）
   - `normalize.mjs` 的 `toNumber` 開放匯出，供 `history.mjs` 共用
2. `_test-history.mjs` 大幅重寫：舊的 CSV 格式假資料全部改成 `MI_INDEX` 的 JSON 格式，新增 `parseMiIndexResponse` 的獨立測試（含正常解析、漲跌正負號、找不到表格、JSON 格式錯誤等邊界情況），共新增 6 個案例

**驗證方式**：`npm run test`，**125 個測試案例，全數通過**；`npm run build` 前端建置正常

**已知未完成 / 待驗證**：
- **這是這次除錯過程中第一次有具體證據支持的修正**（前面兩次的快取破解、分批發送都是合理推測但沒有直接證據），但仍然沒辦法在這個環境實際驗證部署後真的能抓到不同天的資料，需要使用者重新部署、重新跑一次 `backfill-history` 確認
- `csv.mjs`／`normalize.mjs` 的 CSV 相關函式（`normalizeTwseCsvRow`／`extractDateFromCsvRow`）現在沒有任何模組在使用，但保留下來（有獨立測試，之後如果接到其他 CSV 格式的資料源可以直接重用）
- TPEx 欄位對應、Blobs 讀寫、排程註冊、前端視覺呈現：同前面階段

**產出檔案（修改）**：
```
netlify/functions/lib/history.mjs（重寫）
netlify/functions/lib/normalize.mjs（修改，toNumber 開放匯出）
netlify/functions/_test-history.mjs（重寫）
```

---

## 下一階段預告（尚未開始）

- **使用者重新部署，重新測試 `backfill-history`，確認 `MI_INDEX` 端點在真實環境下真的能抓到不同天的資料**
- TPEx 欄位對應、Blobs 讀寫、排程註冊、前端視覺呈現

---

## 階段 22：確認 backfill 已部署可用 + 新增新手教學文件（本階段）

**目標**：使用者確認 `backfill-history` 換成 `MI_INDEX` 端點後可以成功抓到資料。過程中釐清一個容易混淆的地方，並補上給終端使用者（當沖交易者，不是開發者）看的教學文件。

**釐清事項**：使用者檢查 Netlify Blobs 後台的 `scan-results` store 的 `by-date` 沒看到 backfill 補的日期，一度以為沒有真的寫入。實際上專案有兩個獨立的 Blobs store：`scan-results`（`scan.mjs` 寫，存完整掃描結果，key 是 `by-date/YYYY-MM-DD`）跟 `volume-archive`（`scan.mjs` 自動累積＋`backfill-history.mjs` 手動補都寫這裡，只存原始成交量快照，key 是 `snapshot:YYYY-MM-DD`）。backfill 補的資料在後者，不是前者，找對 store 後確認資料確實有寫入。

**完成事項**：
新增 [`USER_GUIDE.md`](./USER_GUIDE.md)——這是第一份給**終端使用者**（實際用這個工具做當沖判斷的交易者）看的文件，跟先前的 README／PROGRESS／TEST_REPORT／DEPLOY_CHECKLIST（都是給開發者/維護者看的）性質不同。內容涵蓋：
1. 工具定位與免責聲明
2. 畫面逐項解說（狀態列、多空觀察榜、因子解剖條的顏色對應）
3. 四個因子的白話說明＋公式＋直覺解釋（量能異常、跳空幅度、相對大盤強弱勢、三大法人買賣超）
4. 分數計算原理（百分位排名、加權合計、多空觀察榜方向反轉邏輯的說明，特別解釋「為什麼空方榜不是把多方分數倒過來排」這個容易誤解的地方）
5. 資料新鮮度說明（下午2點限制、週末不更新、暖機期）
6. 常見問題 FAQ

寫完後逐項對照現有程式碼（`factors.mjs` 的權重數字、`history.mjs` 的 3 天暖機設定、`trading-day.mjs` 的下午 2 點限制、`screen.mjs` 的多空反轉邏輯）確認內容跟實際行為一致，沒有寫錯或跟系統脫節。

**產出檔案（新增/修改）**：
```
USER_GUIDE.md（新增）
README.md（修改，加入連結）
```

---

## 下一階段預告（尚未開始）

- TPEx 欄位對應、Blobs 讀寫細節、排程註冊、前端視覺呈現
- 持續觀察 `backfill-history` 在真實環境下的穩定度（換成 `MI_INDEX` 端點後才剛驗證成功，還需要多次使用觀察是否穩定）

---

## 階段 23：新增篩選功能（成交量／股價／漲跌幅）（本階段）

**目標**：使用者想在觀察榜加上依成交量、股價、漲幅篩選的功能，先做分析跟建議再動工。

**設計分析與決策**：篩選有兩種做法——後端篩選（篩完再進百分位排名，會影響分數）vs 前端篩選（排名算完之後才過濾顯示，不影響分數）。選擇**前端篩選**，理由：
1. 分數語意保持一致（「這檔股票在全市場的相對表現」），不會因為調整篩選條件讓同一檔股票分數飄移
2. 前端可以即時調整，不用等 `scan` 重新跑一次（10-30 秒等級的操作）
3. 不會動到已經測試過 125 個案例的後端排名邏輯

使用者對三個確認問題（成交量用原始股數或量能倍數、候選池要拉多大、UI 形式）沒有明確回覆，依「合理預設＋明講假設」的原則繼續：成交量用原始股數（兩種都保留：新增 `volume` 原始欄位，`volumeRatio` 倍數維持原樣）、候選池拉到 Top 100、UI 先做簡單數字輸入框。

**完成事項**：
1. **後端**：
   - `screen.mjs` 的候選股物件新增 `volume`（原始成交股數），供前端篩選用（跟 `volumeRatio` 倍數是不同東西）
   - `topN` 預設從 30 拉大到 100（`screen.mjs` 的預設值＋`scan.mjs` 呼叫端都同步更新）
   - `src/sampleData.js` 補上 `volume` 欄位，跟後端真實輸出結構同步（用 schema 一致性測試抓到少了這個欄位，修正後過）
2. **前端**：
   - `src/utils/filterWatchlist.js`：篩選核心邏輯，刻意寫成跟 Vue 無關的純函式（跟後端 `factors.mjs`／`screen.mjs` 的設計哲學一致），可以直接用 `node` 測試
   - `src/components/FilterPanel.vue`：篩選面板元件，四個數字輸入框（最低/最高股價、最小成交量、最小漲跌幅度），用 Vue 3.4 的 `defineModel` 做雙向綁定
   - `App.vue` 接上篩選：用 `computed` 即時算出過濾後的多空觀察榜，篩選啟用時顯示「已套用篩選：X/Y 檔」的提示，篩選後沒有結果時顯示對應的空狀態訊息（跟原本「今日沒有符合條件」的空狀態文字分開，避免使用者誤以為是資料源出問題）
   - `WatchlistPanel.vue` 每一列加上成交量顯示（換算成「張」，符合台股慣例，比原始股數直覺），`utils/format.js` 新增 `formatVolume`
   - 漲跌幅篩選刻意設計成「取絕對值」，讓多方/空方觀察榜可以共用同一個門檻數字（多方看漲幅有沒有超過門檻，空方看跌幅有沒有超過門檻），不用做成兩套獨立條件

**驗證方式**：
- `_test-filterWatchlist.js`：13 個案例，涵蓋單一條件、多條件同時套用、邊界情況（空物件、全部 null），**過程中抓到一個測試案例自己算錯期望值的失誤**（不是程式邏輯錯，是我手動驗算多條件情境時漏算了一檔股票也符合條件），修正測試期望值後過
- `npm run test`：**138 個測試案例，全數通過**
- `npm run build`：前端編譯正常；dev server 下所有新增/修改的模組都能正確載入

**已知未完成 / 待驗證**：
- ~~篩選 UI 目前只有數字輸入框，使用者原本提到「之後可以優化成滑桿」，先不做~~ → **已於階段 24 完成拖曳式控制與價格帶按鈕，並於後續修正股價區間著色與上限設定。**
- 前端篩選邏輯的核心函式有測試，但 Vue 元件本身（`FilterPanel.vue`／`App.vue` 的響應式串接）沒有元件層級的測試，這個專案目前也還沒有架設瀏覽器/元件測試環境，維持跟先前階段一樣「核心邏輯測、元件靠建置成功＋人工檢查」的驗證水準
- TPEx 欄位、Blobs 讀寫細節、排程註冊、前端視覺呈現（含這次新增的篩選面板長什麼樣子）：同前面階段，需要使用者實際看畫面確認

**產出檔案（新增/修改）**：
```
netlify/functions/lib/screen.mjs（修改，新增 volume 欄位、topN 預設改 100）
netlify/functions/scan.mjs（修改，topN 改 100）
src/sampleData.js（修改，補 volume 欄位）
src/utils/filterWatchlist.js（新增）
src/utils/_test-filterWatchlist.js（新增）
src/utils/format.js（修改，新增 formatVolume）
src/components/FilterPanel.vue（新增）
src/components/WatchlistPanel.vue（修改，顯示成交量）
src/App.vue（修改，接上篩選）
```

---

## 後續狀態更新

- ~~請使用者實際看一次篩選面板的畫面，確認排版跟操作符合預期~~ → 使用者已實際操作並回報問題；拖曳式篩選、價格帶、清除功能、著色區間與價格帶上限均已於階段 24～25 修正。
- 剩餘的技術待辦與部署觀察項目以階段 25「目前仍未完成或需持續驗證的功能」為準。

---

## 階段 24：拖曳式篩選與當沖操作價格帶（已完成）

**目標**：把原本的數字輸入篩選改為較適合看盤操作的拖曳式介面，並納入指定的價格帶、成交量與漲跌幅門檻。

**完成事項**：
1. `FilterPanel.vue` 改為雙把手股價範圍滑桿，提供價格帶與「500 以上」的一鍵按鈕；成交量改成 100／500／1,000／5,000／10,000 張，漲跌幅改成 1／3／5／7／10% 的離散拖曳門檻。股價軌道只有選取區間著色。
2. 千元以上股票改為固定排除條件；即使清除使用者自行設定的條件，也不會重新出現在當沖參考榜內。
3. 修正「清除篩選」：不再替換父層傳入的 reactive 物件，而是重設既有欄位，確保畫面與計算結果同步恢復。
4. `filterWatchlist.js` 集中管理價格帶與獲利跳檔數；依普通股票的報價檔距換算「獲利參考 +X 元（N 檔）」。正常的 0.5 元跳動價格會被連續歸入相鄰價格帶，不會產生未分類區間。

**驗證方式**：
- `npm run test`：145 個案例全數通過。
- `npm run build`：Vue 與 Tailwind 正常完成 production build（使用 Node 20）。

---

## 階段 25：進度文件盤點與現況校正（本階段）

**目標**：逐項核對早期階段留下的待辦、目前程式碼、部署驗證紀錄與使用者已實測的畫面，避免歷史紀錄被誤認為仍未完成的功能。

**確認已完成／已驗證**：
1. Vue Dashboard、Netlify Blobs 儲存與讀取、盤後排程、歷史成交量累積與 `backfill-history` 均已實作；其中 Blobs 回填實際寫入已在階段 22 確認。
2. 原本規劃的「隔日沖分點因子」已停止，改以三大法人買賣超作為第四因子；README 首頁與資料來源已同步改為現行實作，避免誤導。
3. 成交量／股價／漲跌幅前端篩選、千元股排除、拖曳式篩選、價格帶、500 元以上選項與獲利跳檔提示皆已完成。階段 23 的「只有數字輸入框」待辦已標記為完成。
4. 篩選的「清除」功能、價格帶最高上限與滑桿僅顯示選定區間，已依使用者實際操作回饋修正。

**目前仍未完成或需持續驗證的功能**：
1. **TPEx 欄位實測驗證**：正規化已採防禦性對應，但尚缺一次部署環境的真實上櫃回應驗證。
2. **上櫃三大法人資料**：目前未串接，因此上櫃股票的法人因子為中性值；需另尋並驗證合法穩定的公開來源後才能補齊。
3. **真實 TAIEX 指數**：目前仍以全市場成交值加權平均漲跌幅作近似值，尚未接入正式加權指數資料。
4. ~~**國定假日交易日曆**：現行只排除週末；這是刻意簡化，不會產生錯誤日期，但連假時回填候選範圍可能拉長。~~ → **已於階段 26 完成**，見下方記錄。
5. **瀏覽器／元件層級測試**：核心篩選邏輯已有測試，Vue 元件仍以 production build 與人工操作驗證為主；尚未建立自動化瀏覽器測試。
6. **部署後持續觀察**：仍應依 `DEPLOY_CHECKLIST.md` 觀察 TPEx 回應、排程穩定度與資料來源狀態，尤其在連假與資料來源格式變動後。

**驗證方式**：`npm run test` 共 **145** 個案例通過；`npm run build` 成功。

---

## 階段 26：補上 `isExchangeHoliday` 的測試與文件（本階段）

**背景**：Repo 改為以 `https://github.com/haubar/tw-daytrade` 為準，之後的分析與修改都直接對照這個版本。checkout 後發現最新兩個 commit（`add isExchangeHoliday`、`add exchange holidays 2026`）已經把「國定假日交易日曆」這個階段 25 列為未完成的項目做掉了，但這兩個 commit 沒有補測試，也沒有同步更新 PROGRESS.md／README.md 的「已知限制」說明，導致文件落後於程式碼、且新功能沒有測試覆蓋。這個階段補上這兩個缺口。

**確認的程式碼現況**（`netlify/functions/lib/trading-day.mjs`）：
- 新增 `EXCHANGE_HOLIDAYS_BY_YEAR`：以年度為 key 的休市日清單，目前只有 2026 年的資料（元旦、春節、兒童節/清明、勞動節、端午、中秋、國慶、光復節、行憲紀念日等）
- 新增 `isExchangeHoliday(date)`：判斷某天是否為清單裡的休市日，清單裡沒有的年度安全回傳 `false`（不會拋例外，也不會誤判）
- `getPastTradingDayCandidates` 已經接上這個判斷（`!isWeekend(cursor) && !isExchangeHoliday(cursor)`），候選交易日會同時跳過週末跟已知國定假日

**完成事項**：
1. `_test-trading-day.mjs` 補上 7 個測試案例：
   - `isExchangeHoliday` 本身：元旦、春節期間、兒童節（都應為 `true`）、普通交易日與元旦隔天（應為 `false`）、清單裡沒有資料的年度（2027，應安全回傳 `false` 不拋例外）
   - `getPastTradingDayCandidates` 整合測試：用 2026 年元旦連假前後的日期驗證，確認候選清單會同時跳過週末（01-03/01-04）跟元旦（01-01），一次驗證兩種跳過邏輯疊加後的正確性
2. `README.md`「關於非交易日」段落更新，把「沒有排除國定假日」的舊敘述改成「已排除已知的 2026 年台股休市日，清單需要每年手動維護更新」
3. `PROGRESS.md` 階段 25 的「未完成清單」第 4 項標記為已完成，指向本階段

**驗證方式**：`npm run test`，**152 個測試案例，全數通過**（原本 145 個 + 這次新增 7 個）；`npm run build` 成功

**已知限制（沒有動手修，如實記錄）**：
- 假日清單目前只有 **2026 年**的資料，如果系統跨年度使用到 2027 年，`isExchangeHoliday` 會對 2027 年的所有日期回傳 `false`（安全但不精確），代表 2027 年的候選交易日清單會誤把當年度的國定假日當成交易日去嘗試抓取——這不會產生錯誤結果（抓到假日會是空資料或抓到別天的資料，最終還是用「回傳資料本身的日期」驗證過濾掉），但會讓 `backfill-history`／`fetchVolumeHistory` 多浪費幾次無效請求。**每年年初需要手動更新 `EXCHANGE_HOLIDAYS_BY_YEAR` 清單**，目前沒有自動化或提醒機制
- 假日清單是手動抄錄，沒有對照官方公告來源做過交叉驗證的紀錄（這次的補強只確認「程式邏輯正確使用了這份清單」，沒有重新查證清單本身十個日期是否跟 TWSE 官方公告完全一致）

**產出檔案（修改，尚未 commit，待你確認）**：
```
netlify/functions/_test-trading-day.mjs（新增 7 個測試案例）
README.md（更新國定假日相關說明）
PROGRESS.md（本階段記錄 + 階段25清單更新）
```

---

## 階段 27：接上真實 TAIEX 指數（本階段）

**背景**：階段 25 列出的三個待辦事項（TPEx 欄位驗證、上櫃法人因子、真實 TAIEX 指數）先分析難易度跟修改範圍，決定優先做真實 TAIEX 指數——查證後發現比預期簡單很多，而且風險最低（沿用已知可連線的網域），先做完再處理其他兩項。

**查證過程**：
- 搜尋＋實測確認 `openapi.twse.com.tw/v1/exchangeReport/MI_INDEX` 這個端點會回傳「全部指數」的清單（發行量加權股價指數、臺灣50指數、各類股指數等上百筆），其中「發行量加權股價指數」就是 TAIEX，且「漲跌百分比」欄位已經是算好、帶正負號的數字字串，不用像個股資料那樣額外處理顏色/正負號分開的問題
- 這個端點跟目前已經在用的 `STOCK_DAY_ALL`（抓今日全市場行情）同一個網域（`openapi.twse.com.tw`），已知穩定可連線，不會像 TPEx 那樣有防爬蟲風險

**完成事項（拆成 A~F 六個小步驟，逐步驗證，避免一次改太多）**：
1. **步驟 A**：新增 `lib/taiex.mjs`（`fetchTaiexChangePercent`／`parseTaiexChangePercent`），7 個測試案例（正值/負值解析、找不到 TAIEX 這筆、格式錯誤、空輸入等邊界情況）
2. **步驟 B**：`screen.mjs` 的 `screenWatchlists` 新增可選的 `marketChangePercent` 覆蓋參數，有提供就直接用，沒提供才退回 `computeMarketChangeProxy` 估計值（向後相容，不影響既有呼叫端）；補測試驗證覆蓋值真的有被拿去算 `relativeStrength` 因子，不是傳假的沒作用
3. **步驟 C**：`scan.mjs` 把 TAIEX 抓取加進原本的平行請求批次（從 4 個變 5 個），抓取失敗或解析不出資料都優雅退回估計值；新增 `dataSourceStatus.taiex` 狀態欄位、頂層新增 `marketChangePercentIsEstimate` 布林值供前端判斷要不要顯示「估計」字樣
4. **步驟 D**：`StatusBar.vue` 新增 `marketChangePercentIsEstimate` prop，標籤動態顯示「大盤漲跌幅」或「大盤漲跌幅（估計）」，`App.vue` 傳入時對舊資料（沒有這個欄位）做 `?? true` 防禦，避免舊的 Blobs 快取資料造成顯示錯誤（同樣的教訓來自之前「非數值 張」那次事件）
5. **步驟 E**：全套測試／建置驗證
6. `USER_GUIDE.md` 四處提到「近似」的說明同步更新（開場已知限制、狀態列表格、因子3公式、FAQ），改成說明「預設用真實 TAIEX，抓取失敗才會退回估計值並在畫面上明確標示」

**測試過程中的一個技術細節**：整合測試的假 `fetch` 原本用「網域」判斷要回傳哪份假資料，但 `STOCK_DAY_ALL`（今日行情）跟 `MI_INDEX`（TAIEX 指數）現在是**同一個網域、不同路徑**，如果只判斷網域會讓兩個請求拿到同一份假資料、測不出真正的邏輯，改成判斷完整路徑後才正確分流。

**驗證方式**：`npm run test`，**164 個測試案例，全數通過**（152 + `_test-taiex.mjs` 新增 7 個 + `_test-screen.mjs` 新增 2 個 + `_test-integration-scan.mjs` 新增 3 個）；`npm run build` 成功

**測試過程中發現並修正的一個疏漏**：寫完 `_test-taiex.mjs` 之後忘記把 `test:taiex` 加進 `package.json` 的 `test` 整合指令，導致跑 `npm run test` 時這 7 個測試其實沒有被執行到（單獨執行 `node netlify/functions/_test-taiex.mjs` 是有跑、也是過的，但沒有被整合進 CI 等級的一鍵測試指令裡）。發現後已經補上，重新驗證過確實有納入。這也是為什麼要養成「每次新增測試檔都要跑一次完整 `npm run test` 確認總數對得起來」的習慣，不能只看單一測試檔自己執行的結果。

**已知未完成 / 待驗證**：
- 這次沒辦法在這個環境驗證「部署到 Netlify 後，真實請求 `MI_INDEX` 端點會不會遇到跟 `STOCK_DAY_ALL` 早期版本一樣的快取/date 參數問題」——不過這個端點**不需要帶 `date` 參數**（固定回傳最新一筆），風險比當初 `STOCK_DAY_ALL` 那次低很多，但仍待實際部署驗證
- 前端「大盤漲跌幅（估計）」這個動態標籤還沒有人親自看過畫面確認排版正常

**狀態更新**：本階段已於後續 commit（`717a85b`），目前在本機領先 origin/main，尚未 push。

**產出檔案（已 commit）**：
```
netlify/functions/lib/taiex.mjs（新增）
netlify/functions/lib/screen.mjs（修改，新增 marketChangePercent 覆蓋參數）
netlify/functions/scan.mjs（修改，接上 TAIEX 抓取）
netlify/functions/_test-taiex.mjs（新增）
netlify/functions/_test-screen.mjs（修改，新增覆蓋參數測試）
netlify/functions/_test-integration-scan.mjs（修改，mock 改依完整路徑分流+新增TAIEX斷言）
package.json（修改，補上遺漏的 test:taiex 指令）
src/sampleData.js（修改，補上 taiex 狀態與 marketChangePercentIsEstimate 欄位）
src/components/StatusBar.vue（修改，動態標籤）
src/App.vue（修改，傳入新 prop）
USER_GUIDE.md（修改，四處「近似」說明更新）
```

---

## 階段 28：上櫃法人因子（FinMind 整合）——步驟 1A + 1B（進行中，尚未 commit）

**背景**：階段 25 待辦清單裡的 #2（上櫃法人因子）之前評估過兩條路都走不通——`bsr.twse.com.tw` 分點查詢有驗證碼保護、券商看盤網站 `fubon-ebrokerdj.fbs.com.tw` 疑似需要 JS 動態渲染且非官方開放資料。使用者提供 [FinMind](https://finmindtrade.com/) 這個開源金融資料平台，查證後確認是正式 REST API（不是灰色地帶爬蟲），且有 `TaiwanStockInstitutionalInvestorsBuySell`（個股三大法人買賣）跟 `TaiwanStockTradingDailyReport`（個股分點資料）兩個資料集，可能同時解決上櫃法人因子跟重啟隔日沖分點因子兩個問題。

**任務拆分**：因範圍變大（兩個資料集 × 多個步驟），拆成 Part 1（法人資料，風險較低）跟 Part 2（分點資料，待 Part 1 驗證過再評估）。Part 1 內部再拆 1A~1F，逐步做逐步驗證。

**架構關鍵決策**：FinMind 的法人資料一次只能查一支股票（不像 T86 可以一次撈全市場），不可能對全部約 800 檔上櫃股票都查一次（會超過免費額度、也可能被擋）。採用兩階段流程：
1. 第一輪只用 T86（上市法人資料）跑一次 `screenWatchlists`，上櫃股票的法人因子暫時是中性值
2. 從第一輪結果裡抽出「進了觀察榜的上櫃股票代碼」（`getTpexCandidateCodes`）
3. 只對這些候選代碼查詢 FinMind（數量通常在一輪 topN 範圍內，不會太多）
4. 合併 T86 map + FinMind map（兩者股票代碼不重疊，直接 union）
5. 第二輪用合併後的完整法人資料重新跑 `screenWatchlists`，這次的結果才是最終輸出

這個決策刻意不去動 `screenWatchlists` 本身（保持純函式、單輪計算的設計，這是目前測試覆蓋最完整、也最穩定的核心邏輯），兩階段的呼叫順序放在 `scan.mjs`（下一步 1C）處理。

**完成事項**：

*步驟 1A*：
- 新增 `lib/finmind.mjs`：
  - `parseFinMindInstitutionalRows`：把 FinMind 回傳的 `{date, stock_id, buy, name, sell}` 陣列，依股票代碼加總外資+投信+自營商三筆買賣超，得到單一淨買超數字，格式跟 `institutional.mjs` 的輸出（`Map<code, netBuyShares>`）一致，方便合併
  - `fetchFinMindInstitutionalNetBuy(stockIds, dateStr)`：對指定股票清單平行發送請求（每檔股票各一次，FinMind 的 `data_id` 限制），token 從環境變數 `process.env.FINMIND_TOKEN` 讀取（不寫死在程式碼裡）；特別處理 FinMind 用 HTTP 200 + body 裡的 `status` 欄位表達業務邏輯錯誤（例如額度用完）的習慣，跟一般 REST API 不同
  - **老實記錄**：這個模組是照 FinMind 官方文件描述的格式撰寫，這次没能在這個環境用真實請求驗證過（FinMind 官網要 JS 渲染、且抓取工具這次 session 出現快取問題，拿不到可信的即時回應），部署後第一次執行務必檢查 `dataSourceStatus`，格式不對的話比照過去 `institutional.mjs`／`history.mjs` 的經驗回來修正
  - 測試 `_test-finmind.mjs`：10 個案例，涵蓋多筆法人類別加總、多檔股票分別處理、缺欄位/格式錯誤等邊界情況、平行請求中部分失敗不拖累其他檔的處理

*步驟 1B*：
- `screen.mjs` 新增 `getTpexCandidateCodes(firstPassResult)`：純函式，從第一輪 `screenWatchlists` 結果的多空觀察榜裡抽出上櫃股票代碼，供第二輪查詢 FinMind 用。`screenWatchlists` 本身沒有任何改動
- 測試補上 6 個案例（混合上市/上櫃資料、topN 範圍外的股票不該被抽出、空輸入的邊界情況）

**驗證方式**：`_test-finmind.mjs` 10 個案例全過、`_test-screen.mjs` 補測後 18 個案例全過（皆為新檔案/新函式，不影響任何既有測試）

**已知未完成 / 待驗證**：
- `finmind.mjs` 的請求/回應格式完全沒有真實驗證過，是這次風險最高的一塊技術債，部署後第一次執行是真正的試金石
- 上櫃候選代碼的數量還沒有一個明確上限保護——如果 topN 設太大、剛好又有很多上櫃股進榜，平行發送的請求數可能會偏多，需要在 1C 決定要不要加一個上限（例如最多查 20 檔）
- 使用者要自行去 Netlify 後台設定 `FINMIND_TOKEN` 環境變數，程式碼這邊已經設計成用 `process.env` 讀取、沒有 token 也不會壞掉（只是查詢額度較低，300次/hr）
- 步驟 1C（`scan.mjs` 接上兩階段流程）、1D（前端狀態顯示）、1E（文件）、1F（commit）尚未開始
- Part 2（`TaiwanStockTradingDailyReport` 分點資料）完全尚未評估，等 Part 1 部署驗證過再說

**狀態更新**：步驟 1C／1D／1E 已於後續完成（見下方新增記錄），本階段原始記錄僅反映 1A/1B 完成時的狀態。

**產出檔案（1A/1B，已 commit）**：
```
netlify/functions/lib/finmind.mjs（新增）
netlify/functions/_test-finmind.mjs（新增，後移至 tests/ 子資料夾，見下方階段29）
netlify/functions/lib/screen.mjs（修改，新增 getTpexCandidateCodes）
netlify/functions/_test-screen.mjs（修改，新增 6 個測試案例，後移至 tests/ 子資料夾）
```

---

## 階段 29：完成 FinMind 整合 Part 1（1C~1E）+ 部署失敗排查與修復 + 死程式碼清理（本階段）

### 第一部分：完成兩階段流程整合（1C~1E）

**1C（`scan.mjs` 接上兩階段流程）**：
- 第一輪只用 T86（上市）資料跑 `screenWatchlists`
- `getTpexCandidateCodes(firstPassResult)` 抽出進了觀察榜的上櫃股票代碼，上限 `MAX_FINMIND_CANDIDATES = 20`（避免候選數量意外暴增拖慢 scan 或超過 FinMind 免費額度）
- 對候選代碼查詢 FinMind，失敗時優雅降級（維持中性值，不影響其他部分）
- 合併 T86 map + FinMind map（股票代碼不重疊，直接 union），第二輪重新跑 `screenWatchlists` 產生最終結果
- 新增 `dataSourceStatus.finmindTpexInstitutional` 狀態欄位

**1D（前端顯示）**：`App.vue` footer 顯示 `finmindTpexInstitutional` 狀態，含防禦性預設值（避免舊快取資料缺欄位時顯示 undefined，同樣的教訓來自更早的「非數值 張」事件）

**1E（文件）**：README 補充資料來源清單（FinMind、TAIEX）、新增「上櫃法人因子的兩階段設計」完整說明段落（含 `FINMIND_TOKEN` 環境變數設定方式）、USER_GUIDE 補充上市/上櫃法人資料來源不同的白話說明、已知限制段落更新、測試指令清單補齊

**測試覆蓋率的誠實記錄**：這個環境沒有真實 Blobs，導致第一輪觀察榜永遠是空的，`getTpexCandidateCodes` 永遠回傳空陣列——`scan.mjs` 裡真正呼叫 FinMind 的那段程式碼，測試只覆蓋到「沒有候選、跳過查詢」這條分支，完整的兩輪合併邏輯只能等部署後驗證。

**驗證方式（此時）**：`npm run test` 181 個案例全數通過；`npm run build` 成功

### 第二部分：使用者回報 Netlify 部署失敗，排查與修復

使用者部署後回報建置失敗，錯誤訊息：
```
netlify/functions/_test-edge-tpex-mismatch.mjs:26:21: ERROR: Top-level await is currently not supported with the "cjs" output format
netlify/functions/scan.mjs:22:40: ERROR: Could not resolve "./lib/taiex.mjs"
```

**根本原因排查**：這是我方一個明顯的檢查盲點——先前所有階段只驗證過 `npm run build`（Vite 前端打包）跟 `npm run test`（Node 直接執行），**從未驗證過 Netlify 實際打包 Functions 的行為**。Netlify 的規則是：`netlify/functions/` 資料夾**頂層**的每一個檔案都會被當成一個獨立 Function 去打包（子資料夾如 `lib/` 不會，只作為被 import 的模組）。而全部 `_test-*.mjs` 測試腳本一直都放在 `netlify/functions/` 這一層，被 Netlify 誤判成要打包的 Function，其中一支剛好用了 top-level await 觸發打包失敗——但這其實是所有測試檔案共同的問題，不是單一檔案的個案。

`Could not resolve "./lib/taiex.mjs"` 這個錯誤在我方沙盒環境重新檢查時**沒有重現**（`taiex.mjs` 確實存在且已進入 commit `717a85b`，也確認先前提供的下載包內容完整包含此檔案）；推測是使用者套用先前打包檔案到本機 repo 的過程中，該檔案未被正確放置或提交，屬於操作面的落差，而非我方交付內容缺漏——但這點沒有進一步證據可以百分之百確認，如實記錄。

**修復內容**：
1. 建立 `netlify/functions/tests/` 子資料夾，把全部 `_test-*.mjs`（19 個）搬進去
2. 修正搬移後所有檔案內的相對路徑 import（`./lib/` → `../lib/`、`./scan.mjs` → `../scan.mjs` 等），`_test-schema-consistency.mjs` 用 `path.join(__dirname, ...)` 算路徑的部分也對應多加一層 `..`
3. 更新 `package.json` 全部測試指令路徑
4. **發現並刪除一個孤兒測試檔案 `_test-market-index.mjs`**：測試的是 `fetchMarketIndex`（在 `lib/factors.mjs`）跟 `dataSourceStatus.marketIndex` 等完全不同的欄位命名，跟現有的 `taiex.mjs`／`fetchTaiexChangePercent`／`dataSourceStatus.taiex` 實作不是同一套，研判是先前某次「reset project」留下的殘骸（另一次獨立的 TAIEX 實作嘗試被蓋掉，但這個測試檔案沒被清乾淨）。這個檔案從未被列進 `npm run test`（不影響先前回報的測試通過數字），但它物理上存在於 `netlify/functions/` 頂層，本身就足以讓 Netlify 打包失敗，因此必須清除，而不是修復它去配合一套已經不存在的架構
5. **新增驗證步驟**：用專案本身已有的 `esbuild`（Netlify 底層也是用它打包 Functions）直接對 4 個真正的頂層 Function（`scan.mjs`／`backfill-history.mjs`／`latest.mjs`／`fetch-daily-quotes.mjs`）做打包測試，確認不再出現任何錯誤——這是這次事件後補上的、真正對症下藥的驗證方式，之後每次异动都應該執行，不能只靠 `npm run test` 跟 `vite build`

**驗證方式**：`npm run test` 181 個全過；esbuild 打包 4 個 Function 全部成功；`npm run build` 成功

### 第三部分：使用者要求檢查未使用的檔案/測試並清除

系統性排查方式：對 `lib/` 底下每個模組、`src/` 底下每個檔案，逐一搜尋是否被任何生產程式碼（非自身測試）引用。過程中一度誤判 `factors.mjs` 也是死程式碼（因為初版 grep 沒考慮到 `screen.mjs` 從同層用 `./factors.mjs` 引用、不带 `lib/` 前綴的寫法），修正檢查方式後排除誤判。

**確認的死程式碼**（階段 21 從 `STOCK_DAY_ALL`／CSV 格式換成 `MI_INDEX`／JSON 格式端點後留下，先前記錄是「保留供未來重用」，此次應使用者要求清除）：
- `lib/csv.mjs`（`parseCsv`）：只有自己的測試在用
- `normalize.mjs` 的 `normalizeTwseCsvRow`／`extractDateFromCsvRow`：只有自己的測試在用（`toNumber`／`normalizeTwseRow`／`normalizeTpexRow`／`isTradableRow` 都確認仍在使用，予以保留）

**完成事項**：
1. 刪除 `lib/csv.mjs`、`tests/_test-csv.mjs`、`tests/_test-normalize-csv.mjs`
2. `normalize.mjs` 移除兩個死函式，保留仍在使用的部分
3. `package.json` 移除 `test:csv`／`test:normalize-csv` 指令與其在整合指令裡的呼叫
4. README 專案結構樹移除 `csv.mjs` 條目、補上先前也漏掉的 `taiex.mjs`／`finmind.mjs`／測試路徑改為 `tests/` 子資料夾的說明，測試指令清單同步

**確認沒有其他孤兒檔案**：`src/` 底下每個 `.vue`／`.js` 檔案都至少被引用一次；4 個頂層 Function 都是各自獨立部署的端點，沒有被 import 是正常現象（非孤兒）。

**驗證方式**：`npm run test` **172 個測試案例，全數通過**（181 − 9，減少數正好對應被刪除的 `test:csv` 4 案例 + `test:normalize-csv` 5 案例）；esbuild 打包 4 個 Function 全部成功；`npm run build` 成功

**已知未完成 / 待驗證**：
- 這次的 Netlify 打包修復完全沒辦法在這個環境用「真正的 `netlify deploy`」驗證，esbuild 直接打包是目前能做到最接近的模擬，但不是 100% 保證跟 Netlify 官方建置環境行為一致，仍需使用者重新部署確認
- `Could not resolve "./lib/taiex.mjs"` 這個錯誤的真正成因（使用者套用檔案的過程 vs 其他未知原因）沒有確鑿證據，只能推測
- Part 1 的核心風險依舊：`finmind.mjs` 的請求/回應格式仍未經過真實請求驗證
- Part 2（分點資料）尚未評估

**產出檔案（本階段全部異動，尚未 commit）**：
```
netlify/functions/tests/（新增資料夾，含全部19個測試檔案從頂層移入，1個孤兒檔案已刪除故實際18個）
netlify/functions/scan.mjs（1C：接上兩階段流程）
netlify/functions/lib/normalize.mjs（移除死函式）
package.json（測試路徑更新、移除csv相關指令）
src/App.vue（1D：footer顯示finmind狀態）
src/sampleData.js（補上finmindTpexInstitutional欄位）
README.md（1E文件更新 + 死程式碼清理後的結構樹修正）
USER_GUIDE.md（1E文件更新）
已刪除：netlify/functions/lib/csv.mjs
已刪除：netlify/functions/tests/_test-market-index.mjs（孤兒檔案）
已刪除：netlify/functions/tests/_test-csv.mjs
已刪除：netlify/functions/tests/_test-normalize-csv.mjs
```

---

## 階段 30：修正 Netlify 打包重複檔案殘留 + FinMind 首次真實請求診斷（本階段）

### 第一部分：清理未完全套用的檔案清理

使用者 push 階段 29 的成果後，Netlify build 成功，但重新檢查 origin/main 時發現：階段 29 規劃要刪除的檔案（19 個頂層 `_test-*.mjs`、`lib/csv.mjs`、`tests/_test-csv.mjs`、`tests/_test-normalize-csv.mjs`）並沒有真的被移除，只是新版本（`tests/` 子資料夾版本）被新增上去，變成新舊並存。用 `npm run test` 實測確認新舊並存狀態下測試依然 172 個全過（`package.json` 的整合指令已經正確排除了舊路徑跟已刪除的測試），但物理上的重複檔案仍是技術債，且是使用者明確要求清除的目標。用 `git rm` 正式刪除全部 22 個重複/死程式碼檔案，重新驗證 `npm run test`（172 全過）、esbuild 打包 4 個 Function（全過）、`npm run build`（成功）。

### 第二部分：FinMind 首次真實部署結果與診斷修正

使用者提供部署後的真實回應：`"finmindTpexInstitutional": "ok（查詢 20 檔上櫃候選，成功 0 檔）"`——這是 `finmind.mjs` 第一次真正被驗證，結果發現一個真實的邏輯缺陷：**查詢 20 檔、成功 0 檔，卻也沒有顯示「失敗 X 檔」**。

**根因**：原本的 `fetchFinMindInstitutionalNetBuy` 只區分「請求失敗（HTTP 錯誤或 FinMind 業務邏輯錯誤）」跟「成功且有資料」兩種情況。但如果一筆請求技術上完全成功（HTTP 200、`body.status` 也是 200），只是回傳的 `data` 是空陣列，這種情況既不會被計入 `netBuyByCode`（因為沒有資料可加總），也不會被計入 `failedStockIds`（因為 Promise 確實 fulfilled、沒有拋出例外）——會直接從所有統計數字裡消失，導致「查了 20 檔、成功 0 檔、也沒有失敗」這種無法診斷的矛盾結果。

**完成事項**：
1. `finmind.mjs`：`fetchFinMindInstitutionalNetBuy` 新增 `emptyStockIds`（技術上成功但資料是空陣列的股票代碼）跟 `debugInfo`（每一筆查詢的股票代碼、回傳資料筆數、有沒有錯誤訊息），三種結果（成功／空資料／失敗）現在互斥且加總起來一定等於查詢總數，不會再有東西憑空消失
2. `scan.mjs`：`dataSourceStatus.finmindTpexInstitutional` 的狀態訊息重寫，分別列出成功／空資料／失敗三種數量；當成功數是 0 時，額外附上前 3 筆的 `debugInfo` 內容，不用再等下一輪部署才能看到診斷細節
3. 測試：`_test-finmind.mjs` 新增情境涵蓋「部分請求空資料」跟「全部請求都空資料」（後者正是重現這次真實遇到的狀況），驗證 `emptyStockIds`／`debugInfo` 的正確性，共新增 11 個案例（10 → 21）
4. README 補充首次真實部署結果的說明，並請使用者下次部署後回報新版 `finmindTpexInstitutional` 的完整內容

**驗證方式**：`npm run test` **183 個測試案例，全數通過**；esbuild 打包 4 個 Function 全部成功；`npm run build` 成功

**已知未完成 / 待驗證**：
- **根本原因仍未確定**：`emptyStockIds` 偏高最可能的解釋是免費層／目前 token 對近期日期的資料存取範圍有限制（呼應階段 20 討論過的疑慮），但這只是推測，需要下一次真實請求的 `debugInfo` 內容才能確認。可能的原因包括：token 額度、免費層日期範圍限制、`data_id` 格式不符预期（例如是否需要考慮上櫃股票代碼的特殊格式）、或候選股票剛好在查詢日期真的沒有法人交易（機率低但不能排除）
- Part 2（`TaiwanStockTradingDailyReport` 分點資料）依然完全尚未評估

**產出檔案（本階段全部異動，尚未 commit）**：
```
已刪除（22個，見上方第一部分說明）：
  netlify/functions/_test-*.mjs（19個頂層重複檔案）
  netlify/functions/lib/csv.mjs
  netlify/functions/tests/_test-csv.mjs
  netlify/functions/tests/_test-normalize-csv.mjs
修改：
  netlify/functions/lib/finmind.mjs（新增 emptyStockIds／debugInfo）
  netlify/functions/scan.mjs（狀態訊息重寫）
  netlify/functions/tests/_test-finmind.mjs（新增 11 個測試案例）
  README.md（測試數量、FinMind 診斷說明更新）
```

---

## 階段 31：加入市場別候選股診斷欄位（本階段，尚未確定根因）

**背景**：使用者回報「查詢 20 檔上櫃候選」的問題修好後（階段 30），下一次真實請求卻變成完全不同的結果：`finmindTpexInstitutional` 顯示「本次第一輪觀察榜沒有上櫃股票，不需要查詢」——代表這次連候選都沒有，跟上次「有候選但查詢失敗」是不同的狀況。

**排查過程**：
- 同一次回應的 `dataSourceStatus.tpex` 顯示 `"ok (4644 檔)"`——這個數字明顯高於真實台股上櫃股票數（約 800 檔），但因為沒有拋出「欄位對應失敗」的例外，代表目前猜測的 `TPEX_FIELD_CANDIDATES` 至少都有找到對應的欄位，不是整組欄位名稱猜錯；4644 這個數字本身則無法在這個環境進一步驗證是否合理（可能是端點涵蓋了 ETF/債券等更多商品類型，也可能是欄位對應仍有問題），列為待查
- `dataSourceStatus.historyArchive` 顯示 `"ok（累積 3/3 天，天數足夠）"`——代表 Blobs 累積庫已經有 3 天資料，理論上不該完全沒有上櫃候選，但原本的 `totalCandidates` 只回報「上市+上櫃混合的總數」，看不出這 3 天累積的歷史資料裡實際上有沒有涵蓋到上櫃股票

**完成事項**：
- `screen.mjs` 的 `screenWatchlists` 新增 `twseCandidatesWithHistory`／`tpexCandidatesWithHistory`：依市場別統計「有歷史資料、可以參與排名」的候選股數量，不受 `topN` 篩選影響（這是候選池本身的統計，不是最終觀察榜的筆數）。這樣才能分清楚「上櫃候選是 0」到底是「歷史資料根本沒涵蓋到上櫃股票」還是「歷史資料有涵蓋、但這次剛好沒有一檔排進前 100 名」，兩種情況需要完全不同的因應方式
- `scan.mjs` 把這兩個欄位加進回應頂層
- 測試：`_test-screen.mjs` 新增 3 個案例（用既有的混合市場測試資料驗證 1 檔上市 + 3 檔上櫃候選都被正確統計、且加總等於 `totalCandidates`），`sampleData.js` 同步補上範例欄位

**驗證方式**：`npm run test` **186 個測試案例，全數通過**；esbuild 打包 4 個 Function 全部成功；`npm run build` 成功

**已知未完成 / 待驗證**：
- **根本原因仍未確定**，這次只是補上更精確的診斷工具，還沒有真正解決問題。等使用者下次部署後回報 `twseCandidatesWithHistory`／`tpexCandidatesWithHistory` 的實際數字，才能判斷：
  - 如果 `tpexCandidatesWithHistory` 是 0 → 歷史資料根本沒有涵蓋到上櫃股票（可能是 `backfill-history.mjs` 只補上市資料、上櫃完全依賴 `scan.mjs` 自然累積，但過去幾次成功寫入 Blobs 的時機剛好 TPEx 抓取都失敗；或其他導致上櫃股票沒有連續 3 天資料的原因）
  - 如果 `tpexCandidatesWithHistory` 大於 0 但沒有任何一檔進第一輪觀察榜前 100 名 → 純粹是排名運氣問題，不是 bug，但機率上不太合理（4644 檔候選裡完全沒有一檔排進混合前 100 名），需要進一步檢視因子計算是否有系統性偏差
- `dataSourceStatus.tpex` 顯示的 4644 檔是否合理，尚未查證（可能連帶影響 #1 TPEx 欄位驗證的既有疑慮）
- Part 2（分點資料）依然完全尚未評估

**產出檔案（本階段全部異動，尚未 commit）**：
```
netlify/functions/lib/screen.mjs（新增市場別候選股統計）
netlify/functions/scan.mjs（回應新增兩個欄位）
netlify/functions/tests/_test-screen.mjs（新增 3 個測試案例）
src/sampleData.js（補上範例欄位）
README.md（測試數量更新）
```

---

## 階段 32：發現並修正權證污染候選池的問題（本階段）

**背景**：使用者直接指出階段 31 留下的疑問的答案——「好像抓到權證了」，並提供兩筆真實範例：`709205 鈊象永豐63購01`、`旺矽元大5A售03`。這解釋了階段 30/31 一直沒查清楚的「TPEx 4644 檔」異常數字，以及可能連帶解釋 FinMind 上櫃候選一直是 0 的問題（如果權證大量混入候選池、且權證的價格波動行為跟真股票完全不同邏輯，可能排擠掉真正股票的排名機會）。

**判斷依據**：真實股票代碼是 4 位數字（例如 `2330`、`5347`），ETF 是 4~5 位數字（例如 `0050`、`00878`），權證固定是 6 位數字（例如 `709205`）；名稱上權證也有清楚的命名慣例（券商簡稱＋編號＋「購」或「售」＋序號）。兩個條件都用上，代碼判斷為主、名稱判斷為輔助防護。

**完成事項**：
1. `normalize.mjs` 新增 `isWarrant(normalizedRow)`：純函式，依代碼位數（6位數字）跟名稱關鍵字（「購」／「售」+2位數序號）判斷是否為權證
2. `scan.mjs` 的 `fetchTodayTwseQuotes`／`fetchTodayTpexQuotes` 都加上 `.filter(q => !isWarrant(q))`——雖然這次異常數字是在 TPEx 端發現的，但 TWSE 的 `STOCK_DAY_ALL` 理論上也可能混有上市權證，兩邊一併處理，不只挑出問題的那一邊修
3. `fetch-daily-quotes.mjs`（除錯用端點）同步套用，並在回應加上 `warrantCount` 欄位，方便之後快速確認過濾生效、以及知道到底濾掉了多少筆
4. 測試：`_test-fetch-daily-quotes.mjs` 新增 7 個案例，**直接使用使用者提供的兩筆真實範例**驗證，加上真實股票（4位數）、ETF（5位數）不會被誤判、以及缺欄位時的邊界情況

**驗證方式**：`npm run test` **193 個測試案例，全數通過**；esbuild 打包 4 個 Function 全部成功；`npm run build` 成功

**已知未完成 / 待驗證**：
- 過濾後 `dataSourceStatus.tpex` 的實際檔數是否落回合理範圍（預期應該從 4644 降到接近 800），需要下次部署確認
- 過濾權證後，`tpexCandidatesWithHistory`（階段31新增的診斷欄位）是否終於出現非零數字，是接下來最關鍵的驗證點——如果權證污染真的是 FinMind 候選一直是 0 的主因，這次應該能看到改善
- 判斷規則（6位數代碼、「購」／「售」+序號）是依台股慣例寫的，沒有窮舉驗證過所有權證/牛熊證/展延型權證等變體是否都符合這個模式，如果之後發現有漏網之魚，需要再補規則
- Part 2（分點資料）依然完全尚未評估

**產出檔案（本階段全部異動，尚未 commit）**：
```
netlify/functions/lib/normalize.mjs（新增 isWarrant）
netlify/functions/scan.mjs（套用權證過濾）
netlify/functions/fetch-daily-quotes.mjs（套用權證過濾，新增 warrantCount 欄位）
netlify/functions/tests/_test-fetch-daily-quotes.mjs（新增 7 個測試案例）
README.md（已知限制更新）
```

---

## 階段 31：找到 FinMind「全部無有效資料」的真正根因——TPEx 權證未過濾（本階段）

**背景**：使用者部署階段 30 的成果後，回報新的診斷結果：`"finmindTpexInstitutional": "⚠ 全部無有效資料（查詢 20 檔上櫃候選，成功 0 檔，空資料 20 檔）| 診斷樣本: [{"stockId":"738755","rowCount":0,"hasToken":true,"error":null}, ...]"`。階段 30 新增的 `debugInfo` 診斷機制這次真正發揮作用，直接看出關鍵線索：查詢的 `stockId` 是 6 位數字（`738755`、`738137`、`738189`），不是台股正常的股票代碼格式。

**根因**：**這些是權證代碼，不是股票代碼**。台股權證的代碼固定 6 位數字，一般股票是 4 位數字、ETF 是 4~5 位數字。TPEx 官方「每日收盤行情」原始資料裡本來就混雜了權證（實際部署曾觀察到 TPEx 回傳「4644 檔」，遠超過真實上櫃股票約 800 檔的數量級，差額就是混入的權證），而 `getTpexCandidateCodes` 抽取候選名單時沒有先過濾掉這些權證，導致 FinMind 被拿去查詢根本不是股票、也不存在對應法人買賣資料的「代碼」，20 檔全部落空。

**排查過程中的意外發現**：檢查 git 歷史時發現，修正這個問題所需的 `isWarrant` 函式（以及 `scan.mjs`／`fetch-daily-quotes.mjs` 對它的套用）**已經存在於本機工作目錄，但從未被 commit 過**——這是先前某次工作階段做的修正，留在本機沙盒裡但沒有真正交付給使用者，導致部署到 Netlify 的版本一直沒有這個過濾邏輯。這次順勢把它跟其他未提交的變更一併整理、驗證、交付，避免類似的「本機有修正但沒送達」狀況再發生。

**完成事項**：
1. `normalize.mjs` 新增 `isWarrant(normalizedRow)`：依代碼位數（`/^\d{6}$/`，6 位數字）跟名稱特徵（`/(購|售)\d{2}$/`，例如「鈊象永豐63購01」）雙重判斷是否為權證
2. `scan.mjs`：`fetchTodayTwseQuotes`／`fetchTodayTpexQuotes` 都套用 `.filter((q) => !isWarrant(q))`——雖然這次真實發現的異常是在 TPEx，但 TWSE 上市權證理論上也可能混在 `STOCK_DAY_ALL` 回應裡，兩邊一併處理
3. `fetch-daily-quotes.mjs`（既有的除錯端點）同步加上 `warrantCount` 欄位，方便之後確認過濾掉了幾檔
4. `screen.mjs` 新增 `twseCandidatesWithHistory`／`tpexCandidatesWithHistory` 診斷欄位：分別統計上市/上櫃「通過歷史資料檢查、可以參與排名」的候選股數量，方便之後如果再遇到「上櫃候選是 0」，能立刻分辨是「上櫃股票根本沒進候選池」還是「排名不夠高但確實有進候選池」

**驗證方式**：直接用真實觸發問題的代碼（`738755`、`738137`）單獨測試 `isWarrant`，確認正確判定為權證（`true`），正常股票代碼（`5347`）正確判定為非權證（`false`）；`npm run test` **193 個測試案例，全數通過**；esbuild 打包 4 個 Function 全部成功；`npm run build` 成功

**已知未完成 / 待驗證**：
- 這次修正完全沒辦法在這個環境用真實 TPEx 請求驗證「過濾後上櫃候選池會不會正確涵蓋到正常股票」，需要使用者部署後重新觸發 `/scan`，確認 `dataSourceStatus.finmindTpexInstitutional` 這次能不能查到真正有效的法人資料（而不是「空資料」或「查無此代碼」）
- `isWarrant` 的判斷規則（6 位數字＝權證）是依台股慣例寫的經驗法則，不是官方明文規格，如果之後遇到例外情況（例如某些代碼位數規則有特例）需要再調整
- Part 2（`TaiwanStockTradingDailyReport` 分點資料）依然完全尚未評估

**產出檔案（本階段全部異動，先前已在本機但未提交，這次一併整理提交，尚未 commit）**：
```
netlify/functions/lib/normalize.mjs（新增 isWarrant）
netlify/functions/scan.mjs（套用 isWarrant 過濾）
netlify/functions/fetch-daily-quotes.mjs（新增 warrantCount 診斷欄位）
netlify/functions/lib/screen.mjs（新增 twseCandidatesWithHistory／tpexCandidatesWithHistory）
netlify/functions/lib/finmind.mjs（上一輪 emptyStockIds／debugInfo，一併整理提交）
netlify/functions/tests/_test-fetch-daily-quotes.mjs（更新）
netlify/functions/tests/_test-finmind.mjs（上一輪新增案例）
netlify/functions/tests/_test-screen.mjs（更新）
README.md（更新 FinMind 診斷說明）
```
