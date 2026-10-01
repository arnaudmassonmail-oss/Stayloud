import crypto from "node:crypto";

function d1Config(){
  const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const databaseId=String(process.env.CLOUDFLARE_D1_DATABASE_ID || "").trim();
  const apiToken=String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return {accountId,databaseId,apiToken};
}

export function d1ConfigStatus(){
  const {accountId,databaseId,apiToken}=d1Config();
  return {
    configured:Boolean(accountId && databaseId && apiToken),
    accountId:accountId?"OK":"MISSING",
    databaseId:databaseId?"OK":"MISSING",
    apiToken:apiToken?"OK":"MISSING",
    accountIdLength:accountId.length,
    databaseIdLength:databaseId.length,
    apiTokenLength:apiToken.length
  };
}

export const d1Enabled = d1ConfigStatus().configured;

function d1Endpoint(){
  const {accountId,databaseId}=d1Config();
  return accountId && databaseId
    ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`
    : "";
}

let schemaPromise = null;

function hashToken(token){ return crypto.createHash("sha256").update(token).digest("hex"); }
function normalizeEmail(email){ return String(email || "").trim().toLowerCase(); }
function now(){ return new Date().toISOString(); }
function hashPassword(password,salt){ return crypto.scryptSync(String(password ?? ""),salt,64).toString("hex"); }
function publicUser(row){
  if(!row) return null;
  return {id:Number(row.id),username:row.username,email:row.email||null,created_at:row.created_at};
}
function checkPassword(row,password){
  if(!row)return false;
  const got=Buffer.from(hashPassword(String(password ?? ""),row.password_salt),"hex");
  const expected=Buffer.from(String(row.password_hash||""),"hex");
  return expected.length===got.length && crypto.timingSafeEqual(got,expected);
}

async function query(sql, params=[]){
  const {apiToken}=d1Config();
  if(!d1ConfigStatus().configured) throw new Error("D1 non configuré");
  const endpoint=d1Endpoint();
  const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),15000);
  let r;
  try{
    r=await fetch(endpoint,{
      method:"POST",
      headers:{"Authorization":`Bearer ${apiToken}`,"Content-Type":"application/json"},
      body:JSON.stringify({sql,params}),signal:ac.signal
    });
  }finally{clearTimeout(timer)}
  const data=await r.json().catch(()=>({}));
  if(!r.ok || data?.success===false || data?.errors?.length){
    const msg=data?.errors?.map(x=>x.message).join("; ") || `Cloudflare D1 HTTP ${r.status}`;
    throw new Error(msg);
  }
  const result=Array.isArray(data?.result)?data.result[0]:null;
  if(result?.success===false) throw new Error(result?.error||"Erreur D1");
  return {rows:Array.isArray(result?.results)?result.results:[],meta:result?.meta||{}};
}

export async function ensureD1Schema(){
  if(!d1ConfigStatus().configured)return false;
  if(!schemaPromise){
    const statements=[
      `CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions(
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_d1_sessions_user ON sessions(user_id)`,
      `CREATE TABLE IF NOT EXISTS password_resets(
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_d1_resets_user ON password_resets(user_id)`,
      `CREATE TABLE IF NOT EXISTS groups(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sync_key TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        mbid TEXT,
        style TEXT,
        disambiguation TEXT,
        country TEXT,
        photo_url TEXT,
        bandsintown_url TEXT,
        infoconcert_url TEXT,
        identity_source TEXT,
        identity_key TEXT,
        identity_locked INTEGER DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id,sync_key)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_d1_groups_user ON groups(user_id)`
    ];
    schemaPromise=(async()=>{
      for(const sql of statements) await query(sql);
      return true;
    })().catch(e=>{schemaPromise=null;throw e});
  }
  return schemaPromise;
}

export async function d1CreateUser(username,email,password){
  await ensureD1Schema();
  const u=String(username||"").trim(), e=normalizeEmail(email);
  if(!/^[A-Za-z0-9_.-]{3,32}$/.test(u)) throw new Error("Nom d'utilisateur invalide (3 à 32 caractères)");
  if(!/^\S+@\S+\.\S+$/.test(e)) throw new Error("Adresse e-mail invalide");
  if(String(password||"").length<6) throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  const salt=crypto.randomBytes(16).toString("hex"), t=now();
  const q=await query(
    "INSERT INTO users(username,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    [u,e,hashPassword(password,salt),salt,t,t]
  );
  return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE id=?",[q.meta.last_row_id])).rows[0]);
}

export async function d1AuthenticateUser(login,password){
  await ensureD1Schema();
  const l=String(login||"").trim();
  if(!l)return null;
  const rows=(await query(
    "SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE LIMIT 1",
    [l,normalizeEmail(l)]
  )).rows;
  const u=rows[0];
  if(!u || !checkPassword(u,password))return null;
  return publicUser(u);
}

export async function d1FindUserByEmail(email){
  await ensureD1Schema();
  return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE email=? COLLATE NOCASE",[normalizeEmail(email)])).rows[0]);
}

export async function d1UpdateUserEmail(userId,email){
  await ensureD1Schema();
  const e=normalizeEmail(email);
  if(!/^\S+@\S+\.\S+$/.test(e))throw new Error("Adresse e-mail invalide");
  await query("UPDATE users SET email=?,updated_at=? WHERE id=?",[e,now(),Number(userId)]);
  return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE id=?",[Number(userId)])).rows[0]);
}

export async function d1CreateSession(userId){
  await ensureD1Schema();
  const token=crypto.randomBytes(32).toString("base64url"),t=now(),expires=new Date(Date.now()+1000*60*60*24*30).toISOString();
  await query("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",[hashToken(token),Number(userId),t,expires]);
  return {token,expiresAt:expires};
}

export async function d1GetSession(token){
  if(!token)return null;
  await ensureD1Schema();
  const h=hashToken(token), rows=(await query(
    "SELECT u.id,u.username,u.email,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    [h,now()]
  )).rows;
  const u=rows[0];
  if(!u)return null;
  const expires=new Date(Date.now()+1000*60*60*24*30).toISOString();
  await query("UPDATE sessions SET expires_at=? WHERE token_hash=?",[expires,h]);
  return publicUser(u);
}

export async function d1DeleteSession(token){
  if(!token)return;
  await ensureD1Schema();
  await query("DELETE FROM sessions WHERE token_hash=?",[hashToken(token)]);
}

export async function d1CreatePasswordReset(userId){
  await ensureD1Schema();
  const token=crypto.randomBytes(32).toString("base64url"),t=now(),expires=new Date(Date.now()+1000*60*30).toISOString();
  await query("DELETE FROM password_resets WHERE user_id=? OR expires_at<=?",[Number(userId),t]);
  await query("INSERT INTO password_resets(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",[hashToken(token),Number(userId),t,expires]);
  return {token,expiresAt:expires};
}

export async function d1ConsumePasswordReset(token,newPassword){
  await ensureD1Schema();
  if(String(newPassword||"").length<6)throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  const h=hashToken(token), row=(await query("SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?",[h,now()])).rows[0];
  if(!row)throw new Error("Lien de réinitialisation invalide ou expiré");
  const salt=crypto.randomBytes(16).toString("hex"), t=now();
  await query("UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?",[hashPassword(newPassword,salt),salt,t,row.user_id]);
  await query("UPDATE password_resets SET used_at=? WHERE token_hash=?",[t,h]);
  await query("DELETE FROM sessions WHERE user_id=?",[row.user_id]);
  return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE id=?",[row.user_id])).rows[0]);
}

function syncKey(a){
  return String(a?.identity_key||"").trim()
    || (String(a?.mbid||"").trim()?`mbid:${String(a.mbid).trim()}`:"")
    || `name:${String(a?.normalized_name||a?.name||"").trim().toLowerCase()}`;
}

export async function d1UpsertGroup(userId,artist){
  await ensureD1Schema();
  const key=syncKey(artist),t=now();
  await query(`
    INSERT INTO groups(user_id,sync_key,name,normalized_name,mbid,style,disambiguation,country,photo_url,bandsintown_url,infoconcert_url,identity_source,identity_key,identity_locked,description,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,sync_key) DO UPDATE SET
      name=excluded.name,normalized_name=excluded.normalized_name,mbid=excluded.mbid,style=excluded.style,
      disambiguation=excluded.disambiguation,country=excluded.country,photo_url=excluded.photo_url,
      bandsintown_url=excluded.bandsintown_url,infoconcert_url=excluded.infoconcert_url,
      identity_source=excluded.identity_source,identity_key=excluded.identity_key,
      identity_locked=excluded.identity_locked,description=excluded.description,updated_at=excluded.updated_at
  `,[
    Number(userId),key,String(artist.name||""),String(artist.normalized_name||""),
    artist.mbid||null,artist.style||null,artist.disambiguation||null,artist.country||null,artist.photo_url||null,
    artist.bandsintown_url||null,artist.infoconcert_url||null,artist.identity_source||null,artist.identity_key||null,
    artist.identity_locked?1:0,artist.description||null,artist.created_at||t,t
  ]);
}

export async function d1DeleteGroup(userId,artist){
  await ensureD1Schema();
  await query("DELETE FROM groups WHERE user_id=? AND sync_key=?",[Number(userId),syncKey(artist)]);
}

export async function d1ListGroups(userId){
  await ensureD1Schema();
  return (await query("SELECT * FROM groups WHERE user_id=? ORDER BY name COLLATE NOCASE",[Number(userId)])).rows;
}

export async function d1MigrateLocalUser(user){
  await ensureD1Schema();
  const existing=(await query("SELECT id,username,email,password_hash,password_salt,created_at FROM users WHERE id=?",[Number(user.id)])).rows[0];
  if(existing)return publicUser(existing);
  const byEmail=(await query("SELECT id FROM users WHERE email=? COLLATE NOCASE",[normalizeEmail(user.email)])).rows[0];
  if(byEmail) return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE id=?",[byEmail.id])).rows[0]);
  const t=now();
  await query(
    "INSERT INTO users(id,username,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    [Number(user.id),user.username,normalizeEmail(user.email),user.password_hash,user.password_salt,user.created_at||t,user.updated_at||t]
  );
  return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE id=?",[Number(user.id)])).rows[0]);
}
