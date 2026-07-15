# 阿韭衝衝衝判斷器（TW Day-Trade Scanner）

台股全市場盤後篩選工具，用免費公開資料計算「量能異常／跳空幅度／相對大盤強弱勢／隔日沖分點介入」四大因子，產生隔日觀察名單。**僅供參考，不構成投資建議，當沖有資格與風險限制，請自行評估。**

## 技術棧

| 層 | 技術 |
|---|---|
| 前端 Dashboard | Vue 3 + Vite（靜態部署於 Netlify） |
| 資料抓取／運算 | Netlify Functions（Node.js） |
| 自動排程 | Netlify Scheduled Functions（收盤後自動觸發） |
| 資料儲存 | Netlify Blobs |

## 資料來源

- **上市**：TWSE OpenAPI `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`（已用即時資料驗證欄位）
- **上櫃**：TPEx OpenAPI（欄位待部署後驗證，見下方「已知限制」）
- **券商分點**：TWSE 分點查詢系統 `bsr.twse.com.tw`（尚未實作，規劃於後續階段）

## 專案結構

```
tw-daytrade-scanner/
├── netlify.toml                          # Netlify 設定（含排程 cron）
├── package.json
├── README.md
├── PROGRESS.md                            # 開發階段紀錄（每階段目標／完成事項）
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── sampleData.js
│   ├── styles/
│   │   ├── theme.css                   # Token 層：Tailwind @theme 設計 token（色彩/字體/圓角）
│   │   └── base.css                    # Base 層：引入 theme.css + 全域基礎規則
│   ├── utils/
│   │   ├── format.js                    # 共用格式化函式
│   │   └── filterWatchlist.js           # 觀察榜篩選邏輯（純函式，跟 Vue 無關方便測試）
│   └── components/
│       ├── ScoreBar.vue                 # 因子解剖條（簽名元素）
│       ├── WatchlistPanel.vue           # 多方/空方觀察榜面板
│       ├── StatusBar.vue                # 頂部狀態列
│       ├── FilterPanel.vue              # 成交量／股價／漲跌幅篩選面板
│       └── base/
│           ├── Badge.vue                 # 通用徽章（市場標籤等）
│           └── StatItem.vue              # 通用「標籤+數值」統計項目
└── netlify/functions/
    ├── scan.mjs                            # 【主要進入點】完整流程：抓取→讀取歷史累積庫→篩選→存入 Blobs
    ├── backfill-history.mjs               # 一次性手動補歷史資料工具（加速暖機，見下方說明）
    ├── latest.mjs                           # 給前端呼叫：讀取 Blobs 裡最新一筆結果
    ├── fetch-daily-quotes.mjs             # 輔助 function：只抓今日行情（除錯用）
    ├── _test-*.mjs                         # 本地測試腳本（不連網路，用樣本/假資料驗證邏輯）
    └── lib/
        ├── normalize.mjs                   # 資料正規化：把不同來源／格式轉成統一格式
        ├── csv.mjs                         # 輕量 CSV 解析器（目前沒有模組在用，見下方說明；保留是因為獨立測試過，之後接其他 CSV 格式的資料源可以直接重用）
        ├── trading-day.mjs                  # 共用交易日邏輯：判斷週末、產生候選交易日清單
        ├── history.mjs                     # 現場抓取多天歷史資料（僅 backfill-history.mjs 使用）
        ├── volume-archive.mjs               # 歷史成交量的 Blobs 累積儲存層（scan.mjs 實際使用的歷史資料來源）
        ├── factors.mjs                     # 因子計算：量能異常／跳空／相對強弱／法人買賣超／綜合評分／因子貢獻度
        ├── institutional.mjs                # 抓取三大法人買賣超日報
        ├── screen.mjs                      # 整合流程：串接以上模組，產生多方/空方觀察榜
        └── storage.mjs                      # Netlify Blobs 儲存層：存/讀最新結果與歷史備份
```

## 關於歷史資料：為什麼改成「每天累積」而不是「現場抓好幾天」

部署到 Netlify 後實測發現，`scan.mjs` 因為有排程設定，屬於 Netlify 的 **Scheduled Function**，這類 function **不管用什麼方式呼叫，執行時間上限固定 30 秒，跟付費方案無關**。現場抓多天歷史資料（要對 TWSE 同一個端點發出好幾筆全市場資料的請求）是整個流程裡最花時間的部分，很容易撞到這個上限。

現在改成：`scan.mjs` 每次執行時，把「今天」的資料存進 Netlify Blobs 累積庫（`volume-archive.mjs`），下次執行時直接讀 Blobs 裡累積的紀錄當歷史資料，不用再現場跟 TWSE 要好幾天份資料。

**代價**：剛部署（或 Blobs 累積庫是空的）的前幾天，累積天數不夠 3 天，量能異常因子會先是中性值，其他三個因子仍正常運作。可以執行以下步驟加速暖機：

1. 部署完成後，打開一次 `https://你的站台.netlify.app/.netlify/functions/backfill-history`
2. 這支 function 會自動跳過週六日，找最近的交易日補進 Blobs 累積庫，並且**只補「還沒存過」的新日期**——重複打開幾次也不會補到重複的天，而是自動往更早的交易日繼續補
3. 因為它一樣要現場抓多天資料，一樣有機會逼近執行時間上限——如果逾時了不用緊張，讓 `scan.mjs` 每天自然執行個 2-3 次就會自己累積齊全，這支只是「加速」用，不是必需品

`history.mjs`（現場抓多天資料的舊邏輯）保留下來只給 `backfill-history.mjs` 使用，`scan.mjs` 本身已經不會呼叫它。

**關於非交易日（週六日）與盤後時間**：
- `scan.mjs` 如果在週末被手動觸發，TWSE 端點還是會回傳「最近一個交易日」的資料，但**不會**把這筆資料標記成「今天（週末）」寫進歷史累積庫——避免產生一筆假的非交易日資料，汙染量能異常因子的計算基礎
- `scan.mjs` 如果在**台灣時間下午 2 點前**被觸發，同樣不會寫入歷史累積庫——台股 13:30 收盤，太早查詢可能拿到還沒最終確認的盤後資料。排程本身設定在台灣時間 14:10 觸發，本來就會過這個檢查，這個限制主要是防呆使用者提早手動觸發測試的情況
- `backfill-history.mjs` 產生候選日期時就會跳過週六日，只找平日
- 以上判斷邏輯都來自同一個共用模組 `lib/trading-day.mjs`，避免各處各自寫一份容易長出不一致的行為
- 目前只排除週六日，**沒有**排除國定假日（例如過年、清明連假），這是刻意的簡化——完整的台股交易日曆需要額外維護一份假日清單，遇到連假頂多是候選範圍要多找幾輪，不會產生錯誤結果（因為最終還是會用「回傳資料本身的日期」驗證）

**如果 backfill-history 抓不到之前交易日的資料**：這支 function 的回應會附上 `debugInfo` 欄位，列出每個候選日期「送出去的參數」跟「實際拿回來的日期」，方便判斷問題出在哪：
- 如果每筆 `actualDate` 都一樣 → 曾經實測發生過：原本用的 `www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?date=...` 端點不管 `date` 參數送哪一天，回傳的都是同一天資料，研判是 CDN 快取沒有把 `date` 算進快取鍵值。**已經改用 `MI_INDEX` 端點解決**（見下方說明），如果又遇到這個症狀，可能是 `MI_INDEX` 端點本身也開始出現同樣的問題，需要再進一步排查
- 如果大部分 `error` 顯示 `The operation was aborted due to timeout` → TWSE 對同一來源的併發請求數有限制，已經改成分批發送（每批 3 個，`BATCH_SIZE`）解決
- 如果 `actualDate` 都是 `null` → 回傳的資料格式可能跟預期不一樣，`MI_INDEX` 的回應結構解析不出東西（見 `parseMiIndexResponse` 的容錯設計）

遇到還是抓不到資料的狀況，把 `debugInfo` 的內容貼給開發者診斷。

**歷史資料端點的最終選擇（`history.mjs`，只給 `backfill-history.mjs` 使用）**：
```
https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=ALLBUT0999NOTIND&response=json
```
這是走過彎路才確定下來的：一開始用 `STOCK_DAY_ALL` 端點，`date` 參數實測完全無效（不管送哪天都回傳同一天資料）；改用 `MI_INDEX` 端點後，`date` 參數確認有效（回傳資料的標題會標明實際對應的日期，跟送出去的參數吻合）。這個端點回應結構跟 `STOCK_DAY_ALL` 不一樣：不是單純的 CSV，是 JSON 包多個表格（`tables` 陣列），要找 `fields` 裡有「證券代號」的那個表格才是真正的資料；「漲跌」的正負號也是獨立欄位（用顏色 HTML 表示紅漲綠跌），跟漲跌幅度數字是分開的兩個欄位，需要合併判讀。

**scan.mjs 抓「今天」資料用的是完全不同的端點**（`https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`，見上方「資料來源」章節），這個 openapi 子網域的端點只回傳最新資料，沒有 `date` 參數，不受這次的問題影響，不用跟著改。

## 關於「隔日沖分點因子」的重要說明

原本規劃第四個因子是「隔日沖券商分點買賣超」，但實測發現 TWSE 的分點查詢系統（`bsr.twse.com.tw`）**有圖形驗證碼保護**，無法在 Netlify Function 裡自動化查詢（自動繞過驗證碼本身也不是應該做的事）。

因此改用**三大法人買賣超日報**（外資＋投信＋自營商）取代：免費、有官方端點、可完全自動化、而且是全市場一次撈取（不需要「先篩選再逐檔查詢」的兩階段設計）。這不是真正的分點級資料，但是同樣屬於「有大額資金介入訊號」的免費籌碼面資料。目前只涵蓋**上市（TWSE）**股票，上櫃（TPEx）的法人買賣超是不同資料源，尚未串接——上櫃股票的這個因子會預設為中性（0）。

## 前端 Dashboard

深色看盤終端機風格，貼近台灣交易者熟悉的看盤軟體語彙：密集資訊、等寬數字對齊、**紅漲綠跌**（符合台股慣例，跟美股相反，務必留意）。

簽名視覺元素是「因子解剖條」：每檔股票旁邊一條分段長條，用金／紅或綠／靛三色分別代表量能異常、跳空幅度、相對大盤強弱勢對總分的貢獻比例，讓「這檔股票為什麼上榜」一眼可見，而不是只丟一個總分數字。

字體：`Noto Serif TC`（標題，襯線中文，帶莊重感）+ `Noto Sans TC`（內文）+ `IBM Plex Mono`（所有數字，確保欄位對齊）。

**架構分層**：
- **CSS**：用 [Tailwind CSS v4](https://tailwindcss.com)（`@tailwindcss/vite` plugin，CSS-first 設定，不需要 `tailwind.config.js`）。分兩層：
  - `src/styles/theme.css`：只放設計 token，用 Tailwind 的 `@theme` 語法定義，這樣色彩／字體 token 會自動產生對應的工具類別（例如 `--color-surge` 自動可以用 `text-surge`／`bg-surge`），元件不用各自重寫顏色/字體的 CSS
  - `src/styles/base.css`：引入 `theme.css`，放全域基礎規則（body 預設樣式、focus 樣式）
  - 元件版面用 Tailwind 工具類別直接寫在 template 裡，真的沒有對應工具類別可以表達的（例如因子解剖條的動態寬度）才用 `:style` 或極少量 scoped CSS
- **元件複用**：`src/components/base/` 放會被多處引用的通用元件（`Badge.vue` 徽章、`StatItem.vue` 標籤+數值），`src/utils/format.js` 放共用的格式化函式（原本 `formatPercent`／`formatPrice`／`formatDateTime` 在兩個元件裡各寫一份，抽出來共用一份）

**如何在本機看畫面：**
```bash
npm install
npm run dev
```
打開瀏覽器到 `http://localhost:5173`。因為還沒接上真實的 Netlify Functions（除非你另外開一個視窗跑 `netlify dev`），畫面會自動改用 `src/sampleData.js` 的範例資料，並在頂部顯示「範例資料」的提示條，不會誤導你以為是真實行情。

**驗證方式**：前端這層沒辦法像後端邏輯一樣寫單元測試（是視覺呈現，不是計算邏輯），改用 `npm run build` 確認整個 Vue + Tailwind 專案能正確編譯，並檢查編譯後的 CSS 確實包含 `@theme` 產生的工具類別（例如 `.text-surge`），確認 token 系統真的有生效，以及本機啟動 dev server 確認每個元件模組都能被正確載入，不會有匯入錯誤或編譯期錯誤。實際畫面好不好看，還是需要你自己打開瀏覽器看一眼——我這邊的環境沒有瀏覽器可以截圖給你確認。

## 篩選功能（成交量／股價／漲跌幅）

Dashboard 上方有可拖曳的篩選面板：
- 最低／最高股價使用雙把手滑桿，也可以一鍵選擇操作價格帶（含 500 元以上）；只有已選股價區間會以金色標示，千元以上股票固定排除
- 最小成交量以台股慣用的「張」設定為 100、500、1,000、5,000、10,000 張以上
- 最小漲跌幅度設定為 1%、3%、5%、7%、10%（取絕對值，多方看漲幅、空方看跌幅）
- 價格帶會顯示對應的「獲利參考 N 檔」：代表該價位需上跳 N 個正常股票報價檔，榜單也會換算約需上漲的元數；這是操作提示，不會改變後端排名或分數

「清除篩選」會重設使用者調整的股價／成交量／漲跌幅條件；**千元以上固定排除**仍然保留。500～999 元可使用「500 以上」篩選；因未指定該區間的獲利跳檔數，系統不會自行推測。

**設計決定：這是純前端的顯示篩選，不會重新觸發後端計算**。理由：
1. 分數的「相對強弱」「百分位排名」都是用全市場候選池算出來的，如果篩選會改變候選池，同一檔股票的分數會因為你調整篩選條件而飄移，容易搞混
2. 前端篩選可以即時調整，不用等 `scan` 重新跑一次（那是 10-30 秒等級的操作）

因為篩選是在前端做的，後端 `screen.mjs` 的候選池從原本的 Top 30 拉大到 **Top 100**（多方/空方各 100 檔），不然篩一篩可能剩沒幾檔可看。每檔股票的資料現在也包含原始成交量（`volume` 欄位，股數），供篩選使用。

篩選邏輯是純函式（`src/utils/filterWatchlist.js`），跟 Vue 元件分開，可以直接用 `node` 測試，不用架瀏覽器測試環境。

## 如何在本機測試邏輯

```bash
npm install
npm run test                # 跑全部測試（138 個案例，見 TEST_REPORT.md）
npm run test:fetch          # 資料正規化（JSON 格式）
npm run test:csv            # CSV 解析器
npm run test:normalize-csv  # 資料正規化（CSV 格式）
npm run test:history        # 歷史資料抓取邏輯（含日期去重）
npm run test:factors        # 因子計算公式
npm run test:screen         # 完整篩選流程整合測試
npm run test:institutional  # 三大法人買賣超資料解析
npm run test:storage        # Netlify Blobs 儲存層（用假的 store 物件測試）
npm run test:volume-archive # 歷史成交量的 Blobs 累積儲存層
npm run test:trading-day    # 交易日／週末判斷邏輯
npm run test:backfill-pick  # backfill-history 挑選新交易日的核心邏輯
npm run test:integration    # 端對端整合測試（完整模擬 scan.mjs 真實執行流程）
npm run test:integration-backfill # backfill-history.mjs 的整合測試
npm run test:schema         # 前後端資料結構一致性檢查
npm run test:edge-cases     # 邊界案例（全部資料源失敗、TPEx 欄位對不上等）
npm run test:filter-watchlist # 前端篩選邏輯（成交量／股價／漲跌幅）
```

這些測試都只用寫死的樣本／假資料驗證邏輯對不對，不會真的連線抓資料，所以可以放心常常跑。

## 如何部署到 Netlify

1. 把整個資料夾 push 到你的 GitHub repo
2. Netlify 新建站台，連接該 repo，Build command / Publish directory 會自動讀 `netlify.toml`
3. 部署完成後：
   - 瀏覽器打開 `https://你的站台.netlify.app/.netlify/functions/scan` 手動觸發一次完整流程（抓取→計算→存入 Blobs），會看到當次算出來的候選名單 JSON
   - 之後打開 `https://你的站台.netlify.app/.netlify/functions/latest` 可以快速讀到「最新一次」存起來的結果，不會重新抓資料，回應更快，前端 Dashboard 會呼叫這支
   - 也可以打開 `/.netlify/functions/fetch-daily-quotes` 只看今日行情抓取結果，方便除錯

## 已知限制

- **TPEx（上櫃）欄位尚未實際驗證**：因為開發環境的網路白名單擋掉了 TPEx 網域，`normalize.mjs` 裡的 `TPEX_FIELD_CANDIDATES` 是根據常見命名猜測的候選欄位。部署到 Netlify 第一次執行若欄位對不上，錯誤訊息會清楚列出實際欄位名稱，屆時依照錯誤訊息更新候選欄位即可。
- **隔日沖分點名單會過時**：目前規劃中的分點清單來自市場公開討論整理，並非官方分類，且每年會變動，正式導入時會做成可調整的設定檔（尚未實作）。
- **免費 API 無官方使用授權**：抓取頻率過高可能被限流，設計上以「盤後跑一次」為主，避免高頻呼叫。

## 新手教學

第一次使用這個工具？看 [USER_GUIDE.md](./USER_GUIDE.md)，會解說畫面怎麼看、四個因子分別在算什麼、分數怎麼加總出來的、資料多新鮮。

## 開發進度

詳細的分階段開發紀錄見 [PROGRESS.md](./PROGRESS.md)。

## QA 測試報告

以測試工程師角度做的完整功能與流程驗證，見 [TEST_REPORT.md](./TEST_REPORT.md)。

## 部署檢查清單

準備部署到 Netlify 時，照 [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) 一步一步驗證，每一步都有「怎麼判斷成功/失敗」跟卡住了要回報什麼資訊。
