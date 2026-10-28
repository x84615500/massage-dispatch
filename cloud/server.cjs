'use strict';
const crypto=require('node:crypto'),core=require('./core.cjs');
const settings=()=>({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,publicKey:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY,email:(process.env.BOOKING_OWNER_EMAIL||'').toLowerCase()});
async function request(path,options={}){
  const s=settings();if(!s.url||!s.key)core.fail('預約雲端尚未啟用',503);
  const response=await fetch(s.url.replace(/\/$/,'')+path,{...options,headers:{apikey:s.key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(8000)});
  const text=await response.text();let result;try{result=text?JSON.parse(text):null;}catch{core.fail('預約資料庫回應異常',502);}
  if(!response.ok){if(result?.code==='40001')core.fail('資料已被其他操作更新，請重新讀取後再試',409);core.fail('預約資料庫暫時無法處理，請稍後重試',502);}return result;
}
async function identity(token){
  if(!token)core.fail('請先登入預約管理',401);const s=settings();
  if(!s.email)core.fail('管理者尚未設定',503);
  const response=await fetch(s.url+'/auth/v1/user',{headers:{apikey:s.publicKey||s.key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(6500)});
  if(!response.ok)core.fail('登入已過期，請重新登入',401);const user=await response.json();
  if(!user.id||typeof user.email!=='string'||!user.email_confirmed_at)core.fail('請先驗證登入信箱',403);
  const email=user.email.trim().toLowerCase();return {id:user.id,email,role:email===s.email?'admin':'customer'};
}
async function owner(token){
  const user=await identity(token);if(user.role!=='admin')core.fail('只有管理者可操作',403);return user.id;
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
function selectedPending(current,ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>10||new Set(ids).size!==ids.length)core.fail('請選擇1至10筆不同的預約');
  return ids.map(id=>{const row=current.document.bookings.find(b=>b.id===id);if(!row||row.status==='cancelled')core.fail('預約不存在或已取消，請重新讀取',409);return row;});
}
function confirmationRequestId(notificationRequestId){
  const value=hash('dispatch-confirm-v1:'+notificationRequestId).slice(0,32);
  return value.slice(0,8)+'-'+value.slice(8,12)+'-5'+value.slice(13,16)+'-8'+value.slice(17,20)+'-'+value.slice(20);
}
async function confirmBookings(current,ids,requestId,actor,expected){
  const rows=selectedPending(current,ids);let document=core.clone(current.document);
  for(const row of rows){if(row.status==='confirmed')continue;if(expected&&expected[row.id]!==hash(JSON.stringify(row)))core.fail('預約內容已變更，請在網頁重新送LINE確認',409);document=core.saveBooking(document,{status:'confirmed'},row.id).state;}
  if(rows.every(b=>b.status==='confirmed'))return current;
  const saved=await commit(current,document,requestId,actor,'確認 '+rows.length+' 筆預約');
  if(rows.some(row=>saved?.document?.bookings?.find(b=>b.id===row.id)?.status!=='confirmed'))core.fail('雲端未完成確認，預約仍待確認，請重新送LINE確認',409);
  return saved;
}
async function notifyBookings(current,ids,requestId){
  try{
    if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(requestId||''))core.fail('缺少有效操作編號');
    const rows=selectedPending(current,ids).filter(b=>b.status==='pending');if(!rows.length)return {ok:false,message:'選取的預約已經確認，不需再送出'};
    const identity=await request('/rest/v1/dispatch_identity?id=eq.1&select=line_user_id'),lineId=identity?.[0]?.line_user_id;
    if(!lineId||!process.env.LINE_CHANNEL_ACCESS_TOKEN)return {ok:false,message:'尚未完成LINE綁定，預約已保留，請先綁定後再送出'};
    const actor='line:'+lineId,existing=await request('/rest/v1/dispatch_pending?actor=eq.'+encodeURIComponent(actor)+'&select=code,payload,expires_at');
    const active=existing?.[0]&&Date.parse(existing[0].expires_at)>Date.now(),oldPayload=existing?.[0]?.payload;
    const same=oldPayload?.kind==='confirm-existing'&&oldPayload.ids.length===rows.length&&rows.every(b=>oldPayload.ids.includes(b.id)&&oldPayload.expected?.[b.id]===hash(JSON.stringify(b)));
    if(active&&!same)return {ok:false,message:'LINE有其他待確認內容，這次未送通知。請先確認或放棄，再從網頁重新送出；新增預約仍保留'};
    const selected=rows;
    const code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();
    const summary=selected.map(b=>core.bookingText({...b,note:b.note.slice(0,100)})).join('\n\n');
    await request('/rest/v1/dispatch_pending?on_conflict=actor',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({actor,code,payload:{kind:'confirm-existing',ids:selected.map(b=>b.id),expected:Object.fromEntries(selected.map(b=>[b.id,hash(JSON.stringify(b))])),requestId,summary},expires_at:new Date(Date.now()+10*60000).toISOString()})});
    const message='網頁有 '+selected.length+' 筆待確認預約：\n'+summary+'\n\n核對後回覆「確認預約」，將一次確認以上全部，10分鐘內有效。回覆「放棄預約」只放棄本次確認，網頁預約仍保留。';
    const messages=[];let remaining=message;while(remaining){let end=Math.min(4500,remaining.length);if(end<remaining.length&&/[\uD800-\uDBFF]/.test(remaining[end-1]))end--;messages.push({type:'text',text:remaining.slice(0,end)});remaining=remaining.slice(end);}
    if(messages.length>5)core.fail('預約內容過長，請減少筆數後再送出');
    const response=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+process.env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json','X-Line-Retry-Key':requestId},body:JSON.stringify({to:lineId,messages}),signal:AbortSignal.timeout(6500)});
    if(!response.ok&&!(response.status===409&&response.headers?.get('x-line-accepted-request-id')))return {ok:false,message:response.status===429?'LINE訊息額度或頻率限制，尚未確認通知成功，請稍後重送或直接在網頁確認':'LINE通知未成功，請稍後重送或直接在網頁確認'};
    return {ok:true,message:'已送出LINE確認通知（是否送達仍受封鎖／好友狀態影響），預約仍為待確認'};
  }catch(error){return {ok:false,message:error.status?error.message:'LINE通知暫時失敗，預約仍保留，可稍後重送或直接確認'};}
}
async function publicSchedule(){
  const current=await state(),today=core.today();
  const rows=current.document.bookings.filter(b=>b.date>=today&&b.status!=='cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return {today,bookings:rows.slice(0,500).map(b=>({date:b.date,time:b.time,people:b.guests.length,status:b.status,services:b.guests.map(g=>({bodyMinutes:core.body(g),footMinutes:core.foot(g),staff:g.staff||''}))})),truncated:rows.length>500};
}
function customerSchedule(current,user){
  const today=core.today();
  // Only a customer's own rows carry an identifier. No ownership or contact fields leave this boundary.
  const rows=current.document.bookings.filter(b=>b.date>=today&&b.status!=='cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const own=rows.filter(b=>b.createdBy===user.id),others=rows.filter(b=>b.createdBy!==user.id);
  const show=b=>({date:b.date,time:b.time,services:b.guests.map(g=>({bodyMinutes:core.body(g),footMinutes:core.foot(g)})),...(b.createdBy===user.id?{id:b.id,mine:true}:{})});
  return {role:'customer',today,bookings:[...own,...others.slice(0,500)].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(show),truncated:others.length>500};
}
async function customerOperation(body,user){
  if(!['read','customerCreate','customerDelete'].includes(body.action))core.fail('客戶只能新增或刪除自己的預約',403);
  const current=await state();if(body.action==='read')return customerSchedule(current,user);
  let document=core.clone(current.document),added;
  if(body.action==='customerCreate'){
    const input=body.booking;
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['date','time','guests','note','customerName','customerPhone'].includes(k)))core.fail('預約欄位不正確');
    if(!Array.isArray(input.guests)||input.guests.some(g=>!g||Object.keys(g).some(k=>!['bodyMinutes','footMinutes','staff'].includes(k))))core.fail('服務欄位不正確');
    const result=core.saveBooking(document,{...input,status:'pending'});document=result.state;added=result.booking;added.createdBy=user.id;
    added.customerEmail=user.email;
  }else{
    const row=document.bookings.find(b=>b.id===body.id);
    // Use the same response for missing and foreign identifiers.
    if(!row||row.createdBy!==user.id)core.fail('只能刪除自己新增的預約',403);
    if(row.status==='cancelled')return customerSchedule(current,user);
    if(row.date<core.today())core.fail('過去的預約請聯絡管理者處理',409);
    document=core.cancelBooking(document,row.id).state;
  }
  const saved=await commit(current,document,body.requestId,'customer:'+user.id,added?'客戶新增預約':'客戶刪除自己的預約');
  const response=customerSchedule(saved,user);
  if(added){response.notification=await notifyBookings(saved,[added.id],body.requestId);response.message='預約已新增，等待管理者確認。';}
  else response.message='已刪除自己的預約。';
  return response;
}
async function operation(body,actor){
  const current=await state();
  if(body.action==='read')return current;
  if(body.action==='binding')return {code:await bindingCode()};
  if(body.action==='confirmBookings'||body.action==='notifyBookings'){
    if(body.revision!==current.revision)core.fail('資料已更新，請重新讀取雲端後再確認或送出',409);
    return body.action==='confirmBookings'?confirmBookings(current,body.ids,body.requestId,actor):{notification:await notifyBookings(current,body.ids,body.requestId)};
  }
  if(body.action==='saveState'){
    if(body.revision!==current.revision)core.fail('資料已更新，請重新整理後再修改',409);
    const previous=new Map(current.document.bookings.map(b=>[b.id,b]));
    // Ordinary editing cancels instead of silently deleting existing records.
    if([...previous.keys()].some(id=>!body.document?.bookings?.some(b=>b.id===id)))core.fail('既有預約請使用取消；永久刪除需走清理流程');
    core.validate(body.document);
    const added=body.document.bookings.filter(b=>!previous.has(b.id));
    for(const b of body.document.bookings){const old=previous.get(b.id);if(old){if(old.createdBy)b.createdBy=old.createdBy;else delete b.createdBy;if(old.customerEmail)b.customerEmail=old.customerEmail;else delete b.customerEmail;}else{delete b.createdBy;delete b.customerEmail;}}
    if(added.some(b=>b.status!=='pending'))core.fail('網頁新增預約一律先存為待確認');
    for(const b of body.document.bookings)if(b.status==='confirmed'&&JSON.stringify(b)!==JSON.stringify(previous.get(b.id))&&!body.document.rosters[b.date]?.confirmed)core.fail('新增或修改已確認預約前，請先確認班表',409);
    const oldJobs=new Set(current.document.jobs.map(j=>j.id));for(const j of body.document.jobs)if(!oldJobs.has(j.id)&&!body.document.rosters[j.date]?.confirmed)core.fail('開始工作前，請先確認班表',409);
    const saved=await commit(current,body.document,body.requestId,actor,'網頁更新班表／預約／工作');
    if(added.length)saved.notification=await notifyBookings(saved,added.map(b=>b.id),body.requestId);
    return saved;
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
module.exports={settings,request,identity,owner,state,commit,sign,unsign,bindingCode,bindLine,lineOwner,operation,hash,confirmBookings,notifyBookings,publicSchedule,confirmationRequestId,customerSchedule,customerOperation};
