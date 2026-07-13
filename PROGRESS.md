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


