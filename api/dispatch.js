const server=require('../cloud/server.cjs');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const origin=req.headers.origin;const allowed=(process.env.BOOKING_ALLOWED_ORIGINS||'https://x84615500.github.io').split(',');
  if(origin&&allowed.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
  if(req.method==='OPTIONS')return res.status(origin&&!allowed.includes(origin)?403:204).end();
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'不支援的請求方式'});
  if(origin&&!allowed.includes(origin))return res.status(403).json({error:'不允許的網站來源'});
  try{
    const s=server.settings();
    if(req.method==='GET'&&req.query?.config==='1')return res.status(200).json({url:s.url||'',publicKey:s.publicKey||'',enabled:Boolean(s.url&&s.key&&s.email)});
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');const actor=await server.owner(token);
    const body=req.method==='GET'?{action:'read'}:typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body||Buffer.byteLength(JSON.stringify(body))>1024*1024)return res.status(413).json({error:'資料過大'});
    return res.status(200).json(await server.operation(body,'web:'+actor));
  }catch(error){console.error('Dispatch API failed',Number.isInteger(error.status)?error.status:500);return res.status(error.status||500).json({error:error.status?error.message:'預約服務暫時無法使用，請稍後重試'});}
};

