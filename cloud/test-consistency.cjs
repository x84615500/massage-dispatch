const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite'),core=require('./core.cjs'),server=require('./server.cjs'),line=require('./line.cjs'),api=require('../api/dispatch.js');
const ids=['6','8','15','27'],dates=Array.from({length:14},(_,i)=>'2099-01-'+String(i+1).padStart(2,'0')),empty=()=>({rosters:Object.fromEntries(dates.map(d=>[d,{confirmed:true,people:ids.map(id=>({id,from:'11:00',to:'22:00'}))}])),bookings:[],jobs:[]}),uuid=()=>crypto.randomUUID(),booking=(staff='6',time='12:00',date=dates[0])=>({date,time,guests:[{staff,bodyMinutes:60,footMinutes:0}]}),event={source:{type:'user',userId:'owner'}},user={id:'customer',email:'customer@example.com'};
test('consistency fixes against real isolated PostgreSQL transactions',async t=>{
 process.env.SUPABASE_URL='https://isolated.test';process.env.SUPABASE_SECRET_KEY='isolated';process.env.SUPABASE_PUBLISHABLE_KEY='public';process.env.BOOKING_OWNER_EMAIL='owner@example.com';process.env.LINE_CHANNEL_ACCESS_TOKEN='test';
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync(__dirname+'/schema.sql','utf8'));await db.query("update dispatch_identity set line_user_id='owner'");
 let lose=false,barrier=null;const state=async()=>(await db.query('select revision,document from dispatch_state where id=1')).rows[0],pending=async()=>(await db.query("select * from dispatch_pending where actor='line:owner'")).rows[0];
 async function reset(document=empty()){await db.exec('truncate dispatch_requests,dispatch_pending,dispatch_audit');await db.query('update dispatch_state set revision=0,document=$1::jsonb',[JSON.stringify(document)]);}
 global.fetch=async(url,o={})=>{const u=new URL(url),path=u.pathname,b=o.body?JSON.parse(o.body):null;let value;try{
  if(u.hostname==='api.line.me')value={};else if(path==='/auth/v1/user')return {ok:true,json:async()=>({id:'admin',email:'owner@example.com',email_confirmed_at:'2026-01-01'})};
  else if(path.endsWith('/dispatch_state'))value=[await state()];else if(path.endsWith('/dispatch_identity'))value=[{line_user_id:'owner'}];
  else if(path.endsWith('/dispatch_pending')){const actor=(u.searchParams.get('actor')||'eq.line:owner').slice(3),code=u.searchParams.get('code')?.slice(3);
   if(o.method==='POST')value=(await db.query('insert into dispatch_pending(actor,code,payload,expires_at) values($1,$2,$3::jsonb,$4) returning *',[b.actor,b.code,JSON.stringify(b.payload),b.expires_at])).rows;
   else if(o.method==='PATCH')value=(await db.query('update dispatch_pending set code=$3,payload=$4::jsonb,expires_at=$5 where actor=$1 and code=$2 returning *',[actor,code,b.code,JSON.stringify(b.payload),b.expires_at])).rows;
   else if(o.method==='DELETE'){await db.query('delete from dispatch_pending where actor=$1 and ($2::text is null or code=$2)',[actor,code||null]);value=null;}
   else{value=(await db.query('select * from dispatch_pending where actor=$1',[actor])).rows;if(barrier){const wait=barrier;wait.count++;if(wait.count===2){barrier=null;wait.release();}await wait.promise;}}
  }else if(path.endsWith('/dispatch_commit')){value=(await db.query('select dispatch_commit($1,$2::jsonb,$3::uuid,$4,$5) as value',[b.p_revision,JSON.stringify(b.p_document),b.p_request,b.p_actor,b.p_action])).rows[0].value;if(lose){lose=false;throw Object.assign(Error('response lost'),{network:true});}}
  else throw Error('Unexpected request');return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(value)};
 }catch(error){if(error.network)throw error;return {ok:false,status:409,text:async()=>JSON.stringify({code:error.code})};}};
 try{
 await t.test('lost response and exact replay recover success; changed contents or foreign actor cannot reuse request ID',async()=>{
  await reset();const requestId=uuid();lose=true;const result=await server.customerOperation({action:'customerCreate',booking:booking(),requestId},user);assert.match(result.message,/已完成/);assert.equal((await state()).document.bookings.length,1);
  const replay=await server.customerOperation({action:'customerCreate',booking:booking(),requestId},user);assert.match(replay.message,/已完成/);assert.equal((await state()).document.bookings.length,1);
  await assert.rejects(server.customerOperation({action:'customerCreate',booking:booking('8','14:00'),requestId},user),/其他內容/);
  await assert.rejects(server.customerOperation({action:'customerCreate',booking:booking(),requestId},{id:'other',email:'other@example.com'}),/其他內容/);
  assert.deepEqual(await server.customerOperation({action:'operationStatus',requestId},{id:'other'}),{processed:false});
 });
 await t.test('100 concurrent distinct slots retry conflicts without losing successful reservations',async()=>{
  await reset();const results=await Promise.allSettled(Array.from({length:100},(_,i)=>server.customerOperation({action:'customerCreate',requestId:uuid(),booking:{date:dates[Math.floor(i/56)],time:require('./availability.cjs').hh(660+(i%14)*40),guests:[{staff:ids[Math.floor((i%56)/14)],bodyMinutes:20,footMinutes:0}]}},{id:'c'+i,email:'c'+i+'@example.com'})));
  const ok=results.filter(r=>r.status==='fulfilled').length;console.log('CONCURRENT',ok,'/ 100');assert.equal(ok,100);assert.equal((await state()).document.bookings.length,100);
 });
 await t.test('two LINE workers append atomically and unrelated cancel cannot replace an active creation draft',async()=>{
  await reset();let release;const promise=new Promise(r=>release=r);barrier={count:0,release,promise};const responses=await Promise.all([line.handleLine(event,'新增預約 20990101 1200 身體6 指定8號 備註甲'),line.handleLine(event,'新增預約 20990101 1400 身體6 指定15號 備註乙')]);assert(responses.every(r=>r.includes('尚未寫入')));assert.equal((await pending()).payload.bookings.length,2);assert.match(await line.handleLine(event,'確認預約'),/成功寫入/);const s=await state();assert.equal(s.document.bookings.length,2);
  await line.handleLine(event,'新增預約 20990101 1700 身體6 指定27號');const before=(await pending()).code;assert.match(await line.handleLine(event,'取消預約 '+s.document.bookings[0].id),/其他待確認/);assert.equal((await pending()).code,before);
  for(const suffix of ['20990230 1530','20990102 2460'])assert.match(await line.handleLine(event,'修改預約 '+s.document.bookings[0].id+' '+suffix),/無效/);assert.equal((await pending()).code,before);
  await line.handleLine(event,'放棄預約');const replayEvent={...event,webhookEventId:'fixed-webhook-event'};const text='新增預約 20990102 1200 身體6';await line.handleLine(replayEvent,text);await line.handleLine(replayEvent,text);assert.equal((await pending()).payload.bookings.length,1);await line.handleLine(event,'確認預約');assert.match(await line.handleLine(replayEvent,text),/先前已處理/);assert.equal((await state()).document.bookings.filter(b=>b.date===dates[1]).length,1);
 });
 await t.test('roster removal and work overlapping pending booking are rejected on server',async()=>{
  const initial=core.saveBooking(empty(),{...booking('8','15:00'),status:'pending'}).state;await reset(initial);const document=core.clone(initial);document.rosters[dates[0]].people=document.rosters[dates[0]].people.filter(p=>p.id!=='8');
  await assert.rejects(server.operation({action:'saveState',revision:0,document,requestId:uuid()},'web:admin'),/班|排/);
  const work=core.clone(initial);work.jobs.push({id:'overlap',date:dates[0],staff:'8',start:900,bodyMinutes:60,footMinutes:0});await assert.rejects(server.operation({action:'saveState',revision:0,document:work,requestId:uuid()},'web:admin'),/衝突|不足/);assert.equal((await state()).revision,0);
 });
 await t.test('delta update of 6000 historical bookings stays small and server rejects stale same-record edits',async()=>{
  const document=empty();document.bookings=Array.from({length:6000},(_,i)=>({id:'history-'+i,date:'2020-01-01',time:'12:00',status:'cancelled',note:'historical note',customerName:'historical customer',customerPhone:'0000000000',guests:[{staff:ids[i%4],bodyMinutes:60,footMinutes:0}]}));await reset(document);
  const before=document.bookings[5999],after={...before,note:'updated'},changes={bookings:[{id:before.id,before,after}]},body={action:'saveChanges',revision:0,requestId:uuid(),changes};assert(Buffer.byteLength(JSON.stringify(body))<2048);
  let status,result;await api({method:'POST',headers:{authorization:'Bearer test'},body},{setHeader(){},status(n){status=n;return this},json(v){result=v;return this}});assert.equal(status,200);assert.equal(result.document.bookings[5999].note,'updated');
  await assert.rejects(server.operation({...body,requestId:uuid()},'web:admin'),/已被其他操作修改/);assert.equal((await state()).document.bookings.length,6000);
 });
 await t.test('customers receive explicit truncation marker without private fields',async()=>{const document=empty();document.bookings=Array.from({length:501},(_,i)=>({id:'b'+i,date:dates[0],time:'12:00',status:'pending',note:'private',createdBy:'other',guests:[{staff:'6',bodyMinutes:60,footMinutes:0}]}));const result=server.customerSchedule({document},{id:'customer'});assert.equal(result.truncated,true);assert.equal(result.bookings.length,500);assert(!JSON.stringify(result).includes('private'));});
 }finally{await db.close();}
});
test('past current-day starts are rejected at minute precision',()=>{assert.throws(()=>core.futureStart('2026-10-29','11:00',new Date('2026-10-29T15:15:30+08:00')),/過去/);assert.doesNotThrow(()=>core.futureStart('2026-10-29','15:15',new Date('2026-10-29T15:15:30+08:00')));});
