let playwright;try{playwright=require('playwright')}catch{playwright=require('C:/Users/x8461/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')}const {chromium}=playwright;
const fs=require('fs'),assert=require('assert/strict');
(async()=>{

 const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
 async function test(name,run){const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('http://massage.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fs.readFileSync(__dirname+'/index.html','utf8')}));const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-23T14:00:00']))}static now(){return new NativeDate('2026-10-23T14:00:00').valueOf()}};window.testTimers=[];window.setInterval=fn=>{window.testTimers.push(fn);return 1}});
 try{await run(page);assert.deepEqual(errors,[]);results.push('PASS '+name)}catch(e){results.push('FAIL '+name+': '+e.message);process.exitCode=1}finally{await context.close()}}
 const url='http://massage.test/';
 const goto=p=>p.goto(url);
 const click=async(p,id)=>{await p.locator('#'+id).click();if(id==='new-day'||id==='new-future')await p.locator('#bookTime').fill('1730')};
 const choose=(p,id,value)=>p.locator('#'+id+' input[value='+value+']').check();
 const fill=(p,id,value)=>p.locator('#'+id).fill(id==='bookTime'?value.replace(':',''):value);
 async function add(p,id){await fill(p,'addStaff',id);await p.locator('#addStaffForm button').click()}
 async function confirm(p){await click(p,'confirmToday')}
 async function work(p,id='1',u='2'){await click(p,'show-work');await fill(p,'workStaff',id);await fill(p,'workUnits',u);await p.locator('#workForm [type=submit]').click()}
 async function seed(p,data){await p.addInitScript(d=>localStorage.setItem('massage-dispatch-01',JSON.stringify(d)),data);await goto(p)}
 const roster={confirmed:true,people:[{id:'1',from:'11:00',to:'22:00'}]};
 const booking=(time='17:30',staff='1')=>({id:'b1',date:'2026-10-23',time,guests:[{units:2,staff}],note:'測試',status:'confirmed'});
 await test('連續新增、班表確認、安排工作與重新載入',async p=>{await goto(p);await add(p,'1');await add(p,'2');assert.match(await p.locator('#today-roster').innerText(),/共2位/);assert.equal(await p.locator('#addStaff').evaluate(e=>document.activeElement===e),true);assert.equal(await p.locator('#today-roster-details').isVisible(),true);await confirm(p);await work(p);assert.match(await p.locator('#message').innerText(),/已安排20分鐘/);assert.match(await p.locator('#today-status').innerText(),/14:30/);assert.equal(await p.locator('#show-work').evaluate(e=>document.activeElement===e),true);await p.reload();assert.match(await p.locator('#today-roster').innerText(),/共2位/);assert.match(await p.locator('#today-status').innerText(),/14:30/)});
 await test('已有指定預約仍可安排不衝突工作（重複計算回歸）',async p=>{await seed(p,{rosters:{'2026-10-23':roster},bookings:[booking()],jobs:[]});await work(p);assert.match(await p.locator('#message').innerText(),/已安排20分鐘/)});
 await test('不指定預約容量及10分鐘整理衝突',async p=>{await seed(p,{rosters:{'2026-10-23':roster},bookings:[booking('14:25','')],jobs:[]});await work(p);assert.match(await p.locator('#message').innerText(),/影響已確認/);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('massage-dispatch-01')).jobs.length),0)});
 await test('班表未確認、重複工作與已有工作師傅移除',async p=>{await goto(p);await add(p,'1');await work(p);assert.match(await p.locator('#message').innerText(),/先確認今日班表/);await click(p,'hide-work');await confirm(p);await work(p);await work(p);assert.match(await p.locator('#message').innerText(),/已有安排/);await click(p,'toggle-roster');await p.locator('[data-removestaff]').click();assert.match(await p.locator('#message').innerText(),/已有工作紀錄/)});
 await test('當日日期正確、未來待確認、多人欄位保留與頁面切換',async p=>{await goto(p);await click(p,'tab-booking');await click(p,'tab-future');await fill(p,'futureDate','2026-10-25');await p.locator('#futureDate').dispatchEvent('change');await click(p,'tab-day');await click(p,'new-day');assert.equal(await p.locator('#bookDate').inputValue(),'2026-10-23');await click(p,'cancelEditor');await click(p,'tab-future');await click(p,'new-future');assert.equal(await p.locator('#bookDate').inputValue(),'2026-10-25');await fill(p,'bookCount','2');await p.locator('#bookCount').dispatchEvent('change');await fill(p,'gUnits0','12');await fill(p,'gStaff0','1');await p.evaluate(()=>window.savedGuest=document.querySelector('#gUnits0'));await fill(p,'bookCount','3');await p.locator('#bookCount').dispatchEvent('change');assert.equal(await p.evaluate(()=>window.savedGuest===document.querySelector('#gUnits0')),true);assert.equal(await p.locator('#gUnits0').inputValue(),'12');await p.locator('#bookingForm [type=submit]').click();assert.match(await p.locator('#future-list').innerText(),/待確認/);assert.match(await p.locator('#future-list').innerText(),/3人/);await click(p,'new-future');assert.equal(await p.locator('#gStaff0').inputValue(),'');await click(p,'cancelEditor');await click(p,'tab-today');assert.equal(await p.locator('#today').isVisible(),true)});
 await test('定時更新保留表單與按鈕焦點',async p=>{await goto(p);await add(p,'1');await fill(p,'addStaff','2');await p.evaluate(()=>window.testTimers.forEach(fn=>fn()));assert.equal(await p.locator('#addStaff').inputValue(),'2');assert.equal(await p.locator('#addStaff').evaluate(e=>document.activeElement===e),true);await p.locator('[data-removestaff]').focus();await p.evaluate(()=>window.testTimers.forEach(fn=>fn()));assert.equal(await p.locator('[data-removestaff]').evaluate(e=>document.activeElement===e),true)});
 for(const value of ['{bad','null','{"rosters":[],"bookings":[],"jobs":[]}','{"rosters":{"2026-10-23":{"confirmed":true,"people":[null]}},"bookings":[],"jobs":[]}'])await test('損壞資料不覆寫 '+value.slice(0,35),async p=>{await p.addInitScript(v=>localStorage.setItem('massage-dispatch-01',v),value);await goto(p);assert.equal(await p.locator('#storage-warning').isVisible(),true);await add(p,'1');assert.equal(await p.evaluate(()=>localStorage.getItem('massage-dispatch-01')),value);assert.equal(await p.locator('#storage-warning').isVisible(),true)});
 await test('localStorage 寫入失敗提醒持續可見',async p=>{await p.addInitScript(()=>Storage.prototype.setItem=function(){throw Error('quota')});await goto(p);await add(p,'1');assert.match(await p.locator('#today-roster').innerText(),/共1位/);assert.equal(await p.locator('#storage-warning').isVisible(),true);await confirm(p);assert.equal(await p.locator('#storage-warning').isVisible(),true)});
 await test('其他分頁清除資料不導致例外',async p=>{await goto(p);await p.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'massage-dispatch-01',newValue:null})));assert.equal(await p.locator('#storage-warning').isVisible(),true)});

 await test('未來排班、確認預約、查詢、修改與複製清單',async p=>{
 await goto(p);await click(p,'tab-booking');await click(p,'tab-future');await fill(p,'futureDate','2026-10-25');await p.locator('#futureDate').dispatchEvent('change');
 await fill(p,'futureStaff','8');await p.locator('#futureStaffForm button').click();await click(p,'confirmFuture');
 assert.match(await p.locator('#future-summary').innerText(),/班表已確認/);
 await click(p,'new-future');await fill(p,'gStaff0','8');await fill(p,'bookNote','測試備註');await p.locator('#bookingForm [type=submit]').click();await p.locator('[data-confirm]:visible').click();assert.match(await p.locator('#future-list').innerText(),/已確認/);
 await p.locator('[data-edit]:visible').click();assert.equal(await p.locator('#gStaff0').inputValue(),'8');await click(p,'cancelEditor');
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text},configurable:true}));
 await click(p,'copy-future');const copied=await p.evaluate(()=>window.copied);for(const text of ['2026-10-25','17:30','1人','90分鐘','指定8號','已確認','測試備註'])assert.ok(copied.includes(text),text);
 await fill(p,'futureDate','2026-10-26');await p.locator('#futureDate').dispatchEvent('change');assert.match(await p.locator('#future-list').innerText(),/尚無預約/);
 await fill(p,'futureDate','2026-10-25');await p.locator('#futureDate').dispatchEvent('change');assert.match(await p.locator('#future-list').innerText(),/已確認/);
 });
 await test('指定預約衝突與下班邊界',async p=>{
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[booking('14:25')],jobs:[]});await work(p);assert.match(await p.locator('#message').innerText(),/已有安排/);await fill(p,'workUnits','49');await p.locator('#workForm [type=submit]').click();assert.match(await p.locator('#message').innerText(),/超出/);
 });
 await test('腳底55分鐘派工、整理與重新載入',async p=>{
 await goto(p);await add(p,'1');await confirm(p);await click(p,'show-work');await fill(p,'workStaff','1');await p.locator('#workService').selectOption('foot');assert.equal(await p.locator('#workUnits').isDisabled(),true);await fill(p,'workFoot','55');assert.match(await p.locator('#workPreview').innerText(),/共55分鐘/);await p.locator('#workForm [type=submit]').click();assert.match(await p.locator('#message').innerText(),/14:55/);assert.match(await p.locator('#today-status').innerText(),/15:05/);
 const j=await p.evaluate(()=>JSON.parse(localStorage.getItem('massage-dispatch-01')).jobs[0]);assert.equal(j.bodyMinutes,0);assert.equal(j.footMinutes,55);await p.reload();assert.equal(await p.locator('#storage-warning').isVisible(),false);assert.match(await p.locator('#today-status').innerText(),/15:05/);
 });
 await test('組合工作總時間與一次整理',async p=>{
 await goto(p);await add(p,'1');await confirm(p);await click(p,'show-work');await fill(p,'workStaff','1');await p.locator('#workService').selectOption('both');await fill(p,'workUnits','0');await p.locator('#workForm [type=submit]').click();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('massage-dispatch-01')).jobs.length),0);await fill(p,'workUnits','6');await fill(p,'workFoot','40');assert.match(await p.locator('#workPreview').innerText(),/共100分鐘/);await p.locator('#workForm [type=submit]').click();assert.match(await p.locator('#message').innerText(),/15:40/);assert.match(await p.locator('#today-status').innerText(),/15:50/);
 });
 await test('腳底無效級距拒絕與70分鐘有效',async p=>{
 await goto(p);await add(p,'1');await confirm(p);await click(p,'show-work');await fill(p,'workStaff','1');await p.locator('#workService').selectOption('foot');
 for(const value of ['25','41','60','-40','40.5']){await fill(p,'workFoot',value);await p.locator('#workForm [type=submit]').click();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('massage-dispatch-01')).jobs.length),0)}
 await fill(p,'workFoot','70');await p.locator('#workForm [type=submit]').click();assert.match(await p.locator('#message').innerText(),/已安排70分鐘/);
 });
 await test('三人混合項目、個別時間、修改與簡化複製',async p=>{
 await goto(p);await click(p,'tab-booking');await click(p,'new-day');await choose(p,'bookService','both');await fill(p,'bookUnits','6');await p.locator('#bookUnits').dispatchEvent('change');await fill(p,'bookFoot','55');await p.locator('#bookFoot').dispatchEvent('change');await fill(p,'bookCount','3');await p.locator('#bookCount').dispatchEvent('change');
 assert.equal(await p.locator('#gService2').evaluate(e=>e.value),'both');assert.equal(await p.locator('#gFoot2').inputValue(),'55');await choose(p,'gService0','body');await fill(p,'gStaff0','1');await choose(p,'gService1','foot');await fill(p,'gStaff1','8');await fill(p,'gFoot2','70');await p.locator('#bookingForm [type=submit]').click();
 assert.match(await p.locator('#day-list').innerText(),/身體60分鐘＋腳底70分鐘/);
 await p.locator('[data-edit]:visible').click();assert.equal(await p.locator('#gService0').evaluate(e=>e.value),'body');assert.equal(await p.locator('#gService1').evaluate(e=>e.value),'foot');assert.equal(await p.locator('#gService2').evaluate(e=>e.value),'both');assert.equal(await p.locator('#gFoot2').inputValue(),'70');await click(p,'cancelEditor');
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>window.copied=t},configurable:true}));await click(p,'copy-day');const copied=await p.evaluate(()=>window.copied);assert.ok(!/客[123]/.test(copied));for(const value of ['3人','身體60分鐘，指定1號','腳底55分鐘，指定8號','身體60分鐘＋腳底70分鐘，不指定'])assert.ok(copied.includes(value),value);
 await p.reload();await click(p,'tab-booking');assert.match(await p.locator('#day-list').innerText(),/腳底70分鐘/);
 });
 await test('組合預約容量涵蓋腳底與整理邊界',async p=>{
 const b=booking('14:00','');b.guests=[{bodyMinutes:20,footMinutes:40,staff:''}];
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[b],jobs:[]});await click(p,'tab-booking');await click(p,'new-day');await fill(p,'bookTime','15:05');await fill(p,'bookUnits','2');await p.locator('#bookUnits').dispatchEvent('change');await fill(p,'gStaff0','1');await p.locator('#bookingForm [type=submit]').click();await p.locator('[data-confirm]:visible').click();assert.match(await p.locator('#message').innerText(),/無法確認/);
 await p.locator('[data-edit]:visible').last().click();await fill(p,'bookTime','15:10');await p.locator('#bookingForm [type=submit]').click();await p.locator('[data-confirm]:visible').click();assert.match(await p.locator('#message').innerText(),/預約已確認/);
 });
 await test('舊單位紀錄相容、編輯與儲存',async p=>{
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[booking()],jobs:[{date:'2026-10-23',staff:'1',start:700,units:2}]});assert.equal(await p.locator('#storage-warning').isVisible(),false);await click(p,'tab-booking');assert.match(await p.locator('#day-list').innerText(),/身體20分鐘/);await p.locator('[data-edit]:visible').click();assert.equal(await p.locator('#gService0').evaluate(e=>e.value),'body');assert.equal(await p.locator('#gUnits0').inputValue(),'2');await p.locator('#bookingForm [type=submit]').click();await p.reload();assert.equal(await p.locator('#storage-warning').isVisible(),false);
 });

 await test('班表確認自動收合、再展開與焦點',async p=>{
 await goto(p);await add(p,'1');await add(p,'2');assert.equal(await p.locator('#today-roster-panel').isVisible(),true);await confirm(p);assert.equal(await p.locator('#today-roster-panel').isVisible(),false);assert.equal(await p.locator('#toggle-roster').getAttribute('aria-expanded'),'false');assert.equal(await p.locator('#toggle-roster').evaluate(e=>document.activeElement===e),true);await click(p,'toggle-roster');await add(p,'3');await p.evaluate(()=>window.testTimers.forEach(f=>f()));assert.equal(await p.locator('#today-roster-panel').isVisible(),true);await click(p,'collapse-roster');assert.equal(await p.locator('#today-roster-panel').isVisible(),false);await click(p,'toggle-roster');await confirm(p);await p.reload();assert.equal(await p.locator('#today-roster-panel').isVisible(),false);
 });
 await test('15:10至16:10空檔顯示50分鐘及其他空檔',async p=>{
 const b=booking('16:10','1');await seed(p,{rosters:{'2026-10-23':roster},bookings:[b],jobs:[{date:'2026-10-23',staff:'1',start:840,units:6}]});
 assert.match(await p.locator('#availability-list').innerText(),/15:10起可以預約最多50分鐘/);await p.locator('#availability-list summary').click();assert.match(await p.locator('[data-other]').innerText(),/16:40起仍可預約/);await p.evaluate(()=>window.testTimers.forEach(f=>f()));assert.equal(await p.locator('#availability-list details').getAttribute('open'),'');await p.evaluate(()=>{window.savedCard=document.querySelector('#availability-list article');document.activeElement.blur();window.Date=class extends Date{getHours(){return 15}getMinutes(){return 20}getSeconds(){return 0}};window.testTimers.forEach(f=>f())});assert.match(await p.locator('[data-nearest]').innerText(),/15:20起可以預約最多40分鐘/);assert.equal(await p.evaluate(()=>window.savedCard===document.querySelector('#availability-list article')),true);assert.equal(await p.locator('#availability-list details').getAttribute('open'),'');
 });
 await test('固定時段足夠長度才顯示，40分鐘淨空檔放不下50',async p=>{
 const shortRoster={confirmed:true,people:[{id:'1',from:'15:10',to:'16:00'}]};
 await seed(p,{rosters:{'2026-10-23':shortRoster},bookings:[],jobs:[]});await click(p,'tab-booking');await click(p,'new-day');await fill(p,'gStaff0','1');
 for(const [units,expected] of [['5',null],['4','15:10可開始'],['3','15:10–15:20可開始'],['2','15:10–15:30可開始']]){await fill(p,'gUnits0',units);await p.locator('[data-find-slots]').click();const result=await p.locator('[data-slot-results]').innerText();if(expected)assert.ok(result.includes(expected),result);else assert.match(result,/沒有能完整安排/)}
 await p.locator('[data-use-slot]').click();assert.equal(await p.locator('#bookTime').inputValue(),'1510');assert.equal(await p.locator('#bookTime').evaluate(e=>document.activeElement===e),true);
 await fill(p,'gUnits0','4');assert.match(await p.locator('[data-slot-results]').innerText(),/條件已變更/);assert.equal(await p.locator('[data-use-slot]').count(),0);
 });
 await test('未來空檔、未確認班表提示與編輯排除自身',async p=>{
 const b=booking('15:00','1');b.date='2026-10-25';
 await seed(p,{rosters:{'2026-10-25':roster},bookings:[b],jobs:[]});await click(p,'tab-booking');await click(p,'tab-future');await fill(p,'futureDate','2026-10-25');await p.locator('#futureDate').dispatchEvent('change');await p.locator('[data-edit]:visible').click();await p.locator('[data-find-slots]').click();assert.match(await p.locator('[data-slot-results]').innerText(),/11:00–21:30可開始/);await fill(p,'bookDate','2026-10-26');await p.locator('[data-find-slots]').click();assert.match(await p.locator('[data-slot-results]').innerText(),/班表尚未確認/);
 });
 await test('不指定預約仍佔容量，腳底與組合長度過濾',async p=>{
 const b=booking('14:00','');b.guests=[{bodyMinutes:60,footMinutes:0,staff:''}];
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[b],jobs:[]});assert.match(await p.locator('#availability-list').innerText(),/15:10起仍可預約/);
 await click(p,'tab-booking');await click(p,'new-day');await fill(p,'gStaff0','1');await choose(p,'gService0','foot');await fill(p,'gFoot0','55');await p.locator('[data-find-slots]').click();assert.match(await p.locator('[data-slot-results]').innerText(),/15:10–20:55可開始/);
 await choose(p,'gService0','both');await fill(p,'gUnits0','6');await p.locator('[data-find-slots]').click();assert.match(await p.locator('[data-slot-results]').innerText(),/15:10–19:55可開始/);
 });
 await test('全組多人容量與查看更多',async p=>{
 const r={confirmed:true,people:[{id:'1',from:'11:00',to:'22:00'},{id:'2',from:'11:00',to:'22:00'}]};
 const bookings=['15:00','16:00','17:00','18:00'].map((time,i)=>({...booking(time,'1'),id:'split'+i}));
 await seed(p,{rosters:{'2026-10-25':r},bookings:bookings.map(b=>({...b,date:'2026-10-25'})),jobs:[]});await click(p,'tab-booking');await click(p,'tab-future');await fill(p,'futureDate','2026-10-25');await p.locator('#futureDate').dispatchEvent('change');await click(p,'new-future');await fill(p,'gStaff0','1');await fill(p,'gUnits0','2');await p.locator('[data-find-slots]').click();assert.equal(await p.locator('[data-use-slot]').count(),3);await p.locator('[data-more-slots]').click();assert.equal(await p.locator('[data-use-slot]').count(),5);
 await fill(p,'bookCount','3');await p.locator('#bookCount').dispatchEvent('change');await fill(p,'gUnits1','2');await fill(p,'gUnits2','2');await p.locator('[data-find-slots]').first().click();assert.match(await p.locator('[data-slot-results]').first().innerText(),/沒有能完整安排/);
 });

 await test('四位數預約時間新增、修改、複製與錯誤驗證',async p=>{
 await goto(p);await click(p,'tab-booking');await click(p,'new-day');assert.equal(await p.locator('#bookTime').getAttribute('inputmode'),'numeric');
 await fill(p,'bookTime','2460');await p.locator('#bookingForm [type=submit]').click();assert.equal(await p.locator('#booking-editor').isVisible(),true);assert.match(await p.locator('#message').innerText(),/請確認日期/);
 await fill(p,'bookTime','1435');await p.locator('#bookingForm [type=submit]').click();assert.match(await p.locator('#day-list').innerText(),/14:35/);await p.locator('[data-edit]:visible').click();assert.equal(await p.locator('#bookTime').inputValue(),'1435');await click(p,'cancelEditor');
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>window.copied=t},configurable:true}));await click(p,'copy-day');assert.match(await p.evaluate(()=>window.copied),/14:35/);
 });
 await test('累計分鐘與上班狀態移至班表，空檔僅顯示師傅與時段',async p=>{
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[],jobs:[{date:'2026-10-23',staff:'1',start:780,units:2}]});
 const text=await p.locator('#availability-list').innerText();assert.ok(!/當日已排|上班中|已下班|尚未上班|服務／整理中|空閒/.test(text),text);
 await click(p,'toggle-roster');assert.match(await p.locator('#today-roster').innerText(),/當日已排20分鐘/);assert.match(await p.locator('#today-roster').innerText(),/上班中/);
 });
 await test('查指定時間列出完整可工作師傅、整理邊界與不指定容量',async p=>{
 const r={confirmed:true,people:[{id:'1',from:'11:00',to:'22:00'},{id:'2',from:'11:00',to:'22:00'}]};
 const b=booking('15:00','');b.guests=[{bodyMinutes:30,footMinutes:0,staff:''}];
 await seed(p,{rosters:{'2026-10-23':r},bookings:[b],jobs:[{date:'2026-10-23',staff:'1',start:840,units:6}]});
 await click(p,'toggle-time-search');await fill(p,'searchTime','1435');await fill(p,'searchMinutes','2');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/沒有可完整安排/);
 await fill(p,'searchTime','1510');await fill(p,'searchMinutes','3');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/可工作師傅：1號$/);await fill(p,'searchTime','1600');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/可工作師傅：1號、2號/);
 const before=await p.evaluate(()=>localStorage.getItem('massage-dispatch-01'));await click(p,'close-time-search');assert.equal(await p.locator('#toggle-time-search').evaluate(e=>document.activeElement===e),true);assert.equal(await p.evaluate(()=>localStorage.getItem('massage-dispatch-01')),before);
 });
 await test('查詢缺班表、過去時間、無效時間與數字驗證',async p=>{
 await goto(p);await click(p,'toggle-time-search');await fill(p,'searchTime','1500');await fill(p,'searchMinutes','2');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/班表尚未確認/);
 await add(p,'1');await confirm(p);await fill(p,'searchTime','1359');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/時間已過/);
 await fill(p,'searchTime','2360');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/有效時間/);
 await fill(p,'searchTime','1500');await fill(p,'searchMinutes','0');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/至少2單位/);
 await fill(p,'searchMinutes','4');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/1號/);await fill(p,'searchMinutes','5');assert.match(await p.locator('#time-search-results').innerText(),/條件已變更/);
 });

 await test('查詢9單位等於90分鐘且保留整理',async p=>{
 const r={confirmed:true,people:[{id:'1',from:'14:00',to:'15:40'}]};
 await seed(p,{rosters:{'2026-10-23':r},bookings:[],jobs:[]});await click(p,'toggle-time-search');await fill(p,'searchTime','1400');await fill(p,'searchMinutes','9');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/按摩90分鐘＋整理10分鐘｜可工作師傅：1號/);
 await fill(p,'searchMinutes','10');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/沒有可完整安排/);
 assert.equal(await p.locator('label[for=searchMinutes]').innerText(),'按摩時數（1單位十分鐘）');assert.equal(await p.locator('#searchHint').innerText(),'1400表示下午兩點。');
 });
 await test('當日每筆預約皆為三級標題，包含多人及狀態',async p=>{
 const b1=booking('15:00','1'),b2={...booking('16:00',''),id:'b2',status:'pending',guests:[{units:2,staff:''},{units:3,staff:''}]};
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[b1,b2],jobs:[]});await click(p,'tab-booking');
 assert.equal(await p.locator('#day-list').getByRole('heading',{level:3}).count(),2);
 assert.deepEqual(await p.locator('#day-list h3').allTextContents(),['15:00｜1人','16:00｜2人']);assert.equal(await p.locator('#day-list article').count(),2);
 await p.locator('[data-edit]:visible').first().click();assert.equal(await p.locator('#bookTimeHint').innerText(),'1400表示下午兩點。');
 });

 await test('查詢每次展開帶入當下時間、秒數不誤判與清除舊結果',async p=>{
 await seed(p,{rosters:{'2026-10-23':roster},bookings:[],jobs:[]});
 await p.evaluate(()=>{window.Date=class extends Date{getHours(){return 14}getMinutes(){return 35}getSeconds(){return 42}}});
 await click(p,'toggle-time-search');assert.equal(await p.locator('#searchTime').inputValue(),'1435');await fill(p,'searchMinutes','2');await p.locator('#timeSearchForm [type=submit]').click();assert.match(await p.locator('#time-search-results').innerText(),/1號/);
 await fill(p,'searchTime','1600');await click(p,'close-time-search');await p.evaluate(()=>{window.Date=class extends Date{getHours(){return 14}getMinutes(){return 36}getSeconds(){return 15}}});await click(p,'toggle-time-search');assert.equal(await p.locator('#searchTime').inputValue(),'1436');assert.equal(await p.locator('#time-search-results').isVisible(),false);await fill(p,'searchTime','1700');assert.equal(await p.locator('#searchTime').inputValue(),'1700');
 });
 await test('時間說明只由欄位描述提供，沒有獨立可見提示',async p=>{
 await goto(p);await click(p,'toggle-time-search');assert.equal(await p.locator('#searchHint').isVisible(),false);await p.locator('#searchTime').evaluate(el=>{if(el.getAttribute('aria-describedby')!=='searchHint')throw Error('missing description')});
 await click(p,'tab-booking');await click(p,'new-day');assert.equal(await p.locator('#bookTimeHint').isVisible(),false);assert.equal(await p.locator('#bookTime').getAttribute('aria-describedby'),'bookTimeHint');
 assert.equal(await p.locator('#booking-editor').getByText('1400表示下午兩點。',{exact:true}).isVisible(),false);
 });

 await test('新增當日與未來預約時間空白、修改保留原時間',async p=>{
 await goto(p);await click(p,'tab-booking');await p.locator('#new-day').click();assert.equal(await p.locator('#bookTime').inputValue(),'');await p.locator('#bookingForm [type=submit]').click();assert.equal(await p.locator('#booking-editor').isVisible(),true);
 await fill(p,'bookTime','1435');await p.locator('#bookingForm [type=submit]').click();await p.locator('[data-edit]:visible').click();assert.equal(await p.locator('#bookTime').inputValue(),'1435');await click(p,'cancelEditor');
 await click(p,'tab-future');await fill(p,'futureDate','2026-10-25');await p.locator('#futureDate').dispatchEvent('change');await p.locator('#new-future').click();assert.equal(await p.locator('#bookTime').inputValue(),'');await fill(p,'bookTime','1530');await click(p,'cancelEditor');await p.locator('#new-future').click();assert.equal(await p.locator('#bookTime').inputValue(),'');
 });
 await test('服務單選不開啟原生選單，輸入與計時更新保留焦點',async p=>{
 await goto(p);await click(p,'tab-booking');await p.locator('#new-day').click();assert.equal(await p.locator('#booking-editor select').count(),0);assert.equal(await p.locator('#booking-editor').getByRole('radio').count(),6);
 await choose(p,'bookService','both');await fill(p,'bookTime','1435');await fill(p,'bookCount','2');await p.locator('#bookCount').press('Tab');assert.equal(await p.locator('[data-guest]').count(),2);
 await choose(p,'gService1','foot');await fill(p,'gFoot1','55');await p.evaluate(()=>{window.savedService=document.querySelector('#gService1');window.testTimers.forEach(f=>f())});assert.equal(await p.locator('#gFoot1').evaluate(e=>document.activeElement===e),true);
 await p.locator('#gService0 input[value=body]').focus();assert.equal(await p.locator('#gService0 input[value=both]').isChecked(),true);assert.equal(await p.locator('#booking-editor [role=dialog]').count(),0);
 await choose(p,'gService0','body');await fill(p,'gUnits0','6');await p.locator('#bookingForm [type=submit]').click();assert.match(await p.locator('#day-list').innerText(),/腳底55分鐘/);assert.match(await p.locator('#day-list').innerText(),/身體60分鐘/);
 await p.locator('[data-edit]:visible').click();assert.equal(await p.locator('#gService1 input[value=foot]').isChecked(),true);assert.equal(await p.locator('#gFoot1').inputValue(),'55');
 });

 await browser.close();fs.writeFileSync(__dirname+'/test-results.txt',results.join('\n')+'\n');console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});













