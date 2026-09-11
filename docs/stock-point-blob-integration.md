# stock-point 跨專案 Blob 整合

## 用途

自選股詳細資料會在本專案既有的行情、模型與勝率資料之外，選擇性讀取 `stock-point` 最近 7 天的技術分析結果。

整合是選擇性的：如果環境變數未設定，網站仍會顯示本專案原有的自選股詳細資料，不會因外部資料不可用而中斷。

## Netlify 環境變數

請設定在 `tw-daytrade` 的 Netlify site，而不是只設定在 `stock-point`：

```text
STOCK_POINT_SITE_ID=<stock-point 的 Project ID>
STOCK_POINT_BLOBS_TOKEN=<Netlify Personal Access Token>
STOCK_POINT_ANALYZE_URL=https://<stock-point 網址>/api/analyze-stock
STOCK_POINT_ANALYZE_SECRET=<與 stock-point 相同的 server-to-server secret>
```

設定後必須重新部署，Function 才會取得新的環境變數。Token 只能設定在 Netlify server environment variables，不可放在前端或提交到 Git。

## Blob 資料結構

`stock-point` 使用：

- Store：`scan-results`
- Key：`YYYY-MM-DD_market_topN`
- JSON 欄位：`savedAt`、`results`、`stats`

單一 `results` 項目的技術分析資料位於 `feat`，目前讀取：

- `feat.cur`：收盤價
- `feat.histVol`：歷史波動率
- `feat.bbWidth`：布林帶寬
- `feat.pToMa60`：相對 MA60 乖離
- `feat.roc10`：10 日 ROC
- `results[].aiScore`：POINT 分數

## 自選股觸發分析

若股票不在 `stock-point` 最近掃描結果，`tw-daytrade` 會呼叫 `STOCK_POINT_ANALYZE_URL` 觸發單股分析。`stock-point` 需要另外設定：

```text
FINMIND_TOKEN=<FinMind token>
STOCK_POINT_ANALYZE_SECRET=<與 tw-daytrade 相同的 secret>
```

單股觸發分析會保存到 `watchlist-analysis` store，key 為 `YYYY-MM-DD_code`。單股分析可計算技術指標，但沒有完整掃描池時不會虛構 POINT 相對排名分數，因此 `score` 可能是 `null`。

## 完整掃描排程

`stock-point` 會在台灣時間週一至週五 15:30 由 Netlify Scheduled Function 執行完整掃描，並把結果寫入同一個 `scan-results` store：

- 排程：`30 7 * * 1-5`（UTC）
- 掃描股票池：目前頁面設定的 TWSE／TPEx 熱門股票池，去除重複代號
- 休市判斷：呼叫 TWSE 官方 `holidaySchedule`，週末或官方休市日不執行
- 無法取得官方休市日：為避免把上一交易日資料誤存成今日，該次直接跳過
- 使用 `FINMIND_TOKEN` 在 server-side 取得行情，瀏覽器手動掃描仍可保留

自選股的 POINT 相對分數會使用最近一次完整掃描產生的 `stats.scoreReference`；因此首次自動掃描完成前，單股技術分析的 `score` 仍可能是 `null`。

部署後可在 Netlify 的 Functions 頁面確認 `scheduled-scan` 顯示 Scheduled 標記。第一次自動掃描會依排程在下一個符合條件的交易日執行；不需要手動呼叫排程網址。

## 資料處理原則

1. 只由 Netlify Function 以 `siteID` 與 token 讀取，瀏覽器不直接接觸 token。
2. 每個日期只保留一筆相同股票的技術分析結果。
3. 外部資料缺少、讀取失敗或欄位不存在時，顯示空值，不自行推算。
4. `stock-point` 技術分析與本專案勝率是不同資料來源，介面上分開標示，避免誤認為同一個模型。
