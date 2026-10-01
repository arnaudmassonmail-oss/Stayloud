import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {countryGuess,isRelevantArtistNews} from "./utils.js";

const file=process.env.DB_FILE||((process.env.RENDER_DISK_PATH||process.env.DATA_DIR)?path.join(process.env.RENDER_DISK_PATH||process.env.DATA_DIR,'music-radar.sqlite'):"./data/music-radar.sqlite");
fs.mkdirSync(path.dirname(file),{recursive:true});
export const db=new Database(file);
db.pragma("journal_mode=WAL");
db.pragma("foreign_keys=ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 email TEXT UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets(
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE TABLE IF NOT EXISTS artists(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 mbid TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 style TEXT,
 disambiguation TEXT,
 country TEXT,
 photo_url TEXT,
 bandsintown_url TEXT,
 infoconcert_url TEXT,
 identity_source TEXT,
 identity_key TEXT,
 identity_locked INTEGER DEFAULT 0,
 description TEXT
);

CREATE TABLE IF NOT EXISTS news(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
 title TEXT NOT NULL,url TEXT NOT NULL,source TEXT,provider TEXT NOT NULL,image_url TEXT,
 published_at TEXT,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,
 dedupe_key TEXT NOT NULL, UNIQUE(artist_id,dedupe_key)
);
CREATE TABLE IF NOT EXISTS events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
 title TEXT NOT NULL,date TEXT,time TEXT,venue TEXT,city TEXT,country TEXT,
 url TEXT,provider TEXT NOT NULL,evidence_json TEXT,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,
 dedupe_key TEXT NOT NULL, UNIQUE(artist_id,dedupe_key)
);
CREATE TABLE IF NOT EXISTS event_sources(
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,url TEXT,PRIMARY KEY(event_id,provider)
);
CREATE TABLE IF NOT EXISTS provider_runs(
 provider TEXT PRIMARY KEY,last_run_at TEXT,last_success_at TEXT,last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_date ON news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_artist ON news(artist_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_artist ON events(artist_id);
CREATE INDEX IF NOT EXISTS idx_events_country ON events(country);
`);
const userColumns=db.prepare("PRAGMA table_info(users)").all().map(x=>x.name);
if(!userColumns.includes("email")){try{db.exec("ALTER TABLE users ADD COLUMN email TEXT")}catch{}}
try{db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND email <> ")}catch{}
const artistColumns=db.prepare("PRAGMA table_info(artists)").all().map(x=>x.name);
if(!artistColumns.includes("description")) db.exec("ALTER TABLE artists ADD COLUMN description TEXT");
try{db.exec("ALTER TABLE artists ADD COLUMN description TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN style TEXT")}catch{}
try{db.exec("ALTER TABLE news ADD COLUMN image_url TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN disambiguation TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN country TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN photo_url TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN bandsintown_url TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN infoconcert_url TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN identity_source TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN identity_key TEXT")}catch{}
try{db.exec("ALTER TABLE artists ADD COLUMN identity_locked INTEGER DEFAULT 0")}catch{}
try{db.exec("ALTER TABLE events ADD COLUMN evidence_json TEXT")}catch{}

// Concert engine v5.15: only Bandsintown + InfoConcert. Any cache created by
// an older engine is discarded once, while artists/news are preserved.
db.exec("CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT)");
try{db.exec("ALTER TABLE artists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")}catch{}
try{db.exec("CREATE INDEX IF NOT EXISTS idx_artists_user ON artists(user_id)")}catch{}

try{db.exec("CREATE INDEX IF NOT EXISTS idx_artists_normalized_name ON artists(normalized_name)")}catch{}
export function migrateConcertEngineV59(){
 const key='concert_engine_version';
 const row=db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);
 if(row?.value==='5.17.0')return false;
 const tx=db.transaction(()=>{
   db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,'5.17.0');
 });
 tx();
 return true;
}

export const now=()=>new Date().toISOString();
export const normalizeName=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/\s+/g," ");
export const slug=s=>normalizeName(s).replace(/[^a-z0-9]+/g,"");

function hashPassword(password,salt){return crypto.scryptSync(password,salt,64).toString("hex")}
function hashToken(token){return crypto.createHash("sha256").update(token).digest("hex")}
function normalizeEmail(email){return String(email||"").trim().toLowerCase()}
function publicUser(id){return db.prepare("SELECT id,username,email,created_at FROM users WHERE id=?").get(id)}
export function createUser(username,password,email){
 const u=String(username||"").trim(), e=normalizeEmail(email);
 if(!/^[A-Za-z0-9_.-]{3,32}$/.test(u)) throw new Error("Nom d'utilisateur invalide (3 à 32 caractères)");
 if(!/^\S+@\S+\.\S+$/.test(e)) throw new Error("Adresse e-mail invalide");
 if(String(password||"").length<6) throw new Error("Le mot de passe doit contenir au moins 6 caractères");
 const salt=crypto.randomBytes(16).toString("hex"), t=now();
 const r=db.prepare("INSERT INTO users(username,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(u,e,hashPassword(password,salt),salt,t,t);
 const id=Number(r.lastInsertRowid);
 if(db.prepare("SELECT COUNT(*) n FROM users").get().n===1){db.prepare("UPDATE artists SET user_id=? WHERE user_id IS NULL").run(id)}
 return publicUser(id);
}
export function authenticateUser(username,password){
 const login=String(username||"").trim();
 if(!login)return null;
 let u=db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(login);
 if(!u && /^\S+@\S+\.\S+$/.test(login)) u=db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(normalizeEmail(login));
 if(!u)return null;
 const got=hashPassword(String(password??""),u.password_salt);
 const expected=Buffer.from(String(u.password_hash||""),"hex");
 const actual=Buffer.from(got,"hex");
 if(expected.length!==actual.length || !crypto.timingSafeEqual(actual,expected))return null;
 return publicUser(u.id);
}

export function updateUserEmail(userId,email){
 const e=normalizeEmail(email);
 if(!/^\S+@\S+\.\S+$/.test(e))throw new Error("Adresse e-mail invalide");
 db.prepare("UPDATE users SET email=?,updated_at=? WHERE id=?").run(e,now(),userId);
 return publicUser(userId);
}
export function createPasswordReset(userId){
 const token=crypto.randomBytes(32).toString("base64url"),t=now(),expires=new Date(Date.now()+1000*60*30).toISOString();
 db.prepare("DELETE FROM password_resets WHERE user_id=? OR expires_at<=?").run(userId,t);
 db.prepare("INSERT INTO password_resets(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(hashToken(token),userId,t,expires);
 return {token,expiresAt:expires};
}
export function consumePasswordReset(token,newPassword){
 if(String(newPassword||"").length<6)throw new Error("Le mot de passe doit contenir au moins 6 caractères");
 const row=db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?").get(hashToken(token),now());
 if(!row)throw new Error("Lien de réinitialisation invalide ou expiré");
 const salt=crypto.randomBytes(16).toString("hex");
 const tx=db.transaction(()=>{
  db.prepare("UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?").run(hashPassword(newPassword,salt),salt,now(),row.user_id);
  db.prepare("UPDATE password_resets SET used_at=? WHERE token_hash=?").run(now(),hashToken(token));
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
 });
 tx();
 return publicUser(row.user_id);
}
export function findUserByEmail(email){return db.prepare("SELECT id,username,email FROM users WHERE email=? COLLATE NOCASE").get(normalizeEmail(email))||null}
export function upsertLocalUserMirror(user,credentials={}){
 const id=Number(user.id), username=String(user.username||"").trim(), email=normalizeEmail(user.email);
 const existing=db.prepare("SELECT id FROM users WHERE id=?").get(id);
 const hash=String(credentials.password_hash||user.password_hash||"");
 const salt=String(credentials.password_salt||user.password_salt||"");
 if(existing){
   db.prepare("UPDATE users SET username=?,email=?,password_hash=CASE WHEN ?<>'' THEN ? ELSE password_hash END,password_salt=CASE WHEN ?<>'' THEN ? ELSE password_salt END,updated_at=? WHERE id=?")
     .run(username,email,hash,hash,salt,salt,user.updated_at||now(),id);
 }else{
   db.prepare("INSERT INTO users(id,username,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
     .run(id,username,email,hash,salt,user.created_at||now(),user.updated_at||now());
 }
 return publicUser(id);
}
export function localUsers(){return db.prepare("SELECT id,username,email,password_hash,password_salt,created_at,updated_at FROM users ORDER BY id").all()}
export function localArtistsForUser(userId){return db.prepare("SELECT * FROM artists WHERE user_id=? ORDER BY id").all(Number(userId))}

export function createSession(userId){
 const token=crypto.randomBytes(32).toString("base64url"),t=now(),expires=new Date(Date.now()+1000*60*60*24*30).toISOString();
 db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(hashToken(token),userId,t,expires);
 return {token,expiresAt:expires};
}
export function getSession(token){
 if(!token)return null;
 const row=db.prepare("SELECT s.user_id,u.id,u.username,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").get(hashToken(token),now());
 if(!row)return null;
 // Refresh the 30-day rolling session so reopening STAYLOUD does not
 // unexpectedly log a user out while the account is still active.
 db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(new Date(Date.now()+1000*60*60*24*30).toISOString(),hashToken(token));
 return publicUser(row.id);
}
export function deleteSession(token){if(token)db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token))}
export function getArtists(userId=null){return userId==null?db.prepare("SELECT * FROM artists ORDER BY name COLLATE NOCASE").all():db.prepare("SELECT * FROM artists WHERE user_id=? ORDER BY name COLLATE NOCASE").all(userId)}
export const getArtist=(id,userId=null)=>userId==null?db.prepare("SELECT * FROM artists WHERE id=?").get(id):db.prepare("SELECT * FROM artists WHERE id=? AND user_id=?").get(id,userId);

export function upsertArtist(name,mbid=null,style=null,meta={}){
 const n=normalizeName(name), t=now(), identityKey=String(meta.identityKey||'').trim()||null, userId=Number(meta.userId)||null;
 let old=null;
 if(mbid) old=db.prepare("SELECT * FROM artists WHERE user_id IS ? AND mbid=?").get(userId,mbid);
 else if(identityKey) old=db.prepare("SELECT * FROM artists WHERE user_id IS ? AND identity_key=?").get(userId,identityKey);
 else old=db.prepare("SELECT * FROM artists WHERE user_id IS ? AND normalized_name=? AND (mbid IS NULL OR mbid='') ORDER BY id LIMIT 1").get(userId,n);
 if(old){db.prepare("UPDATE artists SET name=?,mbid=COALESCE(?,mbid),style=COALESCE(?,style),disambiguation=COALESCE(?,disambiguation),country=COALESCE(?,country),photo_url=COALESCE(?,photo_url),identity_source=COALESCE(?,identity_source),identity_key=COALESCE(?,identity_key),identity_locked=COALESCE(?,identity_locked),updated_at=? WHERE id=?").run(name,mbid,style,meta.disambiguation||null,meta.country||null,meta.photoUrl||null,meta.identitySource||null,identityKey,meta.identityLocked==null?null:(meta.identityLocked?1:0),t,old.id);return getArtist(old.id)}
 const r=db.prepare("INSERT INTO artists(user_id,name,normalized_name,mbid,created_at,updated_at,style,disambiguation,country,photo_url,identity_source,identity_key,identity_locked) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(userId,name,n,mbid,t,t,style,meta.disambiguation||null,meta.country||null,meta.photoUrl||null,meta.identitySource||null,identityKey,meta.identityLocked?1:0);
 return getArtist(r.lastInsertRowid);
}

export function setArtistSourceUrls(id,{bandsintownUrl=null,infoconcertUrl=null}={}){db.prepare("UPDATE artists SET bandsintown_url=COALESCE(?,bandsintown_url),infoconcert_url=COALESCE(?,infoconcert_url),updated_at=? WHERE id=?").run(bandsintownUrl||null,infoconcertUrl||null,now(),id);return getArtist(id)}
export function updateArtist(id,{name=null,mbid=null,style=null,disambiguation=null,country=null,photoUrl=null,description=null,identitySource=null,identityLocked=null}={}){db.prepare("UPDATE artists SET name=COALESCE(?,name),mbid=COALESCE(?,mbid),style=COALESCE(?,style),disambiguation=COALESCE(?,disambiguation),country=COALESCE(?,country),photo_url=COALESCE(?,photo_url),description=COALESCE(?,description),identity_source=COALESCE(?,identity_source),identity_locked=COALESCE(?,identity_locked),updated_at=? WHERE id=?").run(name,mbid,style,disambiguation,country,photoUrl,description,identitySource,identityLocked==null?null:(identityLocked?1:0),now(),id);return getArtist(id)}
export function deleteArtist(id){db.prepare("DELETE FROM artists WHERE id=?").run(id)}

export function putNews(artistId,x){
 const old=db.prepare("SELECT id FROM news WHERE artist_id=? AND dedupe_key=?").get(artistId,x.dedupe_key),t=now();
 if(old){
  db.prepare("UPDATE news SET title=?,url=?,source=?,provider=?,image_url=COALESCE(?,image_url),published_at=COALESCE(?,published_at),last_seen_at=? WHERE id=?")
   .run(x.title,x.url||"",x.source||"",x.provider,x.image_url||null,x.published_at||null,t,old.id);
  return old.id
}
 const r=db.prepare(`INSERT INTO news(artist_id,title,url,source,provider,image_url,published_at,first_seen_at,last_seen_at,dedupe_key)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(artistId,x.title,x.url||"",x.source||"",x.provider,x.image_url||null,x.published_at||null,t,t,x.dedupe_key);
 return r.lastInsertRowid;
}
export function putEvent(artistId,x){
 let old=db.prepare("SELECT id,evidence_json FROM events WHERE artist_id=? AND dedupe_key=?").get(artistId,x.dedupe_key);
 if(!old){
  old=db.prepare("SELECT id,evidence_json FROM events WHERE artist_id=? AND date IS ? AND lower(coalesce(venue,''))=lower(?) AND lower(coalesce(city,''))=lower(?) LIMIT 1").get(artistId,x.date||null,x.venue||"",x.city||"");
 }
 const t=now();
 const mergeEvidence=(a,b)=>{
   const all=[];
   for(const v of [a,b]){
     if(!v)continue;
     try{const parsed=typeof v==='string'?JSON.parse(v):v;if(Array.isArray(parsed))all.push(...parsed);else if(parsed)all.push(parsed)}catch{}
   }
   const seen=new Set();
   return all.filter(v=>{const k=JSON.stringify(v);if(seen.has(k))return false;seen.add(k);return true});
 };
 if(old){
  const evidence=mergeEvidence(old.evidence_json,x.evidence_json);
  db.prepare(`UPDATE events SET title=?,date=?,time=COALESCE(?,time),venue=?,city=?,country=?,url=COALESCE(NULLIF(?,''),url),provider=?,evidence_json=?,last_seen_at=? WHERE id=?`)
   .run(x.title,x.date||null,x.time||null,x.venue||"",x.city||"",x.country||"",x.url||"",x.provider,evidence.length?JSON.stringify(evidence):old.evidence_json||null,t,old.id);
  db.prepare("INSERT OR REPLACE INTO event_sources(event_id,provider,url) VALUES(?,?,?)").run(old.id,x.provider,x.url||"");
  return old.id
 }
 const r=db.prepare(`INSERT INTO events(artist_id,title,date,time,venue,city,country,url,provider,evidence_json,first_seen_at,last_seen_at,dedupe_key)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(artistId,x.title,x.date||null,x.time||null,x.venue||"",x.city||"",x.country||"",x.url||"",x.provider,x.evidence_json||null,t,t,x.dedupe_key);
 db.prepare("INSERT OR REPLACE INTO event_sources(event_id,provider,url) VALUES(?,?,?)").run(r.lastInsertRowid,x.provider,x.url||"");
 return r.lastInsertRowid;
}


function concertKey(x){
 return `${String(x.date||'').slice(0,10)}|${normalizeName(x.city).replace(/[^a-z0-9]+/g,' ')}|${normalizeName(x.venue).replace(/[^a-z0-9]+/g,' ')}`;
}

export function replaceArtistEvents(artistId,rows){
 // Verified synchronization: when at least one reference source responds,
 // the artist calendar is rebuilt from those two sources only. This removes
 // stale/fake concerts left by older engines. If both sources fail, the caller
 // does not invoke this function and the previous cache is preserved.
 const unique=new Map();
 for(const x of Array.isArray(rows)?rows:[]){
   if(!x?.date||!x?.city||!x?.venue)continue;
   const k=concertKey(x);
   const old=unique.get(k);
   if(!old){
     unique.set(k,{...x,sources:[{provider:x.provider,url:x.url||''}]});
   }else{
     if(String(x.title||'').length>String(old.title||'').length)old.title=x.title;
     old.time=old.time||x.time||null;
     old.sources.push({provider:x.provider,url:x.url||''});
   }
 }
 const tx=db.transaction(()=>{
   db.prepare('DELETE FROM event_sources WHERE event_id IN (SELECT id FROM events WHERE artist_id=?)').run(artistId);
   db.prepare('DELETE FROM events WHERE artist_id=?').run(artistId);
   for(const x of unique.values()){
     const evidence=JSON.stringify(x.sources||[]);
     const row={...x,dedupe_key:concertKey(x),evidence_json:evidence};
     const id=putEvent(artistId,row);
     for(const src of x.sources||[])db.prepare('INSERT OR REPLACE INTO event_sources(event_id,provider,url) VALUES(?,?,?)').run(id,src.provider,src.url||'');
   }
 });
 tx();
 return unique.size;
}


export function mergeArtistEvents(artistId,rows){
 const unique=new Map();
 for(const x of Array.isArray(rows)?rows:[]){
   if(!x?.date||!x?.city||!x?.venue)continue;
   const k=concertKey(x);
   const old=unique.get(k);
   if(!old)unique.set(k,{...x,sources:[{provider:x.provider,url:x.url||''}]});
   else{
     if(String(x.title||'').length>String(old.title||'').length)old.title=x.title;
     old.time=old.time||x.time||null;
     old.sources.push({provider:x.provider,url:x.url||''});
   }
 }
 const tx=db.transaction(()=>{
   for(const x of unique.values()){
     const row={...x,dedupe_key:concertKey(x),evidence_json:JSON.stringify(x.sources||[])};
     const id=putEvent(artistId,row);
     for(const src of x.sources||[])db.prepare('INSERT OR REPLACE INTO event_sources(event_id,provider,url) VALUES(?,?,?)').run(id,src.provider,src.url||'');
   }
 });
 tx();
 return unique.size;
}

export function cleanArtistNews(artistId,artistName){
 const rows=db.prepare("SELECT id,title,url,source,provider FROM news WHERE artist_id=?").all(artistId);
 let removed=0;
 const del=db.prepare("DELETE FROM news WHERE id=?");
 for(const r of rows){
   if(!isRelevantArtistNews({name:artistName},r.title,r.url,r.source,r.provider)){
     del.run(r.id); removed++;
   }
 }
 return removed;
}
export function newsList({artistId,userId,limit=500}={}){
 const rows=artistId
  ?(userId!=null?db.prepare(`SELECT n.*,a.name artist FROM news n JOIN artists a ON a.id=n.artist_id WHERE n.artist_id=? AND a.user_id=? ORDER BY datetime(COALESCE(n.published_at,n.last_seen_at)) DESC LIMIT ?`).all(artistId,userId,Math.max(limit,1000)):db.prepare(`SELECT n.*,a.name artist FROM news n JOIN artists a ON a.id=n.artist_id WHERE n.artist_id=? ORDER BY datetime(COALESCE(n.published_at,n.last_seen_at)) DESC LIMIT ?`).all(artistId,Math.max(limit,1000)))
  :(userId!=null?db.prepare(`SELECT n.*,a.name artist FROM news n JOIN artists a ON a.id=n.artist_id WHERE a.user_id=? ORDER BY datetime(COALESCE(n.published_at,n.last_seen_at)) DESC LIMIT ?`).all(userId,Math.max(limit,1000)):db.prepare(`SELECT n.*,a.name artist FROM news n JOIN artists a ON a.id=n.artist_id ORDER BY datetime(COALESCE(n.published_at,n.last_seen_at)) DESC LIMIT ?`).all(Math.max(limit,1000)));
 return rows.filter(n=>isRelevantArtistNews({name:n.artist},n.title,n.url,n.source,n.provider)).slice(0,limit);
}
export function eventList({artistId,userId,country,limit=500}={}){
 let q=`SELECT e.*,a.name artist FROM events e JOIN artists a ON a.id=e.artist_id WHERE date(e.date)>=date('now')`,p=[];
 if(userId!=null){q+=" AND a.user_id=?";p.push(userId)}
 if(artistId){q+=" AND e.artist_id=?";p.push(artistId)}
 q+=" ORDER BY date(e.date),time(e.time) LIMIT ?";p.push(limit);
 let rows=db.prepare(q).all(...p).map(e=>({...e,country:countryGuess(e.country,e.city,e.venue,e.title)}));
 const key=e=>[e.artist_id,String(e.date||'').slice(0,10),normalizeName(e.city).replace(/[^a-z0-9]+/g,' '),normalizeName(e.venue).replace(/[^a-z0-9]+/g,' ')].join('|');
 const best=new Map(); for(const e of rows){const k=key(e);const old=best.get(k);if(!old||String(e.title||'').length>String(old.title||'').length)best.set(k,e)}
 rows=[...best.values()].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.time||'').localeCompare(String(b.time||'')));
 return country ? rows.filter(e=>e.country.toLowerCase()===String(country).toLowerCase()) : rows;
}
export function runStatus(){return db.prepare("SELECT * FROM provider_runs ORDER BY provider").all()}
export function providerRun(provider,error=null){
 const t=now();
 db.prepare(`INSERT INTO provider_runs(provider,last_run_at,last_success_at,last_error) VALUES(?,?,?,?)
 ON CONFLICT(provider) DO UPDATE SET last_run_at=excluded.last_run_at,
 last_success_at=COALESCE(excluded.last_success_at,provider_runs.last_success_at),
 last_error=excluded.last_error`).run(provider,t,error?null:t,error);
}
