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
      `CREATE INDEX IF NOT EXISTS idx_d1_groups_user ON groups(user_id)`,
      // Durable copy of each band's news (6 months) and upcoming concerts, so
      // a restarted server can show them instantly instead of re-collecting.
      `CREATE TABLE IF NOT EXISTS band_cache(
        band_key TEXT PRIMARY KEY,
        news_json TEXT,
        news_at TEXT,
        events_json TEXT,
        events_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS geo_cache(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)`,
      // Concerts a user marked "J'y vais" (going) or "Intéressé" (interested).
      `CREATE TABLE IF NOT EXISTS user_concerts(user_id INTEGER NOT NULL,ckey TEXT NOT NULL,status TEXT NOT NULL,data TEXT,updated_at TEXT,PRIMARY KEY(user_id,ckey))`,
      // Friends: one row per request (requester -> addressee); status
      // 'pending' until the addressee accepts, then 'accepted'.
      `CREATE TABLE IF NOT EXISTS friendships(requester_id INTEGER NOT NULL,addressee_id INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT,updated_at TEXT,PRIMARY KEY(requester_id,addressee_id))`,
      // When the user last closed the "Quoi de neuf chez tes amis" popup.
      `CREATE TABLE IF NOT EXISTS user_seen(user_id INTEGER PRIMARY KEY,friends_seen_at TEXT)`,
      // A band a user recommends to a friend ("Partager à un ami").
      `CREATE TABLE IF NOT EXISTS band_shares(id INTEGER PRIMARY KEY AUTOINCREMENT,from_id INTEGER NOT NULL,to_id INTEGER NOT NULL,artist_json TEXT NOT NULL,message TEXT,created_at TEXT)`
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

// Login lasts 24 h, then name + password are asked again.
const SESSION_MS=1000*60*60*24;

export async function d1CreateSession(userId){
  await ensureD1Schema();
  const token=crypto.randomBytes(32).toString("base64url"),t=now(),expires=new Date(Date.now()+SESSION_MS).toISOString();
  await query("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",[hashToken(token),Number(userId),t,expires]);
  return {token,expiresAt:expires};
}

export async function d1GetSession(token){
  if(!token)return null;
  await ensureD1Schema();
  const h=hashToken(token), rows=(await query(
    "SELECT u.id,u.username,u.email,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.created_at>?",
    [h,now(),new Date(Date.now()-SESSION_MS).toISOString()]
  )).rows;
  const u=rows[0];
  if(!u)return null;
  // Sessions are fixed 24 h from login (no rolling extension): the user
  // signs in again once a day.
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
  const key=syncKey(artist),t=now(),uid=Number(userId);
  const identityKey=String(artist?.identity_key||"").trim();
  const mbid=String(artist?.mbid||"").trim();
  const normalizedName=String(artist?.normalized_name||artist?.name||"").trim().toLowerCase();
  let existing=(await query(`SELECT id,sync_key FROM groups WHERE user_id=? AND (sync_key=? OR (identity_key<>'' AND identity_key=?) OR (mbid<>'' AND mbid=?) OR (mbid='' AND identity_key='' AND normalized_name=?)) ORDER BY CASE WHEN sync_key=? THEN 0 ELSE 1 END,id LIMIT 1`,[uid,key,identityKey,mbid,normalizedName,key])).rows[0];
  // Legacy fallback: groups added from “À découvrir” in older builds could have
  // only the artist name in D1. If exactly one group has this normalized name,
  // reuse it so its identity can be upgraded without creating a duplicate.
  if(!existing && normalizedName){
    const sameName=(await query(`SELECT id,sync_key FROM groups WHERE user_id=? AND normalized_name=? ORDER BY id`,[uid,normalizedName])).rows;
    if(sameName.length===1) existing=sameName[0];
  }
  const values=[uid,key,String(artist.name||""),String(artist.normalized_name||""),artist.mbid||null,artist.style||null,artist.disambiguation||null,artist.country||null,artist.photo_url||null,artist.bandsintown_url||null,artist.infoconcert_url||null,artist.identity_source||null,artist.identity_key||null,artist.identity_locked?1:0,artist.description||null,artist.created_at||t,t];
  // UPDATE takes name…description + updated_at (never created_at): passing
  // created_at too made D1 reject the query ("Too many parameter values").
  const upd=[...values.slice(2,15),t];
  if(existing){
    if(existing.sync_key!==key){
      await query("DELETE FROM groups WHERE user_id=? AND sync_key=? AND id<>?",[uid,key,existing.id]);
      await query(`UPDATE groups SET sync_key=?,name=?,normalized_name=?,mbid=?,style=?,disambiguation=?,country=?,photo_url=?,bandsintown_url=?,infoconcert_url=?,identity_source=?,identity_key=?,identity_locked=?,description=?,updated_at=? WHERE id=?`,[key,...upd,existing.id]);
    }else{
      await query(`UPDATE groups SET name=?,normalized_name=?,mbid=?,style=?,disambiguation=?,country=?,photo_url=?,bandsintown_url=?,infoconcert_url=?,identity_source=?,identity_key=?,identity_locked=?,description=?,updated_at=? WHERE id=?`,[...upd,existing.id]);
    }
    return;
  }
  await query(`INSERT INTO groups(user_id,sync_key,name,normalized_name,mbid,style,disambiguation,country,photo_url,bandsintown_url,infoconcert_url,identity_source,identity_key,identity_locked,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,values);
}

export async function d1DeleteGroup(userId,artist){
  await ensureD1Schema();
  const uid=Number(userId),key=syncKey(artist),identityKey=String(artist?.identity_key||"").trim(),mbid=String(artist?.mbid||"").trim(),normalizedName=String(artist?.normalized_name||artist?.name||"").trim().toLowerCase();
  await query("DELETE FROM groups WHERE user_id=? AND (sync_key=? OR (identity_key<>'' AND identity_key=?) OR (mbid<>'' AND mbid=?) OR (mbid='' AND identity_key='' AND normalized_name=?))",[uid,key,identityKey,mbid,normalizedName]);
  // Legacy fallback for an older discovery entry whose identity key changed: if
  // there is exactly one remaining row with this normalized name, remove it too.
  if(normalizedName){
    const sameName=(await query(`SELECT id FROM groups WHERE user_id=? AND normalized_name=?`,[uid,normalizedName])).rows;
    if(sameName.length===1) await query(`DELETE FROM groups WHERE user_id=? AND id=?`,[uid,sameName[0].id]);
  }
}

export async function d1GetBandCache(keys){
  const list=[...new Set((keys||[]).filter(Boolean))];const out=new Map();
  if(!list.length||!d1ConfigStatus().configured)return out;
  await ensureD1Schema();
  for(let i=0;i<list.length;i+=80){
    const part=list.slice(i,i+80);
    const rows=(await query(`SELECT band_key,news_json,news_at,events_json,events_at FROM band_cache WHERE band_key IN (${part.map(()=>'?').join(',')})`,part)).rows;
    for(const r of rows)out.set(r.band_key,r);
  }
  return out;
}
export async function d1LoadGeoCache(){
  if(!d1ConfigStatus().configured)return [];
  await ensureD1Schema();
  return (await query("SELECT key,value FROM geo_cache")).rows;
}
export async function d1PutGeoBatch(entries){
  if(!entries?.length||!d1ConfigStatus().configured)return;
  await ensureD1Schema();const t=now();
  for(let i=0;i<entries.length;i+=30){
    const part=entries.slice(i,i+30);
    await query(`INSERT INTO geo_cache(key,value,updated_at) VALUES ${part.map(()=>'(?,?,?)').join(',')} ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,part.flatMap(([k,v])=>[k,JSON.stringify(v),t]));
  }
}
export async function d1PutBandNews(key,rows){
  if(!key||!d1ConfigStatus().configured)return;
  await ensureD1Schema();
  await query(`INSERT INTO band_cache(band_key,news_json,news_at) VALUES(?,?,?) ON CONFLICT(band_key) DO UPDATE SET news_json=excluded.news_json,news_at=excluded.news_at`,[key,JSON.stringify(rows||[]),now()]);
}
export async function d1PutBandEvents(key,rows){
  if(!key||!d1ConfigStatus().configured)return;
  await ensureD1Schema();
  await query(`INSERT INTO band_cache(band_key,events_json,events_at) VALUES(?,?,?) ON CONFLICT(band_key) DO UPDATE SET events_json=excluded.events_json,events_at=excluded.events_at`,[key,JSON.stringify(rows||[]),now()]);
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

export async function d1ListUserConcerts(userId){
  if(!d1ConfigStatus().configured)return [];
  await ensureD1Schema();
  return (await query("SELECT ckey,status,data,updated_at FROM user_concerts WHERE user_id=?",[Number(userId)])).rows;
}
export async function d1SetUserConcert(userId,ckey,status,data){
  if(!d1ConfigStatus().configured)return;
  await ensureD1Schema();
  await query("INSERT INTO user_concerts(user_id,ckey,status,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,ckey) DO UPDATE SET status=excluded.status,data=excluded.data,updated_at=excluded.updated_at",[Number(userId),String(ckey),String(status),JSON.stringify(data||{}),now()]);
}
export async function d1DeleteUserConcert(userId,ckey){
  if(!d1ConfigStatus().configured)return;
  await ensureD1Schema();
  await query("DELETE FROM user_concerts WHERE user_id=? AND ckey=?",[Number(userId),String(ckey)]);
}

// ---- Friends ----
export async function d1FindUserByUsername(username){
  await ensureD1Schema();
  return publicUser((await query("SELECT id,username,email,created_at FROM users WHERE username=? COLLATE NOCASE LIMIT 1",[String(username||"").trim()])).rows[0]);
}
export async function d1ListFriendships(userId){
  await ensureD1Schema();
  const id=Number(userId);
  return (await query(
    "SELECT f.requester_id,f.addressee_id,f.status,f.created_at,u.id AS other_id,u.username AS other_name FROM friendships f JOIN users u ON u.id=(CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END) WHERE f.requester_id=? OR f.addressee_id=?",
    [id,id,id]
  )).rows;
}
export async function d1RequestFriend(userId,otherId){
  await ensureD1Schema();
  const a=Number(userId),b=Number(otherId),t=now();
  const back=(await query("SELECT status FROM friendships WHERE requester_id=? AND addressee_id=?",[b,a])).rows[0];
  // The other person already asked: adding them back accepts the request.
  if(back){
    await query("UPDATE friendships SET status='accepted',updated_at=? WHERE requester_id=? AND addressee_id=?",[t,b,a]);
    return "accepted";
  }
  const mine=(await query("SELECT status FROM friendships WHERE requester_id=? AND addressee_id=?",[a,b])).rows[0];
  if(mine)return mine.status;
  await query("INSERT INTO friendships(requester_id,addressee_id,status,created_at,updated_at) VALUES(?,?,'pending',?,?)",[a,b,t,t]);
  return "pending";
}
export async function d1AcceptFriend(userId,otherId){
  await ensureD1Schema();
  const r=await query("UPDATE friendships SET status='accepted',updated_at=? WHERE requester_id=? AND addressee_id=? AND status='pending'",[now(),Number(otherId),Number(userId)]);
  return Number(r?.meta?.changes||0)>0;
}
export async function d1RemoveFriend(userId,otherId){
  await ensureD1Schema();
  const a=Number(userId),b=Number(otherId);
  await query("DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",[a,b,b,a]);
}
// Concerts marked by the user's accepted friends.
export async function d1FriendsConcerts(userId){
  await ensureD1Schema();
  const id=Number(userId);
  return (await query(
    "SELECT c.user_id,u.username,c.ckey,c.status,c.data,c.updated_at FROM user_concerts c JOIN users u ON u.id=c.user_id WHERE c.user_id IN (SELECT addressee_id FROM friendships WHERE requester_id=? AND status='accepted' UNION SELECT requester_id FROM friendships WHERE addressee_id=? AND status='accepted')",
    [id,id]
  )).rows;
}
export async function d1GetFriendsSeen(userId){
  await ensureD1Schema();
  return (await query("SELECT friends_seen_at FROM user_seen WHERE user_id=?",[Number(userId)])).rows[0]?.friends_seen_at||null;
}
export async function d1SetFriendsSeen(userId,at){
  await ensureD1Schema();
  await query("INSERT INTO user_seen(user_id,friends_seen_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET friends_seen_at=excluded.friends_seen_at",[Number(userId),String(at||now())]);
}
export async function d1ShareBand(fromId,toIds,artist,message){
  await ensureD1Schema();
  const t=now(),json=JSON.stringify(artist||{}),msg=String(message||"").slice(0,280);
  for(const to of toIds)await query("INSERT INTO band_shares(from_id,to_id,artist_json,message,created_at) VALUES(?,?,?,?,?)",[Number(fromId),Number(to),json,msg,t]);
}
export async function d1SharesFor(userId,since){
  await ensureD1Schema();
  return (await query("SELECT s.id,s.from_id,u.username,s.artist_json,s.message,s.created_at FROM band_shares s JOIN users u ON u.id=s.from_id WHERE s.to_id=? AND s.created_at>? ORDER BY s.created_at DESC LIMIT 30",[Number(userId),String(since)])).rows;
}
// Small key/value cache (stored in geo_cache) for album streaming links.
export async function d1GetCacheValue(key){
  if(!d1ConfigStatus().configured)return null;
  await ensureD1Schema();
  const v=(await query("SELECT value FROM geo_cache WHERE key=?",[String(key)])).rows[0]?.value;
  try{return v?JSON.parse(v):null}catch{return null}
}
export async function d1SetCacheValue(key,value){
  if(!d1ConfigStatus().configured)return;
  await ensureD1Schema();
  await query("INSERT INTO geo_cache(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",[String(key),JSON.stringify(value),now()]);
}
