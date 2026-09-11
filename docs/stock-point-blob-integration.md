# stock-point 跨專案 Blob 整合

## 用途

自選股詳細資料會在本專案既有的行情、模型與勝率資料之外，選擇性讀取 `stock-point` 最近 7 天的技術分析結果。

整合是選擇性的：如果環境變數未設定，網站仍會顯示本專案原有的自選股詳細資料，不會因外部資料不可用而中斷。

## Netlify 環境變數

請設定在 `tw-daytrade` 的 Netlify site，而不是只設定在 `stock-point`：

```text
STOCK_POINT_SITE_ID=<stock-point 的 Project ID>
STOCK_POINT_BLOBS_TOKEN=<Netlify Personal Access Token>
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
- `result.aiScore`：POINT 分數

## 資料處理原則

1. 只由 Netlify Function 以 `siteID` 與 token 讀取，瀏覽器不直接接觸 token。
2. 每個日期只保留一筆相同股票的技術分析結果。
3. 外部資料缺少、讀取失敗或欄位不存在時，顯示空值，不自行推算。
4. `stock-point` 技術分析與本專案勝率是不同資料來源，介面上分開標示，避免誤認為同一個模型。
