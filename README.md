# 按摩師即時調度工具

v0.2.0，繁體中文、手機優先；保留本機模式並新增管理者雲端與 LINE 預約。

新版操作與權限請先讀 [雲端預約說明](README-cloud.md)。以下是原單機版說明，登入雲端後以新版規則為準。

網站入口為根目錄 index.html，GitHub Pages 可從 main 分支的根目錄發布。資料保存在各裝置與網站來源的 localStorage，尚無登入與跨裝置同步。

## 測試

安裝 Node.js、Chrome 後執行：

```sh
npm install --no-save playwright
node test.cjs
```

56 項自動化測試已在桌面 Chrome 通過；iPhone Safari 與 VoiceOver 仍待實機驗收。到店分配、提前開始、Supabase 登入同步與伺服器防重複安排尚未實作。

完整功能盤點與限制請參閱交接與測試報告.md。












