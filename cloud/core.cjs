'use strict';
const crypto=require('node:crypto');
class BookingError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status)=>{throw new BookingError(message,status);};
const clone=x=>JSON.parse(JSON.stringify(x));
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
const timeOK=x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x);
const minutes=x=>Number(x.slice(0,2))*60+Number(x.slice(3));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const idOK=x=>typeof x==='string'&&/^\d+$/.test(x)&&Number.isSafeInteger(Number(x))&&Number(x)>0;
const body=x=>x.bodyMinutes===undefined?x.units*10:x.bodyMinutes;
const foot=x=>x.footMinutes===undefined?0:x.footMinutes;
const duration=x=>body(x)+foot(x);
const serviceOK=x=>x&&Number.isSafeInteger(body(x))&&Number.isSafeInteger(foot(x))&&(body(x)===0||(body(x)>=20&&body(x)%10===0))&&(foot(x)===0||(foot(x)>=40&&(foot(x)-40)%15===0))&&duration(x)>0&&duration(x)<=1440;
function validate(state){
  if(!state||typeof state!=='object'||!state.rosters||Array.isArray(state.rosters)||typeof state.rosters!=='object'||!Array.isArray(state.bookings)||!Array.isArray(state.jobs))fail('資料格式不完整');
  if(state.bookings.length>20000||state.jobs.length>20000||Object.keys(state.rosters).length>4000)fail('資料量超過本版限制，請先匯出清理舊資料');
  for(const [date,r] of Object.entries(state.rosters)){
    if(!dateOK(date)||!r||typeof r.confirmed!=='boolean'||!Array.isArray(r.people)||r.people.length>50)fail('班表格式錯誤');
    const ids=new Set();for(const p of r.people){if(!p||!idOK(p.id)||!timeOK(p.from)||!timeOK(p.to)||p.from>=p.to||ids.has(p.id))fail('師傅班表格式錯誤');ids.add(p.id);}
  }
  const ids=new Set();for(const b of state.bookings){
    if(!b||typeof b.id!=='string'||b.id.length>100||ids.has(b.id)||!dateOK(b.date)||!timeOK(b.time)||!['pending','confirmed','cancelled'].includes(b.status)||typeof b.note!=='string'||b.note.length>2000||!Array.isArray(b.guests)||b.guests.length<1||b.guests.length>20)fail('預約格式錯誤');
    ids.add(b.id);const staff=new Set();for(const g of b.guests){if(!serviceOK(g)||(g.staff!==''&&!idOK(g.staff)))fail('客人服務格式錯誤');if(g.staff&&staff.has(g.staff))fail('同一筆預約不能重複指定同位師傅');if(g.staff)staff.add(g.staff);}
  }
  const jobIDs=new Set();for(const j of state.jobs){if(!j||typeof j.id!=='string'||jobIDs.has(j.id)||!dateOK(j.date)||!idOK(j.staff)||!Number.isFinite(j.start)||j.start<0||j.start>=1440||!serviceOK(j))fail('工作紀錄格式錯誤');jobIDs.add(j.id);}
  return state;
}
function feasible(state,date){
  const roster=state.rosters[date];
  const tasks=[];
  for(const b of state.bookings)if(b.date===date&&b.status==='confirmed')for(const g of b.guests)tasks.push({start:minutes(b.time),end:minutes(b.time)+duration(g)+10,staff:g.staff});
  for(const j of state.jobs)if(j.date===date)tasks.push({start:j.start,end:j.start+duration(j)+10,staff:j.staff});
  if(!tasks.length)return true;
  if(!roster)fail('預約或工作缺少當日班表',409);
  const list=tasks.map(t=>({...t,candidates:roster.people.filter(p=>(!t.staff||p.id===t.staff)&&minutes(p.from)<=t.start&&minutes(p.to)>=t.end).map(p=>p.id)})).sort((a,b)=>a.candidates.length-b.candidates.length||a.start-b.start);
  if(list.some(t=>!t.candidates.length))fail('指定師傅未排班或時段超出上下班時間',409);
  const assigned=new Map();let visited=0;
  function solve(index){if(++visited>100000)fail('排班檢查過於複雜，請指定師傅後重試',409);if(index===list.length)return true;const t=list[index];for(const staff of t.candidates){const spans=assigned.get(staff)||[];if(spans.every(s=>t.end<=s.start||s.end<=t.start)){assigned.set(staff,[...spans,t]);if(solve(index+1))return true;assigned.set(staff,spans);}}return false;}
  if(!solve(0))fail('時段衝突或人力不足，包含服務後10分鐘整理',409);return true;
}
function validateSchedule(state){validate(state);const dates=new Set([...state.bookings.filter(b=>b.status==='confirmed').map(b=>b.date),...state.jobs.map(j=>j.date)]);for(const date of dates)feasible(state,date);return state;}
function saveBooking(state,input,existingId){
  const next=clone(state);const index=existingId?next.bookings.findIndex(b=>b.id===existingId):-1;
  if(existingId&&index<0)fail('找不到預約',404);
  const old=index>=0?next.bookings[index]:null;
  const booking={id:old?.id||'B-'+crypto.randomUUID().slice(0,8).toUpperCase(),date:input.date??old?.date,time:input.time??old?.time,guests:input.guests??old?.guests,note:input.note??old?.note??'',status:input.status??old?.status??'pending',customerName:input.customerName??old?.customerName??'',customerPhone:input.customerPhone??old?.customerPhone??''};
  if(typeof booking.customerName!=='string'||booking.customerName.length>100||typeof booking.customerPhone!=='string'||booking.customerPhone.length>40)fail('客人姓名或電話格式錯誤');
  if(booking.date<today()&&!existingId)fail('不能新增過去日期的預約');
  if(booking.status==='confirmed'&&!next.rosters[booking.date]?.confirmed)fail('請先確認當日班表，再確認預約',409);
  if(index>=0)next.bookings[index]=booking;else next.bookings.push(booking);
  validateSchedule(next);return {state:next,booking};
}
function cancelBooking(state,id){return saveBooking(state,{status:'cancelled'},id);}
function previewPurge(state,before){
  if(!dateOK(before)||before>=today())fail('只能清理今日以前的紀錄');
  const bookings=state.bookings.filter(b=>b.date<before&&['confirmed','cancelled'].includes(b.status));
  const remainingDates=new Set(state.bookings.filter(b=>!bookings.includes(b)).map(b=>b.date));
  const jobs=state.jobs.filter(j=>j.date<before&&!remainingDates.has(j.date));
  return {before,bookingIds:bookings.map(b=>b.id),jobIds:jobs.map(j=>j.id)};
}
function purge(state,preview){const next=clone(state),bookings=new Set(preview.bookingIds),jobs=new Set(preview.jobIds);next.bookings=next.bookings.filter(b=>!bookings.has(b.id));next.jobs=next.jobs.filter(j=>!jobs.has(j.id));const used=new Set([...next.bookings.map(b=>b.date),...next.jobs.map(j=>j.date)]);for(const d of Object.keys(next.rosters))if(d<preview.before&&!used.has(d))delete next.rosters[d];return validateSchedule(next);}
function bookingText(b){return `${b.id}｜${b.date} ${b.time}｜${b.guests.length}人｜${b.status==='confirmed'?'已確認':b.status==='cancelled'?'已取消':'待確認'}\n`+b.guests.map((g,i)=>`${i+1}. ${g.staff?g.staff+'號':'不指定'}｜身體${body(g)}分鐘／腳底${foot(g)}分鐘`).join('\n')+(b.customerName?'\n客人：'+b.customerName:'')+(b.note?'\n備註：'+b.note:'');}
module.exports={BookingError,fail,clone,dateOK,timeOK,today,minutes,body,foot,duration,validate,feasible,validateSchedule,saveBooking,cancelBooking,previewPurge,purge,bookingText};

