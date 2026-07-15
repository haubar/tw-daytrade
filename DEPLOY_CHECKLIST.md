# 部署檢查清單（DEPLOY_CHECKLIST.md）

跟著這份清單一步一步做，每一步都有「怎麼判斷成功/失敗」跟「失敗了怎麼辦」。照順序做，因為後面的步驟依賴前面的步驟。

---

## 0. 前置需求

- [ ] 有 GitHub 帳號，且這個專案的程式碼已經 push 到一個 repo
- [ ] 有 Netlify 帳號（免費方案就夠）

如果專案還沒放到 GitHub：

```bash
cd tw-daytrade-scanner
git init
git add .
git commit -m "Phase 1 + Phase 2 完整後端與前端"
# 到 GitHub 建一個新 repo，然後：
git remote add origin <你的 repo URL>
git branch -M main
git push -u origin main
```

---

## 1. 建立 Netlify 站台

1. [ ] 登入 Netlify → **Add new site → Import an existing project**
2. [ ] 選擇你剛剛 push 的 GitHub repo
3. [ ] Build 設定應該會自動從 `netlify.toml` 讀到（`npm run build` / `dist` / `netlify/functions`），確認畫面上顯示的設定跟這個一致，不用手動改
4. [ ] 按下部署，等待建置完成（第一次通常 1-2 分鐘）

**判斷成功**：Netlify 給你一個 `https://隨機字串.netlify.app` 的網址，打開後看得到 Dashboard 畫面（此時應該還是顯示「範例資料」的黃色提示條，因為排程還沒跑過）。

---

## 2. 驗證資料抓取：TWSE

打開瀏覽器到：
```
https://你的站台.netlify.app/.netlify/functions/fetch-daily-quotes
```

- [ ] 確認回應 JSON 裡 `twse.count` 是一個大於 1000 的數字，`twse.errorCount` 是 0 或很小的數字
- [ ] 確認 `twse.sample` 裡有看到正常的股票資料（代號、開高低收都不是 0）

**如果失敗**：把回應的 JSON 貼給我，我幫你看是端點掛了還是欄位對不上。

---

## 3. 驗證資料抓取：TPEx（**這裡很可能會需要修正**）

同一份回應裡看 `tpex` 那欄：

- [ ] 如果 `tpex.count` 是正常數字（跟上市檔數量級相近），**恭喜，欄位猜對了**，可以跳過這步
- [ ] 如果 `tpex.error` 或 `tpex.firstError` 出現訊息，把完整錯誤訊息貼給我——錯誤訊息裡會列出「實際欄位為: [...]」，我會依照這個更新 `netlify/functions/lib/normalize.mjs` 裡的 `TPEX_FIELD_CANDIDATES`

這是目前**最可能需要來回修正**的一步，不用意外。

---

## 4. 手動觸發一次完整掃描

打開：
```
https://你的站台.netlify.app/.netlify/functions/scan
```

**重要更新**：歷史資料現在是讀 Netlify Blobs 累積庫，不再現場跟 TWSE 要好幾天份資料，這一步應該會比之前快很多（幾秒內）。

- [ ] 確認回應是完整的 JSON
- [ ] 檢查 `dataSourceStatus.historyArchive`：
  - 如果是第一次執行（或還沒跑過 `backfill-history`），這裡會顯示「失敗」或「累積 0/3 天」——**這是正常的**，代表歷史累積庫還是空的，`longWatchlist`／`shortWatchlist` 這次會是空陣列，不用緊張
  - 想要立刻有完整資料可以看，回到本清單的**第 3.5 步**先跑一次 `backfill-history`
- [ ] 檢查 `dataSourceStatus.institutional`：
  - 如果顯示 `ok (數字 檔)` 沒有警告符號 ⚠，代表法人資料抓取正常、日期也對得上
  - 如果有 `⚠ 法人買賣超資料日期與預期不符...`，把訊息貼給我
  - 如果顯示 `失敗: ...`，把錯誤訊息貼給我
- [ ] 檢查有沒有 `storageWarning` 欄位出現在回應裡——如果有，代表 Netlify Blobs 寫入失敗，把訊息貼給我

---

## 3.5. （建議）先補一次歷史資料，加速暖機

打開：
```
https://你的站台.netlify.app/.netlify/functions/backfill-history
```

這支 function 會自動跳過週六日，找最近的交易日補進 Blobs 累積庫，而且**只補「還沒存過」的新日期**——重複打開幾次也不會補到重複的天，會自動往更早的交易日繼續補，讓下一次 `scan` 就能有完整的量能異常因子可看，不用乾等 2-3 個交易日自然累積。

- [ ] 確認回應包含 `datesBackfilled`，裡面有幾個新日期（第一次執行通常會是 3 個）
- [ ] 如果想累積更多天數，可以再打開一次，會自動接續往前補（例如再往前補 3 天，累積庫就會有 6 天）
- [ ] 如果這一步逾時或失敗，不用緊張——這只是「加速」用，讓 `scan.mjs` 每天自然執行幾次就會自己累積齊全，跳過這步繼續往下走也沒關係
- [ ] **如果 `datesBackfilled` 是空的、或補到的天數一直卡在同一天不會增加**：把回應裡的 `debugInfo` 欄位完整貼給我。已知一個真實發生過的原因：`error` 顯示 `The operation was aborted due to timeout` 代表 TWSE 對併發請求數有限制，已經改成分批發送（每批 3 個）修正過，如果還是遇到這個錯誤，代表 3 個可能還是太多，需要再往下調

---

## 5. 驗證 Netlify Blobs 真的存到資料

打開：
```
https://你的站台.netlify.app/.netlify/functions/latest
```

- [ ] 確認回應的 `generatedAt` 時間跟你剛剛第 4 步觸發 `scan` 的時間差不多（代表真的讀到剛剛存的那筆，不是舊資料或空的）
- [ ] 如果回應是 404「目前還沒有任何掃描結果」，代表第 4 步的 `scan` 存檔失敗了，回頭看第 4 步的 `storageWarning`

---

## 6. 檢查排程有沒有正確註冊

Netlify 後台 → 你的站台 → **Functions** 分頁：

- [ ] 應該要看到 `scan` 這個 function，旁邊有排程（cron）的標示
- [ ] 如果沒有排程標示，代表 `scan.mjs` 裡的 `export const config = { schedule: ... }` 沒有被 Netlify 正確辨識，把 Functions 分頁的截圖或畫面描述給我

不用在這裡等到排程真的自動觸發（下一個交易日收盤後才會跑），能看到排程標示存在就算這步驟過了。

---

## 7. 親自檢查前端畫面（我這邊做不到的部分）

打開你的站台首頁 `https://你的站台.netlify.app`：

**先提醒**：如果你還沒跑過第 3.5 步的 `backfill-history`，畫面上的觀察榜可能會是空的（因為歷史累積庫還沒暖機），這是正常的，不是前端壞了。跑過 `backfill-history` 再重新整理頁面看看。

- [ ] 資料時間、大盤漲跌幅、候選檔數這些數字看起來合理嗎？
- [ ] 多方觀察榜是不是紅色（漲）、空方觀察榜是不是綠色（跌）？—— **這點特別重要，因為台股紅漲綠跌跟美股相反，如果你覺得顏色「怪怪的」，很可能是我哪裡弄反了，要馬上跟我說**
- [ ] 每一列右邊的「因子解剖條」，四個顏色的分段看得清楚嗎？
- [ ] 篩選面板的股價雙把手、成交量與漲跌幅拖桿能正常拖曳嗎？點選價格帶後，範圍是否正確更新？
- [ ] 套用任一篩選後按「清除篩選」，榜單檔數是否恢復；千元以上股票是否仍維持排除？
- [ ] 價格帶內的股票是否出現「參考略過 N 檔」提示；500～999 元的股票不應被自動套用略過檔數。
- [ ] 手機瀏覽器打開，兩欄有沒有變成單欄堆疊？
- [ ] 整體排版、字體、間距，有沒有哪裡看起來明顯不對勁（跑版、重疊、超出畫面）？

---

## 回報格式建議

不用整份清單都做完才回報，卡在哪一步就把那一步的截圖或錯誤訊息貼給我，我可以針對那個問題直接修，不用等全部做完。
