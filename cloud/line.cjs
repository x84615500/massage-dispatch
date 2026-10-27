'use strict';
const crypto=require('node:crypto'),core=require('./core.cjs'),server=require('./server.cjs');
const clean=text=>String(text).replace(/^(?:(?:請|幫我|麻煩)\s*)+/,'').trim();
const canHandle=text=>/^(?:預約功能|綁定預約|新增預約|查預約|今天.*預約|明天.*預約|查看預約|修改預約|取消預約|恢復預約|確認預約|放棄預約|預約紀錄)/.test(clean(text));
function parseDate(text){
  if(/今天|明天|後天/.test(text)){const offset=text.includes('後天')?2:text.includes('明天')?1:0;return new Date(Date.parse(core.today()+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
  const full=text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);if(full){const date=full[1]+'-'+full[2].padStart(2,'0')+'-'+full[3].padStart(2,'0');if(core.dateOK(date))return date;}
  return null;
}
function parseTime(text){
  const match=text.match(/(?:上午|下午|晚上|中午)?\s*(\d{1,2})[:：](\d{2})/);if(!match)return null;
  let hour=Number(match[1]);if(/下午|晚上/.test(match[0])&&hour<12)hour+=12;if(/上午/.test(match[0])&&hour===12)hour=0;const result=String(hour).padStart(2,'0')+':'+match[2];return core.timeOK(result)?result:null;
}
function parseNew(text){
  const date=parseDate(text),time=parseTime(text);if(!date||!time)core.fail('請提供明確日期與時間，例如「新增預約 明天 15:00 身體60分鐘 2人 指定1,2 備註王先生」');
  const count=Number(text.match(/(\d+)\s*人/)?.[1]||1),body=Number(text.match(/身體\s*(\d+)\s*分/)?.[1]||0),foot=Number(text.match(/腳底\s*(\d+)\s*分/)?.[1]||0);
  if(!body&&!foot)core.fail('請指定服務與分鐘，例如「身體60分鐘」或「腳底40分鐘」');
  if(count<1||count>20)core.fail('每筆預約人數須為1至20人');
  const specified=text.match(/指定\s*([\d,，、\s]+)/)?.[1]?.trim().split(/[,，、\s]+/).filter(Boolean)||[];
  if(specified.length&&specified.length!==count)core.fail('指定師傅數量須與人數一致；不指定請省略「指定」');
  return {date,time,guests:Array.from({length:count},(_,i)=>({bodyMinutes:body,footMinutes:foot,staff:specified[i]||''})),note:text.match(/備註[：:]?\s*([\s\S]+)$/)?.[1]||''};
}
function help(){return '預約管理（僅限已綁定管理者私訊）\n新增預約 明天 15:00 身體60分鐘 2人 指定1,2 備註王先生\n查預約 今天／明天／2026-11-03\n查看預約 B-編號\n修改預約 B-編號 明天 16:00\n取消預約 B-編號\n恢復預約 B-編號\n確認預約 六位確認碼\n放棄預約\n預約紀錄\n寫入前會列出內容並請你確認；完整班表與備份／清理請使用網頁。';}
async function draft(actor,current,document,summary){
  const code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase(),requestId=crypto.randomUUID();
  await server.request('/rest/v1/dispatch_pending?on_conflict=actor',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({actor,code,payload:{revision:current.revision,document,summary,requestId},expires_at:new Date(Date.now()+10*60000).toISOString()})});
  return summary+'\n尚未寫入。確認請回覆「確認預約 '+code+'」，10分鐘內有效；或「放棄預約」。';
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
    if(text==='放棄預約'){await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor),{method:'DELETE'});return '已放棄尚未寫入的操作。';}
    if(text.startsWith('確認預約')){
      const code=text.replace(/^確認預約\s*/,'').trim().toUpperCase();const rows=await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor)+'&select=code,payload,expires_at');const pending=rows?.[0];
      if(!pending||pending.code!==code||Date.parse(pending.expires_at)<Date.now())return '確認碼無效或已過期，請重新提出預約操作。';
      const payload=pending.payload;await server.commit({revision:payload.revision},payload.document,payload.requestId,actor,payload.summary);
      await server.request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor),{method:'DELETE'});
      return '已成功寫入雲端，網頁重新整理即可看到。\n'+payload.summary;
    }
    if(text==='預約紀錄'){const rows=await server.request('/rest/v1/dispatch_audit?select=action,created_at&order=created_at.desc&limit=10');return rows.length?rows.map(r=>new Date(r.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+' '+r.action).join('\n'):'尚無操作紀錄。';}
    const current=await server.state();
    if(/^(?:查預約|今天.*預約|明天.*預約)/.test(text)){const date=parseDate(text),name=text.replace(/^查預約\s*/,'').trim();if(!date&&name.length<2)return '請指定日期或姓名，例如「查預約 明天」或「查預約 王先生」。';const rows=current.document.bookings.filter(b=>b.status!=='cancelled'&&(date?b.date===date:(b.customerName||'').includes(name)||b.note.includes(name))).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));return rows.length?rows.slice(0,20).map(core.bookingText).join('\n\n')+(rows.length>20?'\n超過20筆，請指定日期縮小範圍。':''):(date||name)+' 沒有有效預約。';}
    const bookingId=text.match(/^(?:查看預約|修改預約|取消預約|恢復預約)\s+(\S+)/)?.[1]?.toUpperCase();
    const old=bookingId?current.document.bookings.find(b=>b.id.toUpperCase()===bookingId):null;
    if(text.startsWith('查看預約'))return old?core.bookingText(old):'找不到這個預約編號。';
    if(text.startsWith('新增預約')){const input=parseNew(text);input.status=current.document.rosters[input.date]?.confirmed?'confirmed':'pending';const result=core.saveBooking(current.document,input);return draft(actor,current,result.state,'新增\n'+core.bookingText(result.booking));}
    if(!old)return '請提供有效預約編號，例如先用「查預約 明天」查詢。';
    if(text.startsWith('取消預約')){const result=core.cancelBooking(current.document,old.id);return draft(actor,current,result.state,'取消\n'+core.bookingText(result.booking));}
    if(text.startsWith('恢復預約')){const status=current.document.rosters[old.date]?.confirmed?'confirmed':'pending';const result=core.saveBooking(current.document,{status},old.id);return draft(actor,current,result.state,'恢復\n'+core.bookingText(result.booking));}
    if(text.startsWith('修改預約')){const date=parseDate(text)||old.date,time=parseTime(text)||old.time,body=text.match(/身體\s*(\d+)\s*分/),foot=text.match(/腳底\s*(\d+)\s*分/),guests=core.clone(old.guests);if(body||foot){const guest=Number(text.match(/第(\d+)位/)?.[1]||(guests.length===1?1:0));if(guest<1||guest>guests.length)return '多人預約請指定第幾位客人，例如「修改預約 '+old.id+' 第1位 身體90分鐘」。';if(body)guests[guest-1].bodyMinutes=Number(body[1]);if(foot)guests[guest-1].footMinutes=Number(foot[1]);}else if(!parseTime(text)&&!parseDate(text))return '請提供改期時間或服務，例如「修改預約 '+old.id+' 明天 16:00」。';const result=core.saveBooking(current.document,{date,time,guests},old.id);return draft(actor,current,result.state,'修改前：'+old.date+' '+old.time+'\n修改後\n'+core.bookingText(result.booking));}
    return help();
  }catch(error){return error.status?error.message:'預約服務暫時無法使用，這次未確認成功；請稍後查詢預約核對。';}
}
module.exports={canHandle,parseDate,parseTime,parseNew,help,handleLine};

