# 前端架構說明（v2）

本專案採用適合 Vue 的「分層 MVC + 功能導向」架構，不硬套傳統後端 MVC。

## 目錄職責

```text
src/
├── App.vue                 # 應用程式入口，只負責掛載頁面
├── views/                  # 頁面級元件與頁面狀態
├── components/             # 可重用 UI 元件
│   └── base/               # 跨功能共用的基礎元件
├── services/               # API、外部資料與錯誤處理
├── data/                   # 純資料檔，使用 JSON
├── utils/                  # 與 Vue 無關的純函式
└── styles/                 # 全域樣式與 design tokens
```

## MVC 對應

| MVC 概念 | 本專案對應 | 責任 |
| --- | --- | --- |
| View | `views/`、`components/` | 畫面、互動與顯示狀態 |
| Controller | `views/` 的事件處理、`services/` | 組合畫面流程、呼叫 API、處理載入／錯誤 |
| Model | `data/`、API 回應、`utils/` 的資料轉換函式 | 資料結構、格式化與計算 |

Vue 的 `script setup` 會讓 View 與 Controller 有少量共存，這是刻意的；跨畫面或外部資料存取應抽到 `services/`，純計算應抽到 `utils/`，避免頁面元件變成大型單檔案。

## 開發規則

1. 新增頁面放在 `src/views/`。
2. 可重用顯示元件放在 `src/components/`；只被單一頁面使用的元件仍可先放 components，但需避免把 API 邏輯散落在元件中。
3. 所有 Netlify Function 呼叫優先集中到 `src/services/api.js`。
4. 純資料使用 JSON，放在 `src/data/`，不可在元件內手寫大型資料物件。
5. 不把測試放在 `src/`；單元測試放 `test/unit/`，Function 測試放 `test/functions/`，視覺測試放 `test/visual/`。
6. 文件放在 `docs/`；歷史文件若內容已過時，應新增或更新文件，不要把過時說明混進程式碼註解。
7. 每次大型結構變更先建立版本備份，再分階段 commit。

## v2 重構版本策略

- `v1.0.0`：目錄重構前的功能完成版。
- `v2.0.0`：本次目錄、前端分層、測試與資料格式重構完成後建立。
- v2 過程中的每個結構變更都使用獨立 commit，方便逐步回退。

根目錄的 [README.md](../README.md) 保留給 GitHub 顯示；其餘規格、部署、資料結構與測試報告集中在本目錄。
