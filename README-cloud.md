# 雲端預約與 LINE 使用說明

保留原有介面。未登入時使用原 localStorage；登入後改用共用 Supabase 資料。原本機紀錄不會自動搬移或覆寫。

## 第一次使用

1. 在「雲端預約管理」輸入管理者信箱，寄送登入連結，再用同一瀏覽器開啟信件連結完成登入。
2. 原有紀錄先用「資料備份」匯出 JSON。登入後使用「匯入先前匯出的JSON備份」預覽，再確認合併。同ID保留雲端資料。
3. 按「產生LINE綁定碼」，在 LINE 私訊機器人貼上顯示的指令。綁定碼10分鐘有效、一次性。
4. 另一端變更後按「重新讀取雲端」。編輯中的預約須先完成或取消。

## LINE 指令

- 預約功能
- 新增預約 明天 15:00 身體60分鐘 2人 指定1,2 備註王先生
- 查預約 今天／明天／2026-11-03／王先生
- 查看預約 B-編號
- 修改預約 B-編號 明天 16:00
- 修改預約 B-編號 第1位 身體90分鐘
- 取消預約 B-編號
- 恢復預約 B-編號
- 確認預約 六位確認碼
- 放棄預約
- 預約紀錄

此版使用明確格式，時間請用15:00等數字；缺資料會補問，不由模型直接寫入。新增／修改／取消／恢復先列出內容，回覆確認碼才寫入。班表未確認的新增為「待確認」，不是已訂妥。

## 資料與權限

API 與 LINE 後端放在 line-ai-bot 的 Vercel 專案；GitHub Pages 只提供網頁及 cloud/browser.js。

cloud/schema.sql 建立狀態、版本、去重、操作紀錄、LINE身分與短期確認資料表。原 JSON 保留在 PostgreSQL JSONB，適用目前單一管理者。資料表開啟RLS，anon/authenticated 無讀寫權限；後端才持有服務密鑰。API 每次向 Supabase Auth 驗證已確認信箱並比對 BOOKING_OWNER_EMAIL。

版本CAS與請求ID去重防止兩端覆蓋及重複確認；衝突時需重新讀取，不靜默覆寫。

環境變數：SUPABASE_URL、SUPABASE_SECRET_KEY（或 SUPABASE_SERVICE_ROLE_KEY）、SUPABASE_PUBLISHABLE_KEY（或 SUPABASE_ANON_KEY）、BOOKING_OWNER_EMAIL、BOOKING_ALLOWED_ORIGINS。秘密金鑰不可放在公開檔案或 GitHub Pages。

## 備份與清理

雲端可匯出JSON、預覽合併匯入。取消保留紀錄。永久清理需指定今日以前日期、預覽筆數、再確認；待確認預約及仍使用的班表保留。清理後空間可回收重用，但容量數字不一定立即下降。操作紀錄保留180天、去重紀錄7天（寫入時整理）。

## 驗證與限制

56組原介面回歸、14組核心／PostgreSQL／權限／LINE確認測試、3組雲端同步測試通過。執行 package.json 內的 test:core、test:cloud、test:ui；UI需Playwright與Chrome。

沒有即時推播同步或自動永久刪除。首次信箱登入、LINE身分綁定、真實收發與NVDA／VoiceOver實機操作仍需管理者驗收。身體與腳底服務規則、10分鐘整理、班表及容量規則保留。

