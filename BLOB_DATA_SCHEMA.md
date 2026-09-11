# Netlify Blobs 資料結構說明

> 文件狀態：隨功能開發持續更新
>
> 更新日期：2026-09-11

本文件記錄本專案使用的 Netlify Blobs store、key、資料欄位與保存策略。所有日期字串使用 ISO 8601；前端顯示時再依使用者環境轉換。

## 1. Store 總覽

| Store | 用途 | 目前 key 形式 | 保存策略 |
| --- | --- | --- | --- |
| `scan-results` | 最新掃描結果與依日期的掃描備份 | `latest`、`by-date/YYYY-MM-DD` | 由現有掃描流程管理 |
| `backtest-results` | 歷史回測結果與索引 | `latest`、`by-signal-date/YYYY-MM-DD`、`index` | 由現有回測流程管理 |
| `volume-history` | 每日行情、成交量與相對強弱歷史 | 由 `volume-archive.mjs` 定義 | 依現有窗口清理 |
| `trading-calendar-cache` | 交易日曆快取 | 由 `trading-calendar-cache.mjs` 定義 | 依年份快取 |
| `shared-watchlist` | 所有使用者共用的自選股清單與操作紀錄 | `current` | 目前保留清單及最近 500 筆操作紀錄 |

後續新增法人歷史資料時，應在此表補上 store、key 規則與保存期限；不可只在程式碼中默默增加未記錄的 Blob store。

## 2. `shared-watchlist/current`

### 根物件

```js
{
  schemaVersion: 1,
  updatedAt: "2026-09-11T00:00:00.000Z",
  items: [],
  audit: []
}
```

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `schemaVersion` | number | 是 | 自選股資料結構版本，目前為 `1` |
| `updatedAt` | string / null | 是 | 最近一次成功寫入時間 |
| `items` | array | 是 | 目前共用自選股，依 `code` 去重並排序 |
| `audit` | array | 是 | 最近的加入／移除操作紀錄，最多 500 筆 |

### `items[]`

```js
{
  code: "2330",
  name: "台積電",
  market: "TWSE",
  addedAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  addCount: 1
}
```

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `code` | string | 4 至 6 碼股票代碼，唯一鍵 |
| `name` | string | 股票名稱；尚未解析時暫以代碼代替 |
| `market` | `TWSE` / `TPEx` | 市場，預設為 `TWSE` |
| `addedAt` | string / null | 第一次加入時間 |
| `updatedAt` | string / null | 最近一次加入或資料更新時間 |
| `addCount` | number | 被加入操作觸發的次數 |

### `audit[]`

加入紀錄：

```js
{
  action: "add",
  code: "2330",
  at: "2026-09-11T00:00:00.000Z"
}
```

移除紀錄：

```js
{
  action: "remove",
  code: "2330",
  name: "台積電",
  market: "TWSE",
  at: "2026-09-11T00:00:00.000Z"
}
```

目前沒有帳號，因此 audit 不記錄操作者身份。audit 的用途是保留變更歷史與提供日後復原依據，不是權限或稽核系統。

## 3. 共享自選股讀寫規則

- 所有使用者讀取同一份 `shared-watchlist/current`。
- 股票代碼是唯一鍵，重複加入不會產生重複項目，只增加 `addCount`。
- 所有人都可以加入與移除。
- 移除由前端先顯示會影響所有使用者的確認提示。
- API 寫入前會重新讀取目前清單並合併變更。
- Netlify Blobs 沒有在本資料層另外建立使用者鎖，因此極短時間內的並發寫入仍可能需要日後加入版本衝突偵測。
- 不把私人備註、私人標籤或私人排序寫入這份共用資料。

## 4. API 對應

| API | 方法 | Blob 操作 |
| --- | --- | --- |
| `/.netlify/functions/shared-watchlist` | `GET` | 讀取 `shared-watchlist/current` |
| 同上 | `POST` | 加入或更新 `items[]`，新增 `audit[]` 的 `add` |
| 同上 | `DELETE` | 移除 `items[]`，新增 `audit[]` 的 `remove` |

## 5. 後續法人歷史資料預留

法人歷史資料尚未實作。實作時必須在寫入程式與本文件同一個變更中補上：

- store 名稱
- 每日 snapshot key
- 日期索引 key
- 資料版本
- 欄位完整性規則
- 保存天數與清理策略
- 部分來源失敗時的表示方式
- 與個股／板塊 API 的讀取關係

