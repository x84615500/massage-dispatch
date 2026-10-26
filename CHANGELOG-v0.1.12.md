# v0.1.12 更新紀錄（2026-10-26）

- 今日與未來新增班表改用單選班別：早班11:00–22:00、晚班11:30–22:30，無需輸入上下班時間。
- 班表摘要顯示班別及時間；以既有from/to欄位保存，沿用容量、整理時間及匯出功能。舊自訂班表保留原時間並標示「原有班表」，不自動覆寫。
- 數字欄位保留inputmode=numeric，加入enterkeyhint提示；輸入時提供頁面內「上一欄／下一欄／完成輸入」工具列。
- 工具列在同一表單內依順序移動，略過隱藏／停用欄位，服務與班別單選只移到已選的選項，不自動開啟選單或更換選項。
- 完成輸入會結束輸入並把焦點移到表單送出按鈕，不會自動送出。Enter鍵亦採切換欄位／完成輸入。
- 工具列以VisualViewport調整鍵盤上方位置；實際iPhone鍵盤、Safari視窗及VoiceOver的呈現仍待實機確認。
- Apple文件確實描述Safari表單的Next／Previous控制，但網站不能保證每種iOS數字鍵盤都顯示相同原生按鈕。頁面工具列是固定可用的補充操作。
- 43項Chrome自動化測試通過。雲端登入同步、備份匯入、到店轉派工等既有待辦不變。

參考：
https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/DesigningForms/DesigningForms.html
https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-enterkeyhint-attribute
