const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let pgPool = null;
let usePostgres = false;

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'server-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BUSINESS_FILE = path.join(DATA_DIR, 'business-data.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const PERMISSION_GROUPS={
  Dashboard:['dashboard.view'],
  'My Daily Report':['userReport.view','userReport.print'],
  Sales:['sales.view','sales.create','sales.edit','sales.cancel','sales.print','sales.discount','sales.changePrice','sales.changePayment'],
  Purchases:['purchases.view','purchases.create','purchases.edit','purchases.cancel','purchases.print','purchases.changeCost'],
  Returns:['returns.view','returns.customerCreate','returns.customerCancel','returns.supplierCreate','returns.supplierCancel','returns.edit','returns.print'],
  Stock:['stock.view','stock.add','stock.edit','stock.delete','stock.adjust','stock.count','stock.export'],
  Customers:['customers.view','customers.create','customers.edit','customers.delete','customers.paymentReceive','customers.paymentEdit','customers.paymentDelete','customers.statement'],
  Suppliers:['suppliers.view','suppliers.create','suppliers.edit','suppliers.delete','suppliers.payment','suppliers.paymentEdit','suppliers.paymentDelete'],
  CashAccounts:['accounts.view','accounts.create','accounts.edit','accounts.delete','accounts.adjust','accounts.transfer'],
  Repairs:['repairs.view','repairs.create','repairs.edit','repairs.delete'],
  Expenses:['expenses.view','expenses.create','expenses.edit','expenses.delete'],
  Reports:['reports.view','reports.export','reports.print'],
  Settings:['settings.view','settings.edit','settings.receipt'],
  Users:['users.view','users.create','users.edit','users.delete','users.permissions'],
  Activity:['activity.view','activity.export','activity.clear'],
  Backup:['backup.view','backup.export','backup.import','backup.sync']
};
const PERM_KEYS=Object.values(PERMISSION_GROUPS).flat();
const ROLE_PERMS={
 Administrator:Object.fromEntries(PERM_KEYS.map(k=>[k,true])),
 Cashier:Object.fromEntries(PERM_KEYS.map(k=>[k,['dashboard.view','userReport.view','userReport.print','sales.view','sales.create','sales.print','sales.discount','customers.view','customers.create','customers.statement','customers.paymentReceive','returns.view','returns.customerCreate','returns.supplierCreate','reports.view'].includes(k)])),
 'Stock Manager':Object.fromEntries(PERM_KEYS.map(k=>[k,['dashboard.view','userReport.view','userReport.print','stock.view','stock.add','stock.edit','stock.adjust','stock.count','stock.export','purchases.view','purchases.create','purchases.edit','purchases.print','purchases.changeCost','suppliers.view','suppliers.create','returns.view','returns.supplierCreate','reports.view','reports.export'].includes(k)])),
 'Repair Staff':Object.fromEntries(PERM_KEYS.map(k=>[k,['dashboard.view','userReport.view','userReport.print','repairs.view','repairs.create','repairs.edit','customers.view','customers.create'].includes(k)]))
};
function normalizePermissions(perms){if(perms?.all)return Object.fromEntries(PERM_KEYS.map(k=>[k,true]));return Object.fromEntries(PERM_KEYS.map(k=>[k,!!perms?.[k]]));}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  const hash = crypto.scryptSync(String(password), record.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(record.hash, 'hex'));
}
function publicUser(u) {
  return { id:u.id, name:u.name, username:u.username, role:u.role, permissions:u.permissions };
}
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const hp = hashPassword('admin');
    const admin = {id:'U-admin',name:'Admin',username:'admin',role:'Administrator',permissions:ROLE_PERMS.Administrator,password:hp};
    fs.writeFileSync(USERS_FILE, JSON.stringify([admin], null, 2));
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
let users = loadUsers().map(u=>({...u,permissions:normalizePermissions(u.role==='Administrator'?ROLE_PERMS.Administrator:(u.permissions||ROLE_PERMS[u.role||'Cashier']))}));
const sessions = new Map();

async function initPersistentStorage(){
  if(!process.env.DATABASE_URL) return;
  try{
    const {Pool}=require('pg');
    pgPool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
    await pgPool.query(`CREATE TABLE IF NOT EXISTS ruhi_business_data (id INTEGER PRIMARY KEY, revision BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL, data JSONB NOT NULL)`);
    const existing=await pgPool.query('SELECT id FROM ruhi_business_data WHERE id=1');
    if(existing.rowCount===0 && fs.existsSync(BUSINESS_FILE)){
      try{
        const x=JSON.parse(fs.readFileSync(BUSINESS_FILE,'utf8'));
        if(x && x.data) await pgPool.query('INSERT INTO ruhi_business_data(id,revision,updated_at,data) VALUES(1,$1,$2,$3)',[Number(x.revision||0),x.updatedAt?new Date(x.updatedAt):new Date(),x.data]);
      }catch(e){ console.warn('Could not migrate business-data.json:',e.message); }
    }
    usePostgres=true;
    console.log('Persistent storage: PostgreSQL');
  }catch(e){
    console.error('DATABASE_URL was provided but PostgreSQL could not be initialized:',e.message);
    console.log('Falling back to local JSON storage. On Railway this is NOT persistent without a volume.');
    try{if(pgPool)await pgPool.end()}catch(_){}; pgPool=null; usePostgres=false;
  }
}

function loadBusiness(){
  if(!fs.existsSync(BUSINESS_FILE)) return {revision:0,data:null};
  try{const x=JSON.parse(fs.readFileSync(BUSINESS_FILE,'utf8'));return {revision:Number(x.revision||0),data:x.data||null};}
  catch(e){return {revision:0,data:null};}
}
function saveBusiness(data, revision){
  const clean=JSON.parse(JSON.stringify(data||{}));
  delete clean.users; delete clean.syncQueue; delete clean.syncMeta;
  const next={revision:Number(revision||0)+1,updatedAt:new Date().toISOString(),data:clean};
  const tmp=BUSINESS_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(next,null,2));
  fs.renameSync(tmp,BUSINESS_FILE);
  return next.revision;
}

async function getBusiness(){
  if(usePostgres){
    const r=await pgPool.query('SELECT revision,updated_at,data FROM ruhi_business_data WHERE id=1');
    if(!r.rowCount)return {revision:0,data:null};
    return {revision:Number(r.rows[0].revision||0),data:r.rows[0].data||null,updatedAt:r.rows[0].updated_at};
  }
  return loadBusiness();
}
async function saveBusinessPersistent(data, incomingRevision){
  if(!usePostgres) return {ok:true,revision:saveBusiness(data,incomingRevision)};
  const client=await pgPool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT revision,data FROM ruhi_business_data WHERE id=1 FOR UPDATE');
    const currentRevision=r.rowCount?Number(r.rows[0].revision||0):0;
    const currentData=r.rowCount?(r.rows[0].data||null):null;
    if(currentData && Number(incomingRevision||0)!==currentRevision){
      await client.query('ROLLBACK');
      return {ok:false,conflict:true,revision:currentRevision,data:currentData};
    }
    const clean=JSON.parse(JSON.stringify(data||{}));
    delete clean.users; delete clean.syncQueue; delete clean.syncMeta;
    const nextRevision=currentRevision+1;
    await client.query(`INSERT INTO ruhi_business_data(id,revision,updated_at,data) VALUES(1,$1,NOW(),$2) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,data=EXCLUDED.data`,[nextRevision,clean]);
    await client.query('COMMIT');
    return {ok:true,revision:nextRevision};
  }catch(e){
    try{await client.query('ROLLBACK')}catch(_){}
    throw e;
  }finally{client.release();}
}

function send(res, code, body, headers={}) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(payload);
}
function readBody(req) { return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy();});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)}); }
function tokenFrom(req) { const h=req.headers.authorization||''; return h.startsWith('Bearer ')?h.slice(7):null; }
function auth(req,res) {
  const token=tokenFrom(req), session=token&&sessions.get(token);
  if(!session) { send(res,401,{error:'Authentication required'}); return null; }
  const u=users.find(x=>x.id===session.userId);
  if(!u) { sessions.delete(token); send(res,401,{error:'Session is no longer valid'}); return null; }
  return {token,user:u};
}
function hasPermission(u,p) { return u.role==='Administrator' || !!u.permissions?.all || !!u.permissions?.[p]; }
function audit(user, action, details='') { fs.appendFileSync(path.join(DATA_DIR,'audit.log'), JSON.stringify({date:new Date().toISOString(),user:user?.name||'System',action,details})+'\n'); }

async function api(req,res) {
  try {
    if(req.method==='POST' && req.url==='/api/login') {
      const b=await readBody(req); const username=String(b.username||'').trim().toLowerCase(); const password=String(b.password||'');
      const u=users.find(x=>x.username.toLowerCase()===username);
      if(!u || !verifyPassword(password,u.password)) return send(res,401,{error:'Incorrect username or password.'});
      const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{userId:u.id,created:Date.now()}); audit(u,'User login');
      return send(res,200,{token,user:publicUser(u)});
    }
    if(req.method==='POST' && req.url==='/api/logout') {
      const a=auth(req,res); if(!a)return; sessions.delete(a.token); audit(a.user,'User logout'); return send(res,200,{ok:true});
    }
    if(req.method==='GET' && req.url==='/api/me') {
      const a=auth(req,res); if(!a)return; return send(res,200,{user:publicUser(a.user)});
    }
    if(req.url==='/api/data' && req.method==='GET') {
      const a=auth(req,res); if(!a)return;
      const b=await getBusiness();
      return send(res,200,{exists:!!b.data,revision:b.revision,data:b.data});
    }
    if(req.url==='/api/data' && req.method==='POST') {
      const a=auth(req,res); if(!a)return;
      const b=await readBody(req);
      const incomingRevision=Number(b.revision||0);
      const result=await saveBusinessPersistent(b.data||{},incomingRevision);
      if(result.conflict) return send(res,409,{error:'Business data changed on another device.',revision:result.revision,data:result.data});
      audit(a.user,'Business data synced',String(result.revision));
      return send(res,200,{ok:true,revision:result.revision});
    }
    if(req.url==='/api/users' && req.method==='GET') {
      const a=auth(req,res); if(!a || !hasPermission(a.user,'users.view')) return a?send(res,403,{error:'Permission denied'}):undefined;
      return send(res,200,{users:users.map(publicUser)});
    }
    if(req.url==='/api/users' && req.method==='POST') {
      const a=auth(req,res); if(!a)return; if(!hasPermission(a.user,'users.create')) return send(res,403,{error:'Permission denied'});
      const b=await readBody(req); const name=String(b.name||'').trim(); const username=String(b.username||'').trim().toLowerCase(); const password=String(b.password||''); const role=String(b.role||'Cashier');
      if(!name||!username||!password)return send(res,400,{error:'Name, username and password are required'});
      if(users.some(x=>x.username===username))return send(res,409,{error:'Username already exists'});
      const permissions=normalizePermissions(role==='Custom'?(b.permissions||{}):(ROLE_PERMS[role]||ROLE_PERMS.Cashier)); const hp=hashPassword(password);
      const u={id:'U-'+Date.now(),name,username,role,permissions,password:hp}; users.push(u); saveUsers(users); audit(a.user,'User created',name+' ('+username+')'); return send(res,201,{user:publicUser(u)});
    }
    const um=req.url.match(/^\/api\/users\/([^/]+)$/);
    if(um && req.method==='PUT') {
      const a=auth(req,res); if(!a)return; if(!hasPermission(a.user,'users.edit') && !hasPermission(a.user,'users.permissions'))return send(res,403,{error:'Permission denied'});
      const b=await readBody(req), u=users.find(x=>x.id===um[1]); if(!u)return send(res,404,{error:'User not found'});
      const changingPerms=b.permissions!=null; const changingProfile=b.name!=null||b.role!=null||!!b.password;
      if(changingPerms&&!hasPermission(a.user,'users.permissions'))return send(res,403,{error:'Permission denied: users.permissions'});
      if(changingProfile&&!hasPermission(a.user,'users.edit'))return send(res,403,{error:'Permission denied: users.edit'});
      if(b.name!=null)u.name=String(b.name).trim()||u.name;
      if(b.role!=null){u.role=String(b.role);u.permissions=normalizePermissions(u.role==='Custom'?(b.permissions||{}):(ROLE_PERMS[u.role]||ROLE_PERMS.Cashier));} else if(b.permissions!=null){u.permissions=normalizePermissions(b.permissions);}
      if(b.password){u.password=hashPassword(String(b.password)); for(const [token,session] of sessions){if(session.userId===u.id&&token!==a.token)sessions.delete(token);}}
      saveUsers(users); audit(a.user,'User edited',u.name); return send(res,200,{user:publicUser(u)});
    }
    if(um && req.method==='DELETE') {
      const a=auth(req,res); if(!a)return; if(!hasPermission(a.user,'users.delete'))return send(res,403,{error:'Permission denied'});
      if(um[1]==='U-admin')return send(res,400,{error:'Default administrator cannot be deleted'});
      if(um[1]===a.user.id)return send(res,400,{error:'Logout this user before deleting the account'});
      const idx=users.findIndex(x=>x.id===um[1]); if(idx<0)return send(res,404,{error:'User not found'}); const old=users[idx]; users.splice(idx,1); for(const [token,session] of sessions){if(session.userId===old.id)sessions.delete(token);} saveUsers(users); audit(a.user,'User deleted',old.name); return send(res,200,{ok:true});
    }
    return send(res,404,{error:'API route not found'});
  } catch(e) { console.error(e); return send(res,500,{error:'Server error'}); }
}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')) return api(req,res);
  let urlPath=decodeURIComponent(req.url.split('?')[0]); if(urlPath==='/')urlPath='/index.html';
  const file=path.normalize(path.join(ROOT,urlPath)); if(!file.startsWith(ROOT))return send(res,403,{error:'Forbidden'});
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data)});
});
(async()=>{ await initPersistentStorage(); server.listen(PORT,'0.0.0.0',()=>console.log(`Ruhi Mobile server running on port ${PORT}`)); })().catch(e=>{console.error('Startup failed:',e);process.exit(1)});
