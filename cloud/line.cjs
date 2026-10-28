'use strict';
const crypto=require('node:crypto'),core=require('./core.cjs'),server=require('./server.cjs');
const clean=text=>String(text).replace(/^(?:(?:請|幫我|麻煩)\s*)+/,'').trim();
const canHandle=text=>/^(?:預約功能|綁定預約|新增預約|查預約|今天.*預約|明天.*預約|查看預約|修改預約|取消預約|恢復預約|確認預約|放棄預約|預約紀錄)/.test(clean(text));
function parseDate(text){
  text=String(text).split(/備註/)[0];
  if(/今天|明天|後天/.test(text)){const offset=text.includes('後天')?2:text.includes('明天')?1:0;return new Date(Date.parse(core.today()+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
  const full=text.match(/(?:^|[^\d])(\d{4})(?:[-/年](\d{1,2})[-/月](\d{1,2})日?|(\d{2})(\d{2}))(?!\d)/);if(full){const date=full[1]+'-'+(full[2]||full[4]).padStart(2,'0')+'-'+(full[3]||full[5]).padStart(2,'0');if(core.dateOK(date))return date;}
  return null;
}
function parseTime(text){
  // Strip booking ID, date, services and note before accepting a bare HHmm token.
  const source=text.replace(/^(?:修改預約|查看預約|取消預約|恢復預約)\s+\S+/,'').split(/備註/)[0].replace(/\d{4}(?:[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{4})/g,'').replace(/(?:身體|腳底)\s*\d+\s*(?:分鐘?|單位)?/g,'');
  const match=source.match(/(?:上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：](\d{2})|點(?:(\d{1,2})分?)?)/)||source.match(/(?:^|[^\d])(\d{2})(\d{2})(?!\d)/);if(!match)return null;
  let hour=Number(match[1]);if(/下午|晚上/.test(match[0])&&hour<12)hour+=12;if(/上午/.test(match[0])&&hour===12)hour=0;const result=String(hour).padStart(2,'0')+':'+String(match[2]||match[3]||'00').padStart(2,'0');return core.timeOK(result)?result:null;
}
function service(text,name){const match=text.split(/備註/)[0].match(new RegExp(name+'\\s*(\\d+)\\s*(分鐘?|單位)?'));if(!match)return null;const n=Number(match[1]);return name==='身體'&&(!match[2]||match[2]==='單位')?n*10:n;}
function appendStaged(document,booking,status=booking.status){
  if(booking.date<core.today())core.fail('待確認預約日期已過，請重新新增',409);
  if(document.bookings.some(b=>b.id===booking.id))core.fail('待確認的預約編號已存在，請先查詢核對',409);
  if(status==='confirmed'&&!document.rosters[booking.date]?.confirmed)core.fail('請先確認當日班表',409);
  const next=core.clone(document);next.bookings.push({...booking,status});core.validateSchedule(next);return next;
}
function parseNew(text){
  const main=text.split(/備註/)[0];
  const date=parseDate(text),time=parseTime(text);if(!date||!time)core.fail('請提供明確日期與時間，例如「新增預約 明天 15:00 身體60分鐘 2人 指定1,2 備註王先生」');
  const count=Number(main.match(/(\d+)\s*人/)?.[1]||1),body=service(text,'身體')||0,foot=service(text,'腳底')||0;
  if(!body&&!foot)core.fail('請指定服務與分鐘，例如「身體60分鐘」或「腳底40分鐘」');
  if(count<1||count>20)core.fail('每筆預約人數須為1至20人');
  const specified=main.match(/指定\s*([\d,，、\s]+)/)?.[1]?.trim().split(/[,，、\s]+/).filter(Boolean)||[];
  if(specified.length&&specified.length!==count)core.fail('指定師傅數量須與人數一致；不指定請省略「指定」');
  return {date,time,guests:Array.from({length:count},(_,i)=>({bodyMinutes:body,footMinutes:foot,staff:specified[i]||''})),note:text.match(/備註[：:]?\s*([\s\S]+)$/)?.[1]||''};
}
function help(){return '預約管理（僅限已綁定管理者私訊）\n新增預約\n20261031 1335 身體9腳底40 備註王先生\n20261031 1600 身體6 備註林小姐\n每行一筆，最多10筆；也可分次傳送「新增預約」累加。身體9＝90分鐘；腳底40＝40分鐘。\n查預約 今天／明天／20261031\n查看預約 B-編號\n修改預約 B-編號 明天 1600\n取消預約 B-編號\n恢復預約 B-編號\n確認預約：一次確認目前列出的整批\n放棄預約\n預約紀錄\n網頁待確認預約可送到LINE確認；正式確認仍需班表與容量允許。';}
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
      const payload=pending.payload;let completionSummary=payload.summary;
      if(payload.kind==='confirm-existing'){const saved=await server.confirmBookings(await server.state(),payload.ids,payload.requestId,actor,payload.expected);completionSummary=payload.ids.map(id=>core.bookingText(saved.document.bookings.find(b=>b.id===id))).join('\n\n');}
      else if(payload.kind==='create-batch'){
        const current=await server.state();let document=core.clone(current.document);
        for(const booking of payload.bookings){const existing=document.bookings.find(b=>b.id===booking.id);if(existing){if(JSON.stringify({...existing,status:booking.status})!==JSON.stringify(booking))core.fail('待確認預約內容已變，請先查詢核對',409);continue;}document=appendStaged(document,booking,current.document.rosters[booking.date]?.confirmed?'confirmed':'pending');}
        const saved=await server.commit(current,document,payload.requestId,actor,payload.summary);const actual=saved?.document||document;completionSummary=payload.bookings.map(b=>core.bookingText(actual.bookings.find(row=>row.id===b.id))).join('\n\n');
      }else await server.commit({revision:payload.revision},payload.document,payload.requestId,actor,payload.summary);
      await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor)+'&code=eq.'+encodeURIComponent(pending.code),{method:'DELETE'});
      return '已成功寫入雲端，網頁重新讀取雲端即可看到；若列為待確認，仍須先完成當日班表。\n'+completionSummary;
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
      for(let i=0;i<lines.length;i++){try{const input=parseNew(lines[i]);input.status=current.document.rosters[input.date]?.confirmed?'confirmed':'pending';const result=core.saveBooking(document,input);document=result.state;bookings.push(result.booking);}catch(error){return '第'+(i+1)+'行未加入：'+(error.status?error.message:'資料格式有誤')+'。這次傳送的整批均未加入，原本待確認內容保留。';}}
      return draft(actor,current,document,'整批新增 '+bookings.length+' 筆\n'+bookings.map(b=>core.bookingText({...b,note:b.note.slice(0,100)})).join('\n\n'),{kind:'create-batch',bookings});
    }
    if(!old)return '請提供有效預約編號，例如先用「查預約 明天」查詢。';
    if(text.startsWith('取消預約')){const result=core.cancelBooking(current.document,old.id);return draft(actor,current,result.state,'取消\n'+core.bookingText(result.booking));}
    if(text.startsWith('恢復預約')){const status=current.document.rosters[old.date]?.confirmed?'confirmed':'pending';const result=core.saveBooking(current.document,{status},old.id);return draft(actor,current,result.state,'恢復\n'+core.bookingText(result.booking));}
    if(text.startsWith('修改預約')){const date=parseDate(text)||old.date,time=parseTime(text)||old.time,body=service(text,'身體'),foot=service(text,'腳底'),guests=core.clone(old.guests);if(body!==null||foot!==null){const guest=Number(text.match(/第(\d+)位/)?.[1]||(guests.length===1?1:0));if(guest<1||guest>guests.length)return '多人預約請指定第幾位客人，例如「修改預約 '+old.id+' 第1位 身體90分鐘」。';if(body!==null)guests[guest-1].bodyMinutes=body;if(foot!==null)guests[guest-1].footMinutes=foot;}else if(!parseTime(text)&&!parseDate(text))return '請提供改期時間或服務，例如「修改預約 '+old.id+' 明天 16:00」。';const result=core.saveBooking(current.document,{date,time,guests},old.id);return draft(actor,current,result.state,'修改前：'+old.date+' '+old.time+'\n修改後\n'+core.bookingText(result.booking));}
    return help();
  }catch(error){return error.status?error.message:'預約服務暫時無法使用，這次未確認成功；請稍後查詢預約核對。';}
}
module.exports={canHandle,parseDate,parseTime,parseNew,help,handleLine};


