'use strict';
const core=require('./core.cjs');
function taiwanClock(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {today:parts.year+'-'+parts.month+'-'+parts.day,minute:Number(parts.hour)*60+Number(parts.minute),second:Number(parts.second)};
}
const hh=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
function inspect(document,query,clock=taiwanClock()){
  const {date,staff='',time=null,bodyMinutes=20,footMinutes=0}=query;
  if(!core.dateOK(date)||date<clock.today)core.fail('請查詢今天或未來的日期');
  if(time!==null&&!core.timeOK(time))core.fail('查詢時間無效');
  const sample={id:'availability-probe',date,time:'00:00',status:'pending',note:'',guests:[{bodyMinutes,footMinutes,staff}]};
  core.validate({rosters:{},bookings:[sample],jobs:[]});
  const roster=document.rosters[date];if(!roster?.confirmed)core.fail(date+' 班表尚未確認，暫時無法提供可靠的可預約時段',409);
  const people=roster.people.filter(p=>!staff||p.id===staff).sort((a,b)=>Number(a.id)-Number(b.id));
  if(staff&&!people.length)core.fail(date+' 的'+staff+'號按摩師未排班',409);
  const lower=date===clock.today?clock.minute:0,start=time===null?lower:core.minutes(time);
  if(start>=1440)core.fail('今天已無剩餘時段，請改查明天');
  if(start<lower)core.fail('這個開始時間已過，請查詢現在之後的時間');
  // A query for the current minute starts at the real current second, not in the past.
  const effectiveStart=start+(date===clock.today&&start===clock.minute?(clock.second||0)/60:0);
  const model={rosters:{[date]:roster},bookings:document.bookings.filter(b=>b.date===date&&b.status!=='cancelled'),jobs:document.jobs.filter(j=>j.date===date)};
  try{core.feasible(model,date,true);}catch(error){if(error.status===409&&!/過於複雜/.test(error.message))core.fail('既有預約／工作與班表有衝突，請先由管理者調整，再查詢可用時段',409);throw error;}
  const spans=[...model.bookings.flatMap(b=>b.guests.map(g=>[core.minutes(b.time),core.minutes(b.time)+core.duration(g)+10])),...model.jobs.map(j=>[j.start,j.start+core.duration(j)+10])];
  let probes=0;const deadline=Date.now()+2000;
  function fits(person,at,length=bodyMinutes+footMinutes){
    if(++probes>10000||Date.now()>deadline)core.fail('時段查詢資料較多，請指定按摩師與時間縮小範圍後再試',503);
    try{return core.feasible(model,date,true,[{start:at,end:at+length+10,staff:person.id}]);}catch(error){if(error.status===409&&!/過於複雜/.test(error.message))return false;throw error;}
  }
  function maximum(person,at){let lo=20,hi=Math.floor(core.minutes(person.to)-at-10),best=0;while(lo<=hi){const mid=Math.floor((lo+hi)/2);if(fits(person,at,mid)){best=mid;lo=mid+1;}else hi=mid-1;}
    if(!bodyMinutes)return best<40?0:40+Math.floor((best-40)/15)*15;
    return footMinutes+Math.max(0,Math.floor((best-footMinutes)/10)*10);
  }
  function ranges(person){
    const occupied=bodyMinutes+footMinutes+10,rangeStart=Math.ceil(effectiveStart),points=new Set([rangeStart,1440]);const add=n=>{if(n>rangeStart&&n<1440)points.add(n);};
    for(const [a,b] of spans){add(Math.floor(a-occupied)+1);add(Math.ceil(b));}
    // All shift boundaries matter when an unassigned booking can move between therapists.
    for(const p of roster.people){add(core.minutes(p.from));add(Math.floor(core.minutes(p.to)-occupied)+1);}
    const sorted=[...points].sort((a,b)=>a-b),result=[];
    for(let i=0;i<sorted.length-1;i++){const from=sorted[i],to=sorted[i+1]-1;if(from<=to&&fits(person,from)){const last=result[result.length-1];if(last&&last.end+1===from)last.end=to;else result.push({start:from,end:to});}}
    return result.map(r=>({...r,maxMinutes:maximum(person,r.start)}));
  }
  const rows=people.map(person=>({staff:person.id,from:person.from,to:person.to,available:fits(person,effectiveStart),...(query.listRanges||staff?{ranges:ranges(person)}:{} )}));
  for(const row of rows)if(row.available)row.maxMinutes=maximum(people.find(p=>p.id===row.staff),effectiveStart);
  return {date,time:hh(start),bodyMinutes,footMinutes,rows};
}
function answer(document,query,clock){
  const result=inspect(document,query,clock),service=[result.bodyMinutes?'身體'+result.bodyMinutes+'分鐘':'',result.footMinutes?'腳底'+result.footMinutes+'分鐘':''].filter(Boolean).join('＋');
  const header=result.date+' '+result.time+' 起｜'+service+'＋整理10分鐘'+(query.defaultService?'（未指定療程，先查最低20分鐘）':'');
  const tail='\n依目前雲端班表、工作及待確認／已確認預約計算；查詢不會保留時段，送出預約時會再檢查。';
  if(!query.staff){const available=result.rows.filter(r=>r.available);return header+'\n'+(available.length?'可工作按摩師：\n'+available.map(r=>r.staff+'號（最多可容納'+r.maxMinutes+'分鐘按摩）').join('\n'):'目前沒有能完整安排這段療程的按摩師。')+tail;}
  const row=result.rows[0],status=row.available?'可以預約（該時間最多可容納'+row.maxMinutes+'分鐘按摩）':core.minutes(result.time)<core.minutes(row.from)?'這個時間尚未上班':core.minutes(result.time)>=core.minutes(row.to)?'這個時間已下班':'無法完整安排這段療程與整理時間，可能有預約／工作重疊或超出下班時間';
  const lines=row.ranges.map(r=>hh(r.start)+(r.start===r.end?'':'～'+hh(r.end))+' 可開始；'+hh(r.start)+'開始最多'+r.maxMinutes+'分鐘按摩');
  return header+'\n'+row.staff+'號：'+status+'\n可預約的開始時間範圍：\n'+(lines.length?lines.join('\n'):'沒有剩餘可預約時段。')+tail;
}
module.exports={taiwanClock,inspect,answer,hh};
