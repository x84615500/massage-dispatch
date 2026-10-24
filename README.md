# 按摩師即時調度工具

v0.1.9，繁體中文、手機優先的單機測試版。

網站入口為根目錄 index.html，GitHub Pages 可從 main 分支的根目錄發布。資料保存在各裝置與網站來源的 localStorage，尚無登入與跨裝置同步。

## 測試

安裝 Node.js、Chrome 後執行：

```sh
npm install --no-save playwright
node test.cjs
```

34 項自動化測試已在桌面 Chrome 通過；iPhone Safari 與 VoiceOver 仍待實機驗收。到店分配、提前開始、Supabase 登入同步與伺服器防重複安排尚未實作。

完整功能盤點與限制請參閱交接與測試報告.md。





