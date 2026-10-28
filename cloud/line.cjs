'use strict';
const crypto=require('node:crypto'),core=require('./core.cjs'),server=require('./server.cjs');
const clean=text=>String(text).replace(/^(?:(?:請|幫我|麻煩)\s*)+/,'').trim();
const canHandle=text=>/^(?:預約功能|綁定預約|新增預約|查預約|今天.*預約|明天.*預約|查看預約|修改預約|取消預約|恢復預約|確認預約|放棄預約|預約紀錄)/.test(clean(text));
const normalize=text=>String(text).normalize('NFKC').replace(/備注/g,'備註');
const numberToken='[0-9零〇一二兩三四五六七八九十百]+';
function numeral(value){
  if(/^\d+$/.test(value))return Number(value);
  const digits={'零':0,'〇':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(value.includes('百'))return NaN;
  if(value.includes('十')){const parts=value.split('十');return parts.length===2?(parts[0]?digits[parts[0]]:1)*10+(parts[1]?digits[parts[1]]:0):NaN;}
  return Number([...value].map(c=>digits[c]).join(''));
}
const mainText=text=>normalize(text).split(/備註/)[0];
function parseDate(text){
  text=mainText(text);
  if(/今天|明天|後天/.test(text)){const offset=text.includes('後天')?2:text.includes('明天')?1:0;return new Date(Date.parse(core.today()+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
  const full=text.match(/(?:^|[^\d])(\d{4})(?:[-/年](\d{1,2})[-/月](\d{1,2})日?|(\d{2})(\d{2}))(?!\d)/);if(full){const date=full[1]+'-'+(full[2]||full[4]).padStart(2,'0')+'-'+(full[3]||full[5]).padStart(2,'0');if(core.dateOK(date))return date;}
  const short=text.match(new RegExp('('+numberToken+')月('+numberToken+')[日號]'));
  if(short){const date=core.today().slice(0,4)+'-'+String(numeral(short[1])).padStart(2,'0')+'-'+String(numeral(short[2])).padStart(2,'0');return core.dateOK(date)?date:null;}
  return null;
}
function parseTime(text){
  // Strip booking ID, date, services and note before accepting a bare HHmm token.
  const source=mainText(text).replace(/^(?:修改預約|查看預約|取消預約|恢復預約)\s+\S+/,'').replace(/\d{4}(?:[-/年]\d{1,2}[-/月]\d{1,2}[日號]?|\d{4})/g,'').replace(new RegExp('(?:身體|按摩|腳底)\\s*'+numberToken+'\\s*(?:分鐘?|單位)?','g'),'').replace(new RegExp('指定\\s*'+numberToken+'(?:\\s*號?\\s*[,、]\\s*'+numberToken+')*\\s*號?','g'),'').replace(new RegExp(numberToken+'\\s*人','g'),'');
  const spoken=source.match(new RegExp('(凌晨|早上|上午|下午|晚上|中午)?\\s*('+numberToken+')[點时時](?:(半|一刻|三刻)|\\s*('+numberToken+')分?)?'));
  const numeric=spoken?null:source.match(/(?<!\d)(?:凌晨|早上|上午|下午|晚上|中午)?\s*(\d{1,2}):(\d{2})(?!\d)/)||source.match(/(?:^|[^\d])(\d{2})(\d{2})(?!\d)/);
  if(!spoken&&!numeric)return null;
  let hour=spoken?numeral(spoken[2]):Number(numeric[1]),minute=spoken?(spoken[4]?numeral(spoken[4]):({'半':30,'一刻':15,'三刻':45}[spoken[3]]||0)):Number(numeric[2]);
  const period=spoken?.[1]||numeric?.[0].match(/凌晨|早上|上午|下午|晚上|中午/)?.[0];if(period&&(hour<1||hour>12))return null;
  if(/下午|晚上|中午/.test(period)&&hour<12)hour+=12;if(/上午|早上|凌晨/.test(period)&&hour===12)hour=0;
  const result=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');return core.timeOK(result)?result:null;
}
function service(text,name){const match=mainText(text).match(new RegExp('('+(name==='身體'?'身體|按摩':name)+')\\s*('+numberToken+')\\s*(分鐘?|單位)?'));if(!match)return null;const n=numeral(match[2]);return match[1]==='身體'&&(!match[3]||match[3]==='單位')?n*10:n;}
function appendStaged(document,booking,status=booking.status){
  if(booking.date<core.today())core.fail('待確認預約日期已過，請重新新增',409);
  if(document.bookings.some(b=>b.id===booking.id))core.fail('待確認的預約編號已存在，請先查詢核對',409);
  if(status==='confirmed'&&!document.rosters[booking.date]?.confirmed)core.fail('請先確認當日班表',409);
  const next=core.clone(document);next.bookings.push({...booking,status});core.validateSchedule(next);core.admitBookings(next,[booking.id]);return next;
}
function parseNew(text){
  text=normalize(text);const main=mainText(text);
  let date=parseDate(main);if(!date&&/今天|明天|後天|年|月|\d{8}|\d+[-/]\d+/.test(main))core.fail('日期無效，請使用今天、明天、10月30日或20261031');
  date=date||core.today();const time=parseTime(main);if(!time)core.fail('請提供明確且有效的時間，例如「下午兩點35分」或「1435」');
  const count=numeral(main.match(new RegExp('('+numberToken+')\\s*人'))?.[1]||'1'),body=service(text,'身體')||0,foot=service(text,'腳底')||0;
  if(!body&&!foot)core.fail('請指定服務與分鐘，例如「身體60分鐘」或「腳底40分鐘」');
  if(count<1||count>20)core.fail('每筆預約人數須為1至20人');
  const staffText=main.replace(/不指定/g,'');
  const specified=[...staffText.matchAll(new RegExp('指定\\s*('+numberToken+'(?:\\s*號?\\s*[,、]\\s*'+numberToken+')*)\\s*號?','g'))].flatMap(m=>m[1].split(/\s*[,、]\s*/).map(s=>String(numeral(s.replace(/號/g,'').trim()))));
  if(/指定/.test(staffText)&&!specified.length)core.fail('請提供指定師傅號碼，例如「指定6號」，或輸入「不指定」');
  if(main.includes('不指定')&&specified.length)core.fail('請擇一輸入「不指定」或指定師傅號碼');
  if(specified.length&&specified.length!==count)core.fail('指定師傅數量須與人數一致；不指定請省略「指定」');
  return {date,time,guests:Array.from({length:count},(_,i)=>({bodyMinutes:body,footMinutes:foot,staff:specified[i]||''})),note:text.match(/備註[：:]?\s*([\s\S]+)$/)?.[1]||''};
}
function help(){return '預約管理（僅限已綁定管理者私訊）\n新增預約，明天，下午兩點35分，按摩90分鐘，指定6號，備註林小姐\n日期可用今天、明天、10月30號、10月30日或20261031；未寫日期就是台灣今天，月日未寫年份採今年。未寫人數＝1人；未指定師傅＝不指定；未寫備註＝留白。按摩90分鐘＝身體90分鐘。\n也支援簡寫：新增預約 20261031 1335 身體9腳底40\n每行一筆，最多10筆；也可分次傳送「新增預約」累加。身體9＝90分鐘；腳底40＝40分鐘。\n查預約 今天／明天／20261031\n查看預約 B-編號\n修改預約 B-編號 明天 1600\n取消預約 B-編號\n恢復預約 B-編號\n確認預約：核對內容後一次確認目前列出的整批\n放棄預約\n預約紀錄\n網頁待確認預約可送到LINE確認；正式確認仍需班表與容量允許。';}
async function draft(actor,current,document,summary,extra={}){
  const code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase(),requestId=crypto.randomUUID();
  await server.request('/rest/v1/dispatch_pending?on_conflict=actor',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({actor,code,payload:{revision:current.revision,document,summary,requestId,...extra},expires_at:new Date(Date.now()+10*60000).toISOString()})});
  return summary+'\n尚未寫入。核對整批內容後回覆「確認預約」，10分鐘內有效；或「放棄預約」。';
}
async function handleLine(event,text){
  text=clean(text);
  if(!canHandle(text))return null;
  if(event.source?.type!=='user')return '預約涉及客人資料，請改用私訊操作。';
  if(text==='預約功能')return help();
  const id=event.source?.userId;if(!id)return '無法辨識LINE身分，不能操作預約。';
  try{
    if(text.startsWith('綁定預約')){const code=text.replace(/^綁定預約\s*/,'').trim();if(!/^[a-f0-9]{32}$/.test(code))return '請先在已登入的預約網頁產生綁定碼，再貼上「綁定預約 綁定碼」。';return await server.bindLine(code,id)?'已綁定此LINE帳號，可輸入「預約功能」查看指令。':'綁定碼無效或已過期，請重新產生。';}
    if(!await server.lineOwner(id))return '此LINE帳號未獲預約管理權限，請先在登入的網頁產生綁定碼。';
    const actor='line:'+id;
    if(text==='放棄預約'){await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor),{method:'DELETE'});return '已放棄本次待確認操作；網頁已存的待確認預約仍保留。';}
    if(text.startsWith('確認預約')){
      const code=text.replace(/^確認預約\s*/,'').trim().toUpperCase();const rows=await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor)+'&select=code,payload,expires_at');const pending=rows?.[0];
      if(!pending||(code&&pending.code!==code)||Date.parse(pending.expires_at)<Date.now())return '沒有有效的待確認操作，或已過期，請重新提出預約操作。';
      const payload=pending.payload;let completionSummary=payload.summary,pendingCount=0;
      if(payload.kind==='confirm-existing'){const saved=await server.confirmBookings(await server.state(),payload.ids,server.confirmationRequestId(payload.requestId),actor,payload.expected);completionSummary=payload.ids.map(id=>core.bookingText(saved.document.bookings.find(b=>b.id===id))).join('\n\n');}
      else if(payload.kind==='create-batch'){
        const current=await server.state();let document=core.clone(current.document);
        for(const booking of payload.bookings){const existing=document.bookings.find(b=>b.id===booking.id);if(existing){if(JSON.stringify({...existing,status:booking.status})!==JSON.stringify(booking))core.fail('待確認預約內容已變，請先查詢核對',409);continue;}document=appendStaged(document,booking,current.document.rosters[booking.date]?.confirmed?'confirmed':'pending');}
        const saved=await server.commit(current,document,payload.requestId,actor,payload.summary);const actual=saved?.document||document;pendingCount=payload.bookings.filter(b=>actual.bookings.find(row=>row.id===b.id)?.status==='pending').length;completionSummary=payload.bookings.map(b=>core.bookingText(actual.bookings.find(row=>row.id===b.id))).join('\n\n');
      }else await server.commit({revision:payload.revision},payload.document,payload.requestId,actor,payload.summary);
      await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor)+'&code=eq.'+encodeURIComponent(pending.code),{method:'DELETE'});
      return (pendingCount?'已存入雲端，但有'+pendingCount+'筆因當日班表尚未確認，仍未正式確認。請先在網頁確認班表，再按「直接確認」或「送 LINE 確認」。':'已成功寫入雲端。請在網頁預約標籤按「重新讀取雲端」查看最新狀態。')+'\n'+completionSummary;
    }
    if(text==='預約紀錄'){const rows=await server.request('/rest/v1/dispatch_audit?select=action,created_at&order=created_at.desc&limit=10');return rows.length?rows.map(r=>new Date(r.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+' '+r.action).join('\n'):'尚無操作紀錄。';}
    const current=await server.state();
    if(/^(?:查預約|今天.*預約|明天.*預約)/.test(text)){const date=parseDate(text),name=text.replace(/^查預約\s*/,'').trim();if(!date&&name.length<2)return '請指定日期或姓名，例如「查預約 明天」或「查預約 王先生」。';const rows=current.document.bookings.filter(b=>b.status!=='cancelled'&&(date?b.date===date:(b.customerName||'').includes(name)||b.note.includes(name))).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));return rows.length?rows.slice(0,20).map(core.bookingText).join('\n\n')+(rows.length>20?'\n超過20筆，請指定日期縮小範圍。':''):(date||name)+' 沒有有效預約。';}
    const bookingId=text.match(/^(?:查看預約|修改預約|取消預約|恢復預約)\s+(\S+)/)?.[1]?.toUpperCase();
    const old=bookingId?current.document.bookings.find(b=>b.id.toUpperCase()===bookingId):null;
    if(text.startsWith('查看預約'))return old?core.bookingText(old):'找不到這個預約編號。';
    if(text.startsWith('新增預約')){
      const rows=await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor)+'&select=code,payload,expires_at'),pending=rows?.[0],active=pending&&Date.parse(pending.expires_at)>Date.now();
      if(active&&pending.payload.kind!=='create-batch')return '目前有其他待確認操作，請先回覆「確認預約」或「放棄預約」，再新增一批。';
      const lines=text.replace(/^新增預約\s*/,'').split(/\r?\n/).map(s=>s.trim().replace(/^新增預約\s*/,'' )).filter(Boolean),bookings=active?core.clone(pending.payload.bookings):[];
      if(!lines.length||lines.length+bookings.length>10)return '請每行輸入一筆預約，每批最多10筆。';
      let document=core.clone(current.document);
      for(const booking of bookings)document=appendStaged(document,booking);
      for(let i=0;i<lines.length;i++){try{const input=parseNew(lines[i]);input.status=current.document.rosters[input.date]?.confirmed?'confirmed':'pending';const result=core.saveBooking(document,input);core.admitBookings(result.state,[result.booking.id]);document=result.state;bookings.push(result.booking);}catch(error){return '第'+(i+1)+'行未加入：'+(error.status?error.message:'資料格式有誤')+'。這次傳送的整批均未加入，原本待確認內容保留。';}}
      return draft(actor,current,document,'整批新增 '+bookings.length+' 筆\n'+bookings.map(b=>core.bookingText({...b,note:b.note.slice(0,100)})).join('\n\n'),{kind:'create-batch',bookings});
    }
    if(!old)return '請提供有效預約編號，例如先用「查預約 明天」查詢。';
    if(text.startsWith('取消預約')){const result=core.cancelBooking(current.document,old.id);return draft(actor,current,result.state,'取消\n'+core.bookingText(result.booking));}
    if(text.startsWith('恢復預約')){const status=current.document.rosters[old.date]?.confirmed?'confirmed':'pending';const result=core.saveBooking(current.document,{status},old.id);core.admitBookings(result.state,[old.id]);return draft(actor,current,result.state,'恢復\n'+core.bookingText(result.booking));}
    if(text.startsWith('修改預約')){const date=parseDate(text)||old.date,time=parseTime(text)||old.time,body=service(text,'身體'),foot=service(text,'腳底'),guests=core.clone(old.guests);if(body!==null||foot!==null){const guest=Number(text.match(/第(\d+)位/)?.[1]||(guests.length===1?1:0));if(guest<1||guest>guests.length)return '多人預約請指定第幾位客人，例如「修改預約 '+old.id+' 第1位 身體90分鐘」。';if(body!==null)guests[guest-1].bodyMinutes=body;if(foot!==null)guests[guest-1].footMinutes=foot;}else if(!parseTime(text)&&!parseDate(text))return '請提供改期時間或服務，例如「修改預約 '+old.id+' 明天 16:00」。';const result=core.saveBooking(current.document,{date,time,guests},old.id);core.admitBookings(result.state,[old.id]);return draft(actor,current,result.state,'修改前：'+old.date+' '+old.time+'\n修改後\n'+core.bookingText(result.booking));}
    return help();
  }catch(error){return error.status?error.message:'預約服務暫時無法使用，這次未確認成功；請稍後查詢預約核對。';}
}
module.exports={canHandle,parseDate,parseTime,parseNew,help,handleLine};
