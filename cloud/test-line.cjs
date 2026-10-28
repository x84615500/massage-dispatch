const test=require('node:test'),assert=require('node:assert/strict'),server=require('./server.cjs'),line=require('./line.cjs');
const event={source:{type:'user',userId:'owner'}};
test('spoken booking examples fill exact fields with Taiwan date defaults',()=>{
  const core=require('./core.cjs'),today=core.today(),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10),year=today.slice(0,4);
  const cases=[
    ['新增預約，今天，下午兩點35分，按摩90分鐘，指定6號，備注林小姐',today,'14:35','6','林小姐'],
    ['新增預約，下午兩點35分，按摩90分鐘，不指定，備注林小姐',today,'14:35','','林小姐'],
    ['新增預約，明天，下午兩點35分，按摩90分鐘，備注林小姐',tomorrow,'14:35','','林小姐'],
    ['新增預約，明天，下午兩點35分，按摩90分鐘，指定6號',tomorrow,'14:35','6',''],
    ...['號','日'].map(end=>['新增預約，10月30'+end+'，下午兩點30分，按摩90分鐘，指定6號，備注林小姐',year+'-10-30','14:30','6','林小姐']),
    ['新增預約，下午２點３５分，按摩９０分鐘，指定６號，備註：林小姐',today,'14:35','6','林小姐'],
    ['新增預約，下午兩點三十五分，按摩九十分鐘，指定六號，備註林小姐',today,'14:35','6','林小姐']
  ];
  for(const [input,date,time,staff,note] of cases){const result=line.parseNew(input);assert.deepEqual(result,{date,time,guests:[{bodyMinutes:90,footMinutes:0,staff}],note},input);}
  const note=line.parseNew('新增預約，1435，按摩90分鐘，備注明天2人指定9號10月30日');assert.equal(note.date,today);assert.equal(note.guests.length,1);assert.equal(note.guests[0].staff,'');assert.equal(note.note,'明天2人指定9號10月30日');
  assert.equal(line.parseDate('十月三十日'),year+'-10-30');assert.equal(line.parseDate('查預約 林小姐'),null);
});
test('spoken time variants and invalid inputs never silently change date or staff',()=>{
  for(const [input,time] of [['下午兩點半','14:30'],['下午兩點一刻','14:15'],['下午兩點三刻','14:45'],['中午十二點','12:00'],['凌晨十二點35分','00:35'],['下午2:35','14:35']])assert.equal(line.parseTime(input),time,input);
  for(const input of ['新增預約，2月30日，1435，按摩90分鐘','新增預約，20260230，1435，按摩90分鐘','新增預約，下午兩點60分，按摩90分鐘','新增預約，1435，按摩90分鐘，指定師傅','新增預約，1435，按摩90分鐘，不指定，指定6號'])assert.throws(()=>line.parseNew(input),undefined,input);
  assert.deepEqual(line.parseNew('新增預約 明天 1435 身體9腳底40 兩人 指定6號、8號').guests,[{bodyMinutes:90,footMinutes:40,staff:'6'},{bodyMinutes:90,footMinutes:40,staff:'8'}]);
});
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
test('LINE draft does not write bookings until matching confirmation',async()=>{let pending,commits=0;server.lineOwner=async()=>true;server.state=async()=>({revision:0,document:{rosters:{'2099-01-01':{confirmed:true,people:[{id:'1',from:'09:00',to:'23:59'}]}},bookings:[],jobs:[]}});server.request=async(path,options)=>{if(path.includes('dispatch_pending')&&options?.method==='POST'){pending=JSON.parse(options.body);return null;}if(options?.method==='DELETE'){pending=null;return null;}return pending?[pending]:[];};server.commit=async(current,document,id)=>{commits++;assert.equal(current.revision,0);assert.equal(document.bookings.length,1);assert.ok(id);};const answer=await line.handleLine(event,'幫我新增預約 2099-01-01 15:00 身體60分鐘 1人 備註測試');assert.match(answer,/尚未寫入/);assert.equal(commits,0);assert.match(await line.handleLine(event,'確認預約 WRONG'),/沒有有效/);assert.equal(commits,0);const code=pending.code;assert.match(await line.handleLine(event,'確認預約'),/成功寫入/);assert.equal(commits,1);});
test('legacy imported numeric booking IDs remain queryable',async()=>{server.lineOwner=async()=>true;server.state=async()=>({revision:1,document:{rosters:{},jobs:[],bookings:[{id:'1790000000.123',date:'2099-01-01',time:'15:00',guests:[{bodyMinutes:60,footMinutes:0,staff:''}],note:'王先生',status:'pending'}]}});assert.match(await line.handleLine(event,'查看預約 1790000000.123'),/王先生/);assert.match(await line.handleLine(event,'查預約 王先生'),/1790000000.123/);});
