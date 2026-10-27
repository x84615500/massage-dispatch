'use strict';
const crypto=require('node:crypto'),core=require('./core.cjs');
const settings=()=>({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,publicKey:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY,email:(process.env.BOOKING_OWNER_EMAIL||'').toLowerCase()});
async function request(path,options={}){
  const s=settings();if(!s.url||!s.key)core.fail('預約雲端尚未啟用',503);
  const response=await fetch(s.url.replace(/\/$/,'')+path,{...options,headers:{apikey:s.key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(8000)});
  const text=await response.text();let result;try{result=text?JSON.parse(text):null;}catch{core.fail('預約資料庫回應異常',502);}
  if(!response.ok){if(result?.code==='40001')core.fail('資料已被其他操作更新，請重新讀取後再試',409);core.fail('預約資料庫暫時無法處理，請稍後重試',502);}return result;
}
async function owner(token){
  if(!token)core.fail('請先登入預約管理',401);const s=settings();
  if(!s.email)core.fail('管理者尚未設定',503);
  const response=await fetch(s.url+'/auth/v1/user',{headers:{apikey:s.publicKey||s.key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(6500)});
  if(!response.ok)core.fail('登入已過期，請重新登入',401);const user=await response.json();
  if(!user.email_confirmed_at||user.email?.toLowerCase()!==s.email)core.fail('只有管理者可操作',403);return user.id;
}
async function state(){const rows=await request('/rest/v1/dispatch_state?id=eq.1&select=revision,document');if(!rows?.[0])core.fail('預約資料表尚未建立',503);core.validate(rows[0].document);return rows[0];}
async function commit(current,document,requestId,actor,action){
  if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(requestId||''))core.fail('缺少有效操作編號');
  core.validateSchedule(document);
  return request('/rest/v1/rpc/dispatch_commit',{method:'POST',body:JSON.stringify({p_revision:current.revision,p_document:document,p_request:requestId,p_actor:actor,p_action:action})});
}
function sign(value){const key=settings().key;if(!key)core.fail('預約服務未設定',503);const data=Buffer.from(JSON.stringify({...value,expires:Date.now()+10*60000})).toString('base64url');return data+'.'+crypto.createHmac('sha256',key).update(data).digest('base64url');}
function unsign(token){try{const [data,signature]=String(token).split('.');const expected=crypto.createHmac('sha256',settings().key).update(data).digest();const actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw Error();const value=JSON.parse(Buffer.from(data,'base64url'));if(value.expires<Date.now())throw Error();return value;}catch{core.fail('確認已過期或無效，請重新操作',409);}}
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function bindingCode(){const code=crypto.randomBytes(16).toString('hex');await request('/rest/v1/dispatch_identity?id=eq.1',{method:'PATCH',body:JSON.stringify({binding_hash:hash(code),binding_expires_at:new Date(Date.now()+10*60000).toISOString()})});return code;}
async function bindLine(code,id){return request('/rest/v1/rpc/dispatch_bind',{method:'POST',body:JSON.stringify({p_hash:hash(code),p_line_user:id})});}
async function lineOwner(id){const rows=await request('/rest/v1/dispatch_identity?id=eq.1&select=line_user_id');return Boolean(id&&rows?.[0]?.line_user_id===id);}
async function operation(body,actor){
  const current=await state();
  if(body.action==='read')return current;
  if(body.action==='binding')return {code:await bindingCode()};
  if(body.action==='saveState'){
    if(body.revision!==current.revision)core.fail('資料已更新，請重新整理後再修改',409);
    const previous=new Map(current.document.bookings.map(b=>[b.id,b]));
    // Ordinary editing cancels instead of silently deleting existing records.
    if([...previous.keys()].some(id=>!body.document?.bookings?.some(b=>b.id===id)))core.fail('既有預約請使用取消；永久刪除需走清理流程');
    core.validate(body.document);
    for(const b of body.document.bookings)if(b.status==='confirmed'&&JSON.stringify(b)!==JSON.stringify(previous.get(b.id))&&!body.document.rosters[b.date]?.confirmed)core.fail('新增或修改已確認預約前，請先確認班表',409);
    const oldJobs=new Set(current.document.jobs.map(j=>j.id));for(const j of body.document.jobs)if(!oldJobs.has(j.id)&&!body.document.rosters[j.date]?.confirmed)core.fail('開始工作前，請先確認班表',409);
    return commit(current,body.document,body.requestId,actor,'網頁更新班表／預約／工作');
  }
  if(body.action==='purgePreview'){
    const preview=core.previewPurge(current.document,body.before);
    return {...preview,revision:current.revision,token:sign({type:'purge',revision:current.revision,preview,requestId:crypto.randomUUID()})};
  }
  if(body.action==='purgeConfirm'){
    const approved=unsign(body.token);if(approved.type!=='purge'||approved.revision!==current.revision)core.fail('清理範圍已變動，請重新預覽',409);
    return commit(current,core.purge(current.document,approved.preview),approved.requestId,actor,'永久清理 '+approved.preview.before+'以前已結束紀錄');
  }
  if(body.action==='export')return {exportedAt:new Date().toISOString(),revision:current.revision,document:current.document};
  if(body.action==='history')return request('/rest/v1/dispatch_audit?select=revision,actor,action,created_at&order=created_at.desc&limit=50');
  if(body.action==='importPreview'){
    const incoming=core.validate(body.document);const next=core.clone(current.document),ids=new Set(next.bookings.map(b=>b.id)),jobs=new Set(next.jobs.map(j=>j.id));
    for(const [date,roster] of Object.entries(incoming.rosters))if(!next.rosters[date])next.rosters[date]=roster;
    for(const booking of incoming.bookings)if(!ids.has(booking.id)){next.bookings.push(booking);ids.add(booking.id);}
    for(const job of incoming.jobs)if(!jobs.has(job.id)){next.jobs.push(job);jobs.add(job.id);}
    core.validateSchedule(next);
    // Import is two-step; confirmation carries only digest, upload same file again.
    return {bookingsAdded:next.bookings.length-current.document.bookings.length,token:sign({type:'import',revision:current.revision,digest:hash(JSON.stringify(next)),requestId:crypto.randomUUID()}),document:next};
  }
  if(body.action==='importConfirm'){
    const approved=unsign(body.token);if(approved.type!=='import'||approved.revision!==current.revision||approved.digest!==hash(JSON.stringify(body.document)))core.fail('匯入內容或版本已改變，請重新預覽',409);
    return commit(current,body.document,approved.requestId,actor,'匯入本機備份（同ID保留雲端）');
  }
  core.fail('不支援的預約操作');
}
module.exports={settings,request,owner,state,commit,sign,unsign,bindingCode,bindLine,lineOwner,operation,hash};

