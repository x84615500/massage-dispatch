const test=require('node:test'),assert=require('node:assert/strict'),server=require('./server.cjs'),line=require('./line.cjs');
const event={source:{type:'user',userId:'owner'}};
test('compact and Chinese dates, times and combined services have exact meanings',()=>{
  for(const date of ['20261031','2026年10月31日','2026-10-31'])assert.equal(line.parseDate(date),'2026-10-31');
  for(const time of ['1335','下午1點35分','13:35'])assert.equal(line.parseTime(time),'13:35');
  const booking=line.parseNew('新增預約 20261031 1335 身體9腳底40');
  assert.equal(booking.date,'2026-10-31');assert.equal(booking.time,'13:35');assert.equal(booking.guests[0].bodyMinutes,90);assert.equal(booking.guests[0].footMinutes,40);
  assert.equal(line.parseNew('新增預約 2026年10月31日 下午1點35分 身體90分鐘').guests[0].bodyMinutes,90);
  assert.equal(line.parseNew('新增預約 20261031 1335 腳底40').guests[0].bodyMinutes,0);
  const withNote=line.parseNew('新增預約 20990101 1335 身體9 備註今天提到2人與指定3');assert.equal(withNote.date,'2099-01-01');assert.equal(withNote.guests.length,1);assert.equal(withNote.guests[0].staff,'');
  assert.equal(line.parseDate('20260230'),null);assert.equal(line.parseTime('2460'),null);
  assert.equal(line.parseTime('修改預約 1335 身體9'),null);assert.equal(line.parseTime('新增預約 20261031 身體9 備註1335'),null);
});
test('LINE rejects groups and unbound accounts before reading private bookings',async()=>{server.lineOwner=async()=>false;server.state=async()=>{throw Error('must not read');};assert.match(await line.handleLine({source:{type:'group',userId:'owner'}},'查預約 明天'),/私訊/);assert.match(await line.handleLine(event,'查預約 明天'),/未獲/);});
test('LINE draft does not write bookings until matching confirmation',async()=>{let pending,commits=0;server.lineOwner=async()=>true;server.state=async()=>({revision:0,document:{rosters:{},bookings:[],jobs:[]}});server.request=async(path,options)=>{if(path.includes('dispatch_pending')&&options?.method==='POST'){pending=JSON.parse(options.body);return null;}if(options?.method==='DELETE'){pending=null;return null;}return pending?[pending]:[];};server.commit=async(current,document,id)=>{commits++;assert.equal(current.revision,0);assert.equal(document.bookings.length,1);assert.ok(id);};const answer=await line.handleLine(event,'幫我新增預約 2099-01-01 15:00 身體60分鐘 1人 備註測試');assert.match(answer,/尚未寫入/);assert.equal(commits,0);assert.match(await line.handleLine(event,'確認預約 WRONG'),/沒有有效/);assert.equal(commits,0);const code=pending.code;assert.match(await line.handleLine(event,'確認預約'),/仍未正式確認/);assert.equal(commits,1);});
test('legacy imported numeric booking IDs remain queryable',async()=>{server.lineOwner=async()=>true;server.state=async()=>({revision:1,document:{rosters:{},jobs:[],bookings:[{id:'1790000000.123',date:'2099-01-01',time:'15:00',guests:[{bodyMinutes:60,footMinutes:0,staff:''}],note:'王先生',status:'pending'}]}});assert.match(await line.handleLine(event,'查看預約 1790000000.123'),/王先生/);assert.match(await line.handleLine(event,'查預約 王先生'),/1790000000.123/);});



