import express from "express";
import cron from "node-cron";
import {d1ListUserConcerts,d1SetUserConcert,d1DeleteUserConcert,d1FindUserByUsername,d1ListFriendships,d1RequestFriend,d1AcceptFriend,d1RemoveFriend,d1FriendsConcerts} from "./d1.js";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getArtists,getArtist,upsertArtist,updateArtist,deleteArtist,newsList,eventList,runStatus,mergeArtistEvents,upsertLocalUserMirror,localUsers,localArtistsForUser,bandKey,importArtistNews,importArtistEvents} from "./db.js";
import {d1GetBandCache,d1Enabled,d1ConfigStatus,ensureD1Schema,d1CreateUser,d1AuthenticateUser,d1FindUserByEmail,d1UpdateUserEmail,d1CreateSession,d1GetSession,d1DeleteSession,d1CreatePasswordReset,d1ConsumePasswordReset,d1UpsertGroup,d1DeleteGroup,d1ListGroups,d1MigrateLocalUser} from "./d1.js";
import {resolve,resolveByMbid,searchArtistCandidates,fetchArtistProfile,discoverArtistPhoto,discoverArtistPhotos} from "./providers/musicbrainz.js";
import {refreshArtist,refreshAll,refreshArtistNews,refreshArtistConcerts,enrichArtistNews,enrichNewsItems} from "./aggregator.js";
import {bandsintownArtistId,resolveBandsintown,resolveInfoConcert} from "./providers/concert-web.js";
import {warmGeoCache,discoverArtists,discoverNearbyConcerts,discoverNearbyFestivals,geocodeQuery,discoverManualCityConcerts,mergeFollowedConcerts} from "./providers/discovery.js";

const app=express();app.use(express.json({limit:"10mb"}));
const dir=path.dirname(fileURLToPath(import.meta.url));app.use(express.static(path.join(dir,"../public"),{etag:false,lastModified:false,setHeaders:(res,filePath)=>{if(filePath.endsWith(".html"))res.setHeader("Cache-Control","no-store");}}));

// Explicit root route: allows a normal browser reload/F5 on the production URL.
app.get("/",(req,res)=>res.sendFile(path.join(dir,"../public/index.html")));
function parseCookies(req){const out={};for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function setSessionCookie(res,token){res.setHeader('Set-Cookie',`stayloud_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function clearSessionCookie(res){res.setHeader('Set-Cookie','stayloud_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')}
async function restoreUserGroups(userId){
 if(!d1Enabled)return;
 const rows=await d1ListGroups(userId), keep=new Set();
 for(const g of rows){
  const syncKey=String(g.sync_key||"").trim();
  const identityKey=String(g.identity_key||"").trim();
  const mbid=String(g.mbid||"").trim();
  const normalizedName=String(g.normalized_name||g.name||"").trim().toLowerCase();
  if(syncKey) keep.add(syncKey);
  if(identityKey) keep.add(identityKey);
  if(mbid) keep.add(`mbid:${mbid}`);
  if(normalizedName) keep.add(`name:${normalizedName}`);
  const a=upsertArtist(g.name,g.mbid||null,g.style||null,{disambiguation:g.disambiguation||null,country:g.country||null,photoUrl:g.photo_url||null,identitySource:g.identity_source||null,identityKey:g.identity_key||null,identityLocked:Boolean(g.identity_locked),userId:Number(userId)});
  if(g.description!=null||g.bandsintown_url||g.infoconcert_url){
   updateArtist(a.id,{description:g.description||null});
   const {setArtistSourceUrls}=await import("./db.js");
   setArtistSourceUrls(a.id,{bandsintownUrl:g.bandsintown_url||null,infoconcertUrl:g.infoconcert_url||null});
  }
 }
 for(const a of localArtistsForUser(userId)){
  const key=String(a.identity_key||"").trim() || (String(a.mbid||"").trim()?`mbid:${String(a.mbid).trim()}`:`name:${String(a.normalized_name||a.name||"").trim().toLowerCase()}`);
  if(!keep.has(key)) deleteArtist(a.id);
 }
 warmUserArtists(userId);
}
// News and concerts live in the local SQLite file, which a free Render
// instance loses on every restart / wake-up, while groups come back from D1
// at login. The startup refresh runs before anyone logs in (no groups yet)
// and the cron does not run while the instance sleeps, so refresh each
// user's groups once per server process, in the background, when they show up.
const warmedArtists=new Set(), warmingByUser=new Map(), enrichingByUser=new Map();
const TOP_NEWS_PHOTOS=10;
let warmChain=Promise.resolve();
// Cached copies newer than this are shown as-is; older ones are refreshed
// in the background (new articles / concerts only).
const NEWS_CACHE_TTL=2*3600e3, EVENTS_CACHE_TTL=12*3600e3;
function warmUserArtists(userId){
 const uid=Number(userId);
 const ids=localArtistsForUser(uid).map(a=>a.id).filter(id=>!warmedArtists.has(id));
 if(!ids.length)return;
 for(const id of ids)warmedArtists.add(id);
 warmingByUser.set(uid,(warmingByUser.get(uid)||0)+1);
 enrichingByUser.set(uid,(enrichingByUser.get(uid)||0)+1);
 let warmDone=false;const endWarming=()=>{if(warmDone)return;warmDone=true;warmingByUser.set(uid,Math.max(0,(warmingByUser.get(uid)||1)-1))};
 let pending=[],staleNews=ids,staleEvents=ids;
 // 0) restore the saved 6 months of news + upcoming concerts from D1 right
 // away: instant display. This must not wait in the shared refresh queue
 // behind other accounts' (slow, network-bound) refreshes.
 const restored=(async()=>{
   const arts=ids.map(id=>getArtist(id)).filter(Boolean);let cache=new Map();
   try{cache=await d1GetBandCache(arts.map(bandKey))}catch(e){logWarm(e)}
   staleNews=[];staleEvents=[];const t=Date.now();
   for(const a of arts){const c=cache.get(bandKey(a));
    if(c?.news_json){try{importArtistNews(a.id,JSON.parse(c.news_json))}catch(e){logWarm(e)}}
    if(c?.events_json){try{importArtistEvents(a.id,JSON.parse(c.events_json))}catch(e){logWarm(e)}}
    if(!c?.news_at||t-Date.parse(c.news_at)>NEWS_CACHE_TTL)staleNews.push(a.id);
    if(!c?.events_at||t-Date.parse(c.events_at)>EVENTS_CACHE_TTL)staleEvents.push(a.id);
   }
   if(arts.length&&arts.every(a=>cache.get(bandKey(a))?.news_json))endWarming();
 })().catch(e=>logWarm(e));
 warmChain=warmChain
  .then(()=>restored)
  // 1) new articles of stale groups 2) photos of the 10 newest new articles
  .then(async()=>{for(const id of staleNews){try{pending.push(...(await refreshArtistNews(id,{enrich:false})).pending.map(row=>({artistId:id,row})))}catch(e){logWarm(e)}}
   pending.sort((a,b)=>String(b.row.published_at||'').localeCompare(String(a.row.published_at||'')));
   try{await enrichNewsItems(pending.slice(0,TOP_NEWS_PHOTOS))}catch(e){logWarm(e)}})
  .finally(endWarming)
  // 3) concerts of stale groups 4) photos/dates of the remaining new articles
  .then(async()=>{for(const id of staleEvents){try{await refreshArtistConcerts(id)}catch(e){logWarm(e)}}})
  .then(async()=>{try{await enrichNewsItems(pending.slice(TOP_NEWS_PHOTOS))}catch(e){logWarm(e)}})
  .catch(()=>{})
  .finally(()=>enrichingByUser.set(uid,Math.max(0,(enrichingByUser.get(uid)||1)-1)));
}
const logWarm=e=>console.error('Warm refresh:',e?.message||e);
const isWarming=userId=>(warmingByUser.get(Number(userId))||0)>0;
const isEnriching=userId=>(enrichingByUser.get(Number(userId))||0)>0;
async function bootstrapD1(){
 if(!d1Enabled)return;
 await ensureD1Schema();
 for(const u of localUsers()){
  const du=await d1MigrateLocalUser(u);
  upsertLocalUserMirror(du,u);
  for(const a of localArtistsForUser(u.id)) await d1UpsertGroup(u.id,a);
 }
}
// Signed-in user when there is one (public endpoints that personalise results).
async function optionalUser(req){try{const user=d1Enabled?await d1GetSession(parseCookies(req).stayloud_session):null;if(user){upsertLocalUserMirror(user);await restoreUserGroups(user.id)}return user||null}catch{return null}}
async function requireAuth(req,res,next){try{const user=d1Enabled?await d1GetSession(parseCookies(req).stayloud_session):null;if(!user)return res.status(401).json({error:'Connexion requise'});upsertLocalUserMirror(user);await restoreUserGroups(user.id);req.user=user;next()}catch(e){console.error('Auth:',e?.message||e);res.status(503).json({error:'Service de comptes indisponible'})}}
function ownedArtist(req,id){return getArtist(Number(id),req.user.id)}
app.post('/api/auth/register',async(req,res)=>{
 try{
  if(!d1Enabled)return res.status(503).json({error:'D1 n’est pas configuré sur le serveur'});
  const user=await d1CreateUser(req.body?.username,req.body?.email,req.body?.password);
  upsertLocalUserMirror(user);
  const session=await d1CreateSession(user.id);
  setSessionCookie(res,session.token); res.status(201).json({user});
 }catch(e){
  const msg=String(e?.message||e);
  res.status(400).json({error:/unique|constraint/i.test(msg)?(/email/i.test(msg)?'Adresse e-mail déjà utilisée':'Nom d’utilisateur déjà utilisé'):msg});
 }
});
app.post('/api/auth/login',async(req,res)=>{
 try{
  if(!d1Enabled)return res.status(503).json({error:'D1 n’est pas configuré sur le serveur'});
  const user=await d1AuthenticateUser(req.body?.username,req.body?.password);
  if(!user)return res.status(401).json({error:'Nom d’utilisateur ou mot de passe incorrect'});
  upsertLocalUserMirror(user); await restoreUserGroups(user.id);
  const session=await d1CreateSession(user.id); setSessionCookie(res,session.token); res.json({user});
 }catch(e){res.status(503).json({error:e.message||'Connexion impossible'})}
});
app.post('/api/auth/logout',async(req,res)=>{
 try{if(d1Enabled)await d1DeleteSession(parseCookies(req).stayloud_session);}catch(e){console.error('Logout:',e?.message||e)}
 clearSessionCookie(res); res.status(204).end();
});
app.get('/api/auth/me',async(req,res)=>{
 try{
  if(!d1Enabled)return res.status(401).json({error:'Non connecté'});
  const user=await d1GetSession(parseCookies(req).stayloud_session);
  if(!user)return res.status(401).json({error:'Non connecté'});
  upsertLocalUserMirror(user); await restoreUserGroups(user.id); res.json({user});
 }catch(e){res.status(503).json({error:'Service de comptes indisponible'})}
});
app.patch('/api/auth/email',requireAuth,async(req,res)=>{
 try{const user=await d1UpdateUserEmail(req.user.id,req.body?.email);upsertLocalUserMirror(user);res.json({user});}
 catch(e){const msg=String(e?.message||e);res.status(400).json({error:/unique|constraint/i.test(msg)?'Adresse e-mail déjà utilisée':msg})}
});
app.post('/api/auth/forgot-password',async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase();
 const generic='Si cette adresse correspond à un compte STAYLOUD, un e-mail avec votre nom d’utilisateur et un lien pour changer de mot de passe va être envoyé.';
 try{
  if(!/^\S+@\S+\.\S+$/.test(email))return res.json({ok:true,message:generic});
  if(!d1Enabled)return res.status(503).json({error:'La récupération par e-mail doit être configurée sur le serveur avec D1.'});
  const user=await d1FindUserByEmail(email); if(!user)return res.json({ok:true,message:generic});
  const {token}=await d1CreatePasswordReset(user.id);
  const base=String(process.env.APP_PUBLIC_URL||'').replace(/\/$/,'');
  if(!base)return res.status(503).json({error:'La récupération par e-mail doit être configurée sur le serveur (APP_PUBLIC_URL).'});
  const apiKey=String(process.env.RESEND_API_KEY||'').trim(), from=String(process.env.EMAIL_FROM||'').trim();
  if(!apiKey||!from)return res.status(503).json({error:'La récupération par e-mail doit être configurée sur le serveur (RESEND_API_KEY et EMAIL_FROM).'});
  const resetUrl=base+'/?reset='+encodeURIComponent(token);
  // One e-mail covers both "forgot password" and "forgot username".
  const safeName=String(user.username||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=`<div style="background:#050607;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#e8ebee"><div style="max-width:480px;margin:0 auto;background:#0d1116;border:1px solid #2a333d;border-radius:14px;overflow:hidden">${base?`<img src="${base}/stayloud-banner.png" alt="STAYLOUD Music Radar" width="480" style="display:block;width:100%;height:auto">`:''}<div style="padding:22px"><p style="margin:0 0 14px">Bonjour,</p><p style="margin:0 0 6px">Votre nom d’utilisateur STAYLOUD :</p><p style="margin:0 0 18px;font-size:22px;font-weight:bold;color:#ff2733">${safeName}</p><p style="margin:0 0 16px">Pour choisir un nouveau mot de passe :</p><p style="margin:0 0 18px"><a href="${resetUrl}" style="display:inline-block;background:#e50914;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">Choisir un nouveau mot de passe</a></p><p style="margin:0 0 8px;font-size:13px;color:#9aa3ad">Ce lien expire dans 30 minutes et ne peut être utilisé qu’une seule fois. Vous pouvez aussi vous connecter avec votre adresse e-mail à la place du nom d’utilisateur.</p><p style="margin:0;font-size:13px;color:#9aa3ad">Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail.</p></div></div></div>`;
  const rr=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[user.email],subject:'STAYLOUD — vos identifiants',html})});
  if(!rr.ok)throw new Error('Envoi e-mail impossible'); return res.json({ok:true,message:generic});
 }catch(e){console.error('Password reset email:',e?.message||e);return res.status(502).json({error:'Impossible d’envoyer l’e-mail de récupération pour le moment.'})}
});
app.post('/api/auth/reset-password',async(req,res)=>{
 try{
  if(!d1Enabled)return res.status(503).json({error:'D1 n’est pas configuré sur le serveur'});
  const user=await d1ConsumePasswordReset(String(req.body?.token||''),String(req.body?.password||'')); upsertLocalUserMirror(user);
  res.json({ok:true,user});
 }catch(e){res.status(400).json({error:e.message})}
});

app.get("/api/health",(_,res)=>res.json({ok:true,version:"7.18.63",mode:"manual-city-source-selection",d1:d1ConfigStatus()}));
app.get("/api/artists",requireAuth,(req,res)=>res.json({artists:getArtists(req.user.id)}));
app.get("/api/artists/:id/profile",requireAuth,async(req,res)=>{try{
 const a=ownedArtist(req,req.params.id);if(!a)return res.status(404).json({error:"introuvable"});
 let profileArtist=a;
 if(!String(a.mbid||'').trim()){
  const candidates=await searchArtistCandidates(a.name,8);
  const target=String(a.name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const exact=candidates.find(x=>String(x?.mbid||'').trim() && String(x?.name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()===target);
  if(exact){
   const updated=updateArtist(a.id,{name:exact.name,mbid:exact.mbid,disambiguation:exact.disambiguation||null,country:exact.country||null,identitySource:exact.source||a.identity_source||null,identityLocked:true});
   if(d1Enabled)await d1UpsertGroup(req.user.id,updated);
   profileArtist=updated;
  }
 }
 res.json(await fetchArtistProfile(profileArtist));
}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/photo",async(req,res)=>{try{const name=String(req.query.name||"").trim();if(!name)return res.status(400).json({error:"name requis"});res.json(await discoverArtistPhoto(name))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/artists/candidates",async(req,res)=>{try{const name=String(req.query.name||"").trim();if(!name)return res.status(400).json({error:"name requis"});res.json({input:name,items:await searchArtistCandidates(name,8)})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/artists/photo-candidates",async(req,res)=>{try{const name=String(req.query.name||"").trim(),context=String(req.query.context||"").trim(),force=String(req.query.force||"")==="1",page=Math.max(0,Number(req.query.page||0)||0);let exclude=[];try{exclude=JSON.parse(String(req.query.exclude||"[]"));if(!Array.isArray(exclude))exclude=[]}catch{};if(!name)return res.status(400).json({error:"name requis"});const bandsintownUrl=String(req.query.bandsintownUrl||'').trim();res.json({items:await discoverArtistPhotos(name,5,context,{force,page,exclude,bandsintownUrl,mbid:String(req.query.mbid||'').trim()})})}catch(e){res.status(502).json({error:e.message})}});
const deezerPreviewCache=new Map();
function normMusic(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
app.get("/api/music/album-tracks",async(req,res)=>{
 try{
  const artist=String(req.query.artist||"").trim(),album=String(req.query.album||"").trim();
  if(!artist||!album)return res.status(400).json({error:"artist et album requis"});
  const key="tracks|"+normMusic(artist)+"|"+normMusic(album);
  const cached=deezerPreviewCache.get(key);
  if(cached && cached.expires>Date.now()) return res.json(cached.data);
  const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),8000);
  const q=encodeURIComponent(`${artist} ${album}`);
  const r=await fetch(`https://api.deezer.com/search/album?q=${q}&limit=25`,{signal:ac.signal,headers:{Accept:"application/json"}});
  if(!r.ok)throw new Error(`Deezer HTTP ${r.status}`);
  const d=await r.json();
  const rows=Array.isArray(d?.data)?d.data:[]; const na=normMusic(artist),nb=normMusic(album);
  const ranked=rows.map(a=>{const aa=normMusic(a?.artist?.name),tt=normMusic(a?.title);let score=0;if(aa===na)score+=8;else if(aa.includes(na)||na.includes(aa))score+=4;if(tt===nb)score+=10;else if(tt.includes(nb)||nb.includes(tt))score+=5;return {a,score};}).sort((a,b)=>b.score-a.score);
  const hit=ranked.find(x=>x.a?.id&&x.score>=14)?.a || ranked.find(x=>x.a?.id&&x.score>=9)?.a;
  if(!hit?.id){const data={ok:false,error:"Album introuvable"};deezerPreviewCache.set(key,{expires:Date.now()+10*60*1000,data});return res.json(data);}
  const tr=new AbortController(); const timer2=setTimeout(()=>tr.abort(),8000);
  const rr=await fetch(`https://api.deezer.com/album/${hit.id}/tracks?limit=100`,{signal:tr.signal,headers:{Accept:"application/json"}});
  clearTimeout(timer2);
  if(!rr.ok)throw new Error(`Deezer HTTP ${rr.status}`);
  const td=await rr.json();
  const tracks=(Array.isArray(td?.data)?td.data:[]).map((t,i)=>({id:t.id,title:t.title||`Piste ${i+1}`,preview:t.preview||null,trackUrl:t.link||null,artist:t.artist?.name||artist,album:t.album?.title||album}));
  const data={ok:true,album:hit.title||album,tracks};
  deezerPreviewCache.set(key,{expires:Date.now()+30*60*1000,data});
  res.json(data);
 }catch(e){res.status(502).json({error:e?.name==="AbortError"?"Deezer trop lent":e.message||"Erreur Deezer"})}
});
app.get("/api/music/preview",async(req,res)=>{
 try{
  const artist=String(req.query.artist||"").trim(),album=String(req.query.album||"").trim();
  if(!artist||!album)return res.status(400).json({error:"artist et album requis"});
  const key="preview|"+normMusic(artist)+"|"+normMusic(album);
  const cached=deezerPreviewCache.get(key);
  if(cached && cached.expires>Date.now()) return res.json(cached.data);
  const q=encodeURIComponent(`${artist} ${album}`);
  const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),7000);
  const r=await fetch(`https://api.deezer.com/search?q=${q}&limit=25`,{signal:ac.signal,headers:{Accept:"application/json"}});
  clearTimeout(timer);
  if(!r.ok)throw new Error(`Deezer HTTP ${r.status}`);
  const d=await r.json(); const rows=Array.isArray(d?.data)?d.data:[];
  const na=normMusic(artist), nb=normMusic(album);
  const ranked=rows.map(t=>{const ta=normMusic(t?.artist?.name),tb=normMusic(t?.album?.title);let score=0;if(ta===na)score+=8;else if(ta.includes(na)||na.includes(ta))score+=4;if(tb===nb)score+=8;else if(tb.includes(nb)||nb.includes(tb))score+=4;if(t?.preview)score+=2;return {t,score};}).sort((a,b)=>b.score-a.score);
  const hit=ranked.find(x=>x.t?.preview && x.score>=12)?.t || ranked.find(x=>x.t?.preview && x.score>=8)?.t;
  if(!hit?.preview){const data={ok:false,error:"Aucun extrait disponible"};deezerPreviewCache.set(key,{expires:Date.now()+10*60*1000,data});return res.json(data);}
  const data={ok:true,preview:hit.preview,title:hit.title||"Extrait",trackUrl:hit.link||null,artist:hit.artist?.name||artist,album:hit.album?.title||album};
  deezerPreviewCache.set(key,{expires:Date.now()+30*60*1000,data});
  res.json(data);
 }catch(e){res.status(502).json({error:e?.name==="AbortError"?"Deezer trop lent":e.message||"Erreur Deezer"})}
});
app.get("/api/discover/profile",async(req,res)=>{try{const name=String(req.query.name||"").trim();const mbid=String(req.query.mbid||"").trim();if(!name&&!mbid)return res.status(400).json({error:"name ou mbid requis"});const p=await fetchArtistProfile({id:mbid||`discover-${name}`,name,mbid:mbid||null});res.json(p)}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/artists",requireAuth,async(req,res)=>{
 const name=String(req.body?.name||"").trim(),mbid=String(req.body?.mbid||"").trim(),photoUrl=String(req.body?.photoUrl||"").trim(),identitySource=String(req.body?.identitySource||"").trim(),identityKey=String(req.body?.identityKey||"").trim(),disambiguation=String(req.body?.disambiguation||"").trim(),country=String(req.body?.country||"").trim(),style=String(req.body?.style||"").trim(),identityLocked=Boolean(req.body?.identityLocked);if(!name&&!mbid)return res.status(400).json({error:"name ou mbid requis"});
 try{
  let r;
  // If the user selected a non-MusicBrainz metal identity, preserve that exact
  // selection. Do not resolve the plain name again and accidentally switch to
  // another homonymous artist.
  if(mbid){
   r=await resolveByMbid(mbid);
  }else{
   r={name,mbid:null,style:style||null,disambiguation:disambiguation||null,country:country||null};
  }
  const canonicalName=String(name||r?.name||'').trim()||name;
  const a=upsertArtist(canonicalName,r.mbid||null,style||r.style||null,{disambiguation:disambiguation||r.disambiguation||null,country:country||r.country||null,photoUrl:photoUrl||null,identitySource:identitySource||null,identityKey:identityKey||null,identityLocked:identityLocked,userId:req.user.id});
  if(String(req.body?.bandsintownUrl||"").trim()){const {setArtistSourceUrls}=await import("./db.js");setArtistSourceUrls(a.id,{bandsintownUrl:String(req.body.bandsintownUrl).trim()});}
  // Return immediately after saving the artist/photo. The full refresh (concerts,
  // lineup, news, etc.) can be slow and is not required to validate a simple
  // photo selection. Keep the existing refresh behaviour, but run it in the
  // background so the Add button is responsive.
  const savedArtist=getArtist(a.id);
  if(d1Enabled) await d1UpsertGroup(req.user.id,savedArtist);
  res.status(201).json({artist:savedArtist,report:null,refreshing:true});
  setTimeout(()=>{refreshArtist(a.id).catch(e=>console.error(`Background refresh failed for artist ${a.id}:`,e?.message||e))},0);
 }catch(e){res.status(502).json({error:e.message})}
});
app.patch("/api/artists/:id",requireAuth,async(req,res)=>{const id=Number(req.params.id),a=ownedArtist(req,id);if(!a)return res.status(404).json({error:"introuvable"});const style=req.body?.style===null?null:String(req.body?.style??"").trim()||null;const photoUrl=req.body?.photoUrl===null?null:String(req.body?.photoUrl??"").trim()||null;const description=req.body?.description===null?null:String(req.body?.description??"").trim()||null;const saved=updateArtist(id,{style,photoUrl,description});if(d1Enabled){try{await d1UpsertGroup(req.user.id,saved)}catch(e){console.error("D1 group update:",e?.message||e)}}res.json({artist:saved})});
app.delete("/api/artists/:id",requireAuth,async(req,res)=>{const id=Number(req.params.id),a=ownedArtist(req,id);if(!a)return res.status(404).json({error:"introuvable"});deleteArtist(id);if(d1Enabled)await d1DeleteGroup(req.user.id,a);res.status(204).end()});
app.post("/api/artists/:id/refresh",requireAuth,async(req,res)=>{try{if(!ownedArtist(req,req.params.id))return res.status(404).json({error:"introuvable"});res.json(await refreshArtist(Number(req.params.id)))}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/artists/:id/bandsintown-widget",requireAuth,(req,res)=>{try{const id=Number(req.params.id);const a=ownedArtist(req,id);if(!a)return res.status(404).json({error:"introuvable"});const rows=Array.isArray(req.body?.rows)?req.body.rows:[];const safe=rows.map(x=>({...x,provider:"Bandsintown"}));res.json({ok:true,count:mergeArtistEvents(id,safe)})}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/artists/:id/concert-sources",requireAuth,async(req,res)=>{try{const a=ownedArtist(req,req.params.id);if(!a)return res.status(404).json({error:"introuvable"});const [bandsintown,infoconcert]=await Promise.all([resolveBandsintown(a),resolveInfoConcert(a)]);res.json({artist:a.name,bandsintown,infoconcert})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/artists/:id/bandsintown-id",requireAuth,(req,res)=>{const a=ownedArtist(req,req.params.id);if(!a)return res.status(404).json({error:"introuvable"});res.json({id:bandsintownArtistId(a)})});
app.get("/api/radar",requireAuth,(req,res)=>res.json({warming:isWarming(req.user.id),enriching:isEnriching(req.user.id),items:newsList({artistId:req.query.artistId?Number(req.query.artistId):undefined,userId:req.user.id,limit:Math.min(Number(req.query.limit||500),1000)})}));
app.get("/api/live",requireAuth,(req,res)=>res.json({warming:isWarming(req.user.id),items:eventList({artistId:req.query.artistId?Number(req.query.artistId):undefined,userId:req.user.id,country:String(req.query.country||"").trim()||undefined,limit:Math.min(Number(req.query.limit||500),1000)})}));
// "Mon agenda": concerts marked "J'y vais" / "Intéressé" by the user (D1, all devices).
// Without D1 (local runs) they are kept in memory.
const localAgenda=new Map();
const AGENDA_STATUS=new Set(["going","interested"]);
function agendaData(x){const o=x&&typeof x==="object"?x:{};const pick=k=>String(o[k]??"").slice(0,300);return {title:pick("title"),artist:pick("artist"),date:pick("date").slice(0,25),time:pick("time"),venue:pick("venue"),city:pick("city"),country:pick("country"),url:pick("url"),provider:pick("provider")}}
app.get("/api/agenda",requireAuth,async(req,res)=>{try{const rows=d1Enabled?await d1ListUserConcerts(req.user.id):[...(localAgenda.get(req.user.id)||new Map()).values()];res.json({items:rows.map(r=>({key:r.ckey,status:r.status,data:typeof r.data==="string"?JSON.parse(r.data||"{}"):r.data||{},updatedAt:r.updated_at}))})}catch(e){res.status(502).json({error:e.message})}});
app.put("/api/agenda",requireAuth,async(req,res)=>{try{const key=String(req.body?.key||"").trim().slice(0,200),status=String(req.body?.status||"");if(!key||!AGENDA_STATUS.has(status))return res.status(400).json({error:"Concert ou statut invalide"});const data=agendaData(req.body?.data);if(d1Enabled)await d1SetUserConcert(req.user.id,key,status,data);else{if(!localAgenda.has(req.user.id))localAgenda.set(req.user.id,new Map());localAgenda.get(req.user.id).set(key,{ckey:key,status,data,updated_at:new Date().toISOString()})}res.json({ok:true,key,status})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/agenda",requireAuth,async(req,res)=>{try{const key=String(req.query.key||req.body?.key||"").trim();if(!key)return res.status(400).json({error:"Concert manquant"});if(d1Enabled)await d1DeleteUserConcert(req.user.id,key);else localAgenda.get(req.user.id)?.delete(key);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
// ---- Friends: see which concerts friends marked "J'y vais" / "Intéressé" ----
app.get("/api/friends",requireAuth,async(req,res)=>{try{const me=req.user.id,out={friends:[],incoming:[],outgoing:[]};for(const r of await d1ListFriendships(me)){const u={id:Number(r.other_id),username:r.other_name};if(r.status==="accepted")out.friends.push(u);else if(Number(r.addressee_id)===me)out.incoming.push(u);else out.outgoing.push(u)}const by=(a,b)=>a.username.localeCompare(b.username,"fr",{sensitivity:"base"});out.friends.sort(by);out.incoming.sort(by);out.outgoing.sort(by);res.json(out)}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/friends",requireAuth,async(req,res)=>{try{const name=String(req.body?.username||"").trim();if(!name)return res.status(400).json({error:"Nom d’utilisateur manquant"});const other=await d1FindUserByUsername(name);if(!other)return res.status(404).json({error:`Aucun compte STAYLOUD « ${name.slice(0,40)} »`});if(other.id===req.user.id)return res.status(400).json({error:"C’est ton propre compte 🙂"});const status=await d1RequestFriend(req.user.id,other.id);res.json({ok:true,status,user:{id:other.id,username:other.username}})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/friends/:id/accept",requireAuth,async(req,res)=>{try{const ok=await d1AcceptFriend(req.user.id,Number(req.params.id));if(!ok)return res.status(404).json({error:"Demande introuvable"});res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/friends/:id",requireAuth,async(req,res)=>{try{await d1RemoveFriend(req.user.id,Number(req.params.id));res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/friends/agenda",requireAuth,async(req,res)=>{try{const rows=await d1FriendsConcerts(req.user.id);res.json({items:rows.map(r=>({key:r.ckey,status:r.status,user:{id:Number(r.user_id),username:r.username},data:typeof r.data==="string"?JSON.parse(r.data||"{}"):r.data||{}}))})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/providers/status",(_,res)=>res.json({providers:runStatus()}));
app.get("/api/discover/location",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});const p=await geocodeQuery(q);if(!p)return res.status(404).json({error:"position introuvable"});res.json(p)}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/city-concerts",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});res.json(await discoverManualCityConcerts(q));}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/resolve-city",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});const p=await geocodeQuery(q);if(!p)return res.status(404).json({error:`ville introuvable : ${q}`});res.json({city:q,resolvedCity:p.resolved_city||q,country:p.country||"France",lat:p.lat,lon:p.lon,display_name:p.display_name||`${q}, France`,resolvedCityVerified:true});}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/reverse",async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});try{const {reverseCity}=await import("./providers/discovery.js");res.json(await reverseCity(lat,lon))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/artists",async(req,res)=>{try{const style=String(req.query.style||"all");const limit=Math.min(Number(req.query.limit||18),30);const page=Math.max(0,Math.min(Number(req.query.page)||0,50));res.json(await discoverArtists(style,limit,page))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/festivals",async(req,res)=>{let lat=Number(req.query.lat),lon=Number(req.query.lon),radius=Number(req.query.radius||75);const targetCity=String(req.query.targetCity||req.query.city||"").trim();const place={city:targetCity,locality:String(req.query.locality||"").trim(),municipality:String(req.query.municipality||"").trim(),county:String(req.query.county||"").trim(),state:String(req.query.state||"").trim(),country:String(req.query.country||"").trim(),manualTarget:Boolean(targetCity),targetLat:Number(req.query.targetLat),targetLon:Number(req.query.targetLon),resolvedCityVerified:String(req.query.resolvedCityVerified||"")==='1'};try{if(targetCity){const g=await geocodeQuery(targetCity);if(!g)throw new Error(`Ville introuvable : ${targetCity}`);lat=g.lat;lon=g.lon;place.city=g.city||targetCity;place.lat=g.lat;place.lon=g.lon;place.country=g.country||"France"}else if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});res.json(await discoverNearbyFestivals(lat,lon,Math.min(Math.max(radius,5),100),place.city||place.country?place:null))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/concerts",async(req,res)=>{let lat=Number(req.query.lat),lon=Number(req.query.lon),radius=Number(req.query.radius||75);const targetCity=String(req.query.targetCity||req.query.city||"").trim();const place={city:targetCity,locality:String(req.query.locality||"").trim(),municipality:String(req.query.municipality||"").trim(),county:String(req.query.county||"").trim(),state:String(req.query.state||"").trim(),country:String(req.query.country||"").trim(),manualTarget:Boolean(targetCity),targetLat:Number(req.query.targetLat),targetLon:Number(req.query.targetLon),resolvedCityVerified:String(req.query.resolvedCityVerified||"")==='1'};try{if(targetCity){const g=await geocodeQuery(targetCity);if(!g)throw new Error(`Ville introuvable : ${targetCity}`);lat=g.lat;lon=g.lon;place.city=g.city||targetCity;place.lat=g.lat;place.lon=g.lon;place.country=g.country||"France"}else if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});const r=Math.min(Math.max(radius,5),100);const out=await discoverNearbyConcerts(lat,lon,r,place.city||place.country?place:null);try{const user=await optionalUser(req);if(user){const followed=eventList({userId:user.id});const base=Number.isFinite(Number(out?.place?.lat))?out.place:{lat,lon};out.items=await mergeFollowedConcerts(out.items,followed,Number(base.lat),Number(base.lon),r)}}catch(e){console.error('Followed concerts merge:',e?.message||e)}res.json(out)}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/live/sources",(_,res)=>res.json({sources:[{name:"Bandsintown",type:"artist-calendar",free:true,configured:true},{name:"InfoConcert",type:"artist-calendar",free:true,configured:true},{name:"LineupDiscovery",type:"event-lineup-discovery",free:true,configured:true}]}));

// An error in a background job or an async route must never bring the whole
// server down (a restart empties the local cache of news and concerts).
process.on('unhandledRejection',e=>console.error('Unhandled rejection:',e?.message||e));
process.on('uncaughtException',e=>console.error('Uncaught exception:',e?.message||e));
const port=Number(process.env.PORT||8787);
const d1Status=d1ConfigStatus();
console.log(`D1 configuration: account=${d1Status.accountId}(${d1Status.accountIdLength}) database=${d1Status.databaseId}(${d1Status.databaseIdLength}) token=${d1Status.apiToken}(${d1Status.apiTokenLength})`);
try{
  if(d1Enabled){
    await bootstrapD1();
    warmGeoCache().then(n=>console.log(`Geo cache: ${n} lieux chargés depuis D1`));
    console.log("D1 connecté — schéma initialisé");
  }else{
    console.error("D1 configuration incomplète — aucune valeur secrète n'est affichée");
  }
}catch(e){console.error("D1 bootstrap error:",e?.message||e)}
app.listen(port,()=>{console.log(`Music Radar V2: http://localhost:${port}`);setTimeout(()=>refreshAll().catch(e=>console.error(e)),500)});
cron.schedule(process.env.REFRESH_CRON||"7 */2 * * *",()=>refreshAll().catch(e=>console.error(e)));
