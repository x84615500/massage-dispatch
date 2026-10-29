const test=require('node:test'),assert=require('node:assert/strict'),core=require('./core.cjs'),line=require('./line.cjs'),available=require('./availability.cjs'),server=require('./server.cjs');
const date='2099-01-01',clock={today:date,minute:11*60},empty=()=>({rosters:{[date]:{confirmed:true,people:['6','7'].map(id=>({id,from:'11:00',to:'22:00'}))}},bookings:[],jobs:[]});
const booking=(id,time,staff,status='pending',length=60)=>({id,date,time,status,note:'PRIVATE-NOTE',customerName:'PRIVATE-NAME',guests:[{staff,bodyMinutes:length,footMinutes:0}]});
test('all user examples route to deterministic availability with explicit minimum duration',()=>{
  for(const text of ['查詢，現在，有誰可以工作？','查詢，下午3:15，有誰可以工作？','查詢，今天，6號，可以預約嗎？','查詢，下午3:15，6號，可以預約嗎？','查詢，今天，6號，還有哪些時段？'])assert.equal(line.canHandle(text),true,text);
  assert.deepEqual(line.parseAvailability('查詢，下午3:15，6號，可以預約嗎？',clock),{date,time:'15:15',staff:'6',bodyMinutes:20,footMinutes:0,defaultService:true,listRanges:false});
  assert.equal(line.parseAvailability('查詢，今天，6號，還有哪些時段？',clock).listRanges,true);
  assert.equal(line.parseAvailability('查詢，10月30號，6號，可以預約嗎？',clock).staff,'6');
  const q=line.parseAvailability('查詢，明天，1535，六號，身體9腳底40，可以預約嗎？',clock);assert.equal(q.date,'2099-01-02');assert.equal(q.time,'15:35');assert.equal(q.bodyMinutes,90);assert.equal(q.footMinutes,40);
  assert.equal(line.parseAvailability('查詢，現在，6號，身體1440分鐘，可以預約嗎？',clock).bodyMinutes,1440);
  for(const text of ['查詢天氣','查詢，今天6號新聞','查詢，台北按摩推薦'])assert.equal(line.isAvailabilityQuery(text),false,text);
  assert.throws(()=>line.parseAvailability('查詢，下午3:75，有誰可以工作？',clock),/有效時間/);assert.throws(()=>line.parseAvailability('查詢，2月30日，6號，可以預約嗎？',clock),/日期無效/);
});
test('Taiwan server clock handles UTC date boundary and rounds now up to the next minute',()=>{
  assert.deepEqual(available.taiwanClock(new Date('2026-10-28T16:00:00Z')),{today:'2026-10-29',minute:0});
  assert.deepEqual(available.taiwanClock(new Date('2026-10-29T07:15:01Z')),{today:'2026-10-29',minute:916});
});
test('pending and confirmed bookings plus real work block availability, cancelled rows release capacity',()=>{
  const s=empty();s.bookings=[booking('p','15:00','6')];let q={date,time:'15:15'};
  assert.deepEqual(available.inspect(s,q,clock).rows.filter(r=>r.available).map(r=>r.staff),['7']);
  s.jobs.push({id:'job',date,staff:'7',start:15*60,bodyMinutes:60,footMinutes:0});assert.equal(available.inspect(s,q,clock).rows.filter(r=>r.available).length,0);
  s.bookings[0].status='cancelled';assert.deepEqual(available.inspect(s,q,clock).rows.filter(r=>r.available).map(r=>r.staff),['6']);
  s.bookings[0].status='confirmed';assert.equal(available.inspect(s,{date,time:'16:09',staff:'6'},clock).rows[0].available,false);assert.equal(available.inspect(s,{date,time:'16:10',staff:'6'},clock).rows[0].available,true);
});
test('every listed start range and maximum obeys the same whole-day capacity solver as admission',()=>{
  const s=empty();s.bookings=[booking('p','12:00','6'),booking('u','15:00','')];
  const row=available.inspect(s,{date,staff:'6'},clock).rows[0];assert.deepEqual(row.ranges.map(r=>[available.hh(r.start),available.hh(r.end)]),[['11:00','11:30'],['13:10','21:30']]);assert.equal(row.ranges[0].maxMinutes,50);
  const before=JSON.stringify(s);for(let minute=660;minute<1440;minute++){
    const probe=core.clone(s);probe.bookings.push(booking('probe',available.hh(minute),'6','pending',20));let possible=true;try{core.admitBookings(probe,['probe']);}catch{possible=false;}
    assert.equal(row.ranges.some(r=>r.start<=minute&&minute<=r.end),possible,'minute '+minute);
  }assert.equal(JSON.stringify(s),before);
});
test('unassigned bookings can consume the last available therapist and all ranges split at pending edges',()=>{
  const s=empty();s.bookings=[booking('u','15:00',''),booking('fixed','15:00','7')];const row=available.inspect(s,{date,staff:'6'},clock).rows[0];assert.deepEqual(row.ranges.map(r=>[available.hh(r.start),available.hh(r.end)]),[['11:00','14:30'],['16:10','21:30']]);
  const q={date,time:'21:30',staff:'6'};assert.equal(available.inspect(s,q,clock).rows[0].available,true);assert.equal(available.inspect(s,{...q,time:'21:31'},clock).rows[0].available,false);
  assert.equal(available.inspect(s,{date,time:'20:00',bodyMinutes:90,footMinutes:40,staff:'6'},clock).rows[0].available,false);
});
test('invalid date, missing/unconfirmed roster, unrostered staff and elapsed time never claim availability',()=>{
  const s=empty();assert.throws(()=>available.inspect(s,{date,time:'10:59'},clock),/已過/);assert.throws(()=>available.inspect(s,{date:'2098-12-31'},clock),/今天或未來/);assert.throws(()=>available.inspect(s,{date,staff:'8'},clock),/未排班/);s.rosters[date].confirmed=false;assert.throws(()=>available.inspect(s,{date},clock),/尚未確認/);delete s.rosters[date];assert.throws(()=>available.inspect(s,{date},clock),/尚未確認/);
});
test('bound owner LINE read-only lookup reads live cloud once and cannot alter drafts or expose customer data',async()=>{
  const today=core.today(),s=empty();s.rosters[today]=s.rosters[date];let reads=0;
  server.lineOwner=async()=>true;server.state=async()=>{reads++;return {revision:1,document:s}};server.request=async()=>{throw Error('no draft reads or writes');};server.commit=async()=>{throw Error('must not write');};
  const event={source:{type:'user',userId:'owner'}};
  const response=await line.handleLine(event,'查詢，明天，6號，還有哪些時段？');assert.match(response,/尚未確認/);assert.equal(reads,1);
  const live=await line.handleLine(event,'查詢，20990101，下午3:15，有誰可以工作？');assert.match(live,/6號/);assert.match(live,/7號/);assert.match(live,/查詢不會保留/);assert.equal(reads,2);
  const answer=available.answer(empty(),line.parseAvailability('查詢，下午3:15，有誰可以工作？',clock),clock);assert.match(answer,/6號/);assert.match(answer,/7號/);assert(!/PRIVATE-|預約編號/.test(answer));
  assert.match(await line.handleLine({source:{type:'group',userId:'owner'}},'查詢，現在，有誰可以工作？'),/私訊/);assert.equal(reads,2);server.lineOwner=async()=>false;assert.match(await line.handleLine(event,'查詢，今天，6號，可以預約嗎？'),/未獲/);assert.equal(reads,2);
});
