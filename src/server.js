import crypto from "node:crypto";
import express from "express";
import compression from "compression";
import cron from "node-cron";
import {d1GetCacheValue,d1SetCacheValue,d1ListUserConcerts,d1SetUserConcert,d1DeleteUserConcert,d1FindUserByUsername,d1ListFriendships,d1RequestFriend,d1AcceptFriend,d1RemoveFriend,d1FriendsConcerts,d1GetFriendsSeen,d1SetFriendsSeen,d1ShareBand,d1SharesFor,d1SharesHistory,d1HideShare,d1CalendarToken,d1UserByCalendarToken,d1AlertSeenKeys,d1MarkAlertsSeen,d1BlockUser,d1UnblockUser,d1ListBlocks,d1BlockedBetween,d1DeleteAccount,d1AddCommunityConcert,d1CountRecentCommunity,d1MyCommunityConcerts,d1AllCommunityConcerts,d1ApprovedCommunityConcerts,d1CountPendingCommunity,d1SetCommunityStatus,d1DeleteCommunityConcert,d1FirstUserId,d1AddSupportMessage,d1CountRecentSupport,d1MySupportMessages,d1MarkRepliesSeen,d1AllSupportMessages,d1SupportCounts,d1MarkSupportRead,d1ReplySupport,d1DeleteSupport} from "./d1.js";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getArtists,getArtist,upsertArtist,updateArtist,deleteArtist,newsList,eventList,runStatus,mergeArtistEvents,upsertLocalUserMirror,deleteLocalUser,localUsers,localArtistsForUser,bandKey,importArtistNews,importArtistEvents} from "./db.js";
import {d1GetBandCache,d1Enabled,d1ConfigStatus,ensureD1Schema,d1CreateUser,d1AuthenticateUser,d1FindUserByEmail,d1UpdateUserEmail,d1CreateSession,d1GetSession,d1DeleteSession,d1CreatePasswordReset,d1ConsumePasswordReset,d1UpsertGroup,d1DeleteGroup,d1ListGroups,d1MigrateLocalUser} from "./d1.js";
import {artistReleaseGroups,resolve,resolveByMbid,searchArtistCandidates,fetchArtistProfile,discoverArtistPhoto,discoverArtistPhotos} from "./providers/musicbrainz.js";
import {refreshArtist,refreshAll,refreshArtistNews,refreshArtistConcerts,enrichArtistNews,enrichNewsItems} from "./aggregator.js";
import {bandsintownArtistId,resolveBandsintown,resolveInfoConcert} from "./providers/concert-web.js";
import {cachedJson} from "./apicache.js";
import {findTickets,ticketmasterConfigured,bandActivity} from "./providers/tickets.js";
import {CLIP_ID,clipMeta,clipPageHTML} from "./clippage.js";
import {findSetlist,searchSetlists,setlistConfigured} from "./providers/setlistfm.js";
import {bandVideos,videoFeed,youtubeConfigured,PrefetchSkipped} from "./providers/youtube.js";
import {makeLimiter,waitText} from "./ratelimit.js";
import {runDailyCheck,lastDailyCheck,setMonitorSink} from "./monitor.js";
import {setAlertSink,sourcesHealth} from "./health.js";
import {recentAlbums,pickNew} from "./alerts.js";
import {vevent,calendar,validConcert} from "./ics.js";
import {radioStations,radioByIds,radioNowPlaying,radioClick,RADIO_STYLES} from "./providers/radio.js";
import {warmGeoCache,discoverArtists,discoverNearbyConcerts,discoverNearbyFestivals,geocodeQuery,discoverManualCityConcerts,mergeFollowedConcerts,mergeCommunityConcerts,rowsNear,testSources,findInSources,locateCities} from "./providers/discovery.js";

const app=express();app.set("trust proxy",1);app.use(compression());app.use(express.json({limit:"10mb"}));
const dir=path.dirname(fileURLToPath(import.meta.url));app.use(express.static(path.join(dir,"../public"),{etag:false,lastModified:false,setHeaders:(res,filePath)=>{if(filePath.endsWith(".html"))res.setHeader("Cache-Control","no-store");else if(/\.(png|jpe?g|webp|svg|ico)$/i.test(filePath))res.setHeader("Cache-Control","public, max-age=604800");}}));

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
// Each API call used to cost two Cloudflare D1 round trips (session lookup
// + full group restore). Sessions are cached in memory for a few minutes and
// a user's groups are restored from D1 once per server process (writes keep
// the local copy and D1 in sync afterwards).
const SESSION_CACHE_MS=5*60e3,sessionCache=new Map(),restoredUsers=new Map();
async function sessionUser(token){
 if(!token||!d1Enabled)return null;
 const hit=sessionCache.get(token);
 if(hit&&Date.now()-hit.at<SESSION_CACHE_MS)return hit.user;
 const user=await d1GetSession(token);
 if(user){sessionCache.set(token,{user,at:Date.now()});if(sessionCache.size>2000)sessionCache.delete(sessionCache.keys().next().value)}else sessionCache.delete(token);
 return user;
}
function ensureUserRestored(userId){
 const uid=Number(userId);let p=restoredUsers.get(uid);
 if(!p){p=restoreUserGroups(uid).catch(e=>{restoredUsers.delete(uid);throw e});restoredUsers.set(uid,p)}
 return p;
}
// Signed-in user when there is one (public endpoints that personalise results).
async function optionalUser(req){try{const user=await sessionUser(parseCookies(req).stayloud_session);if(user){upsertLocalUserMirror(user);await ensureUserRestored(user.id)}return user||null}catch{return null}}
async function requireAuth(req,res,next){try{const user=await sessionUser(parseCookies(req).stayloud_session);if(!user)return res.status(401).json({error:'Connexion requise'});upsertLocalUserMirror(user);await ensureUserRestored(user.id);warmUserArtists(user.id);req.user=user;next()}catch(e){console.error('Auth:',e?.message||e);res.status(503).json({error:'Service de comptes indisponible'})}}
function ownedArtist(req,id){return getArtist(Number(id),req.user.id)}
// Password guessing / e-mail abuse protection (per IP and per account name).
const loginFailsUser=makeLimiter({max:8,windowMs:15*60e3}),loginFailsIp=makeLimiter({max:30,windowMs:15*60e3});
const registerIp=makeLimiter({max:5,windowMs:3600e3}),forgotIp=makeLimiter({max:5,windowMs:3600e3}),forgotEmail=makeLimiter({max:3,windowMs:3600e3}),deleteFails=makeLimiter({max:5,windowMs:15*60e3});
const clientIp=req=>String(req.ip||req.socket?.remoteAddress||"?");
function tooMany(res,sec,what){res.set("Retry-After",String(sec));return res.status(429).json({error:`Trop de ${what}. Réessaie dans ${waitText(sec)}.`})}
app.post('/api/auth/register',async(req,res)=>{
 try{
  if(!d1Enabled)return res.status(503).json({error:'D1 n’est pas configuré sur le serveur'});
  const ip=clientIp(req);if(!registerIp.allowed(ip))return tooMany(res,registerIp.retryAfter(ip),'créations de compte');registerIp.add(ip);
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
  const ip=clientIp(req),who=String(req.body?.username||'').trim().toLowerCase().slice(0,120);
  if(!loginFailsUser.allowed(who))return tooMany(res,loginFailsUser.retryAfter(who),'essais de mot de passe pour ce compte');
  if(!loginFailsIp.allowed(ip))return tooMany(res,loginFailsIp.retryAfter(ip),'essais de connexion');
  const user=await d1AuthenticateUser(req.body?.username,req.body?.password);
  if(!user){loginFailsUser.add(who);loginFailsIp.add(ip);return res.status(401).json({error:'Nom d’utilisateur ou mot de passe incorrect'})}
  loginFailsUser.reset(who);
  upsertLocalUserMirror(user); restoredUsers.delete(Number(user.id)); await ensureUserRestored(user.id);
  const session=await d1CreateSession(user.id); setSessionCookie(res,session.token); res.json({user});
 }catch(e){res.status(503).json({error:e.message||'Connexion impossible'})}
});
app.post('/api/auth/logout',async(req,res)=>{
 try{sessionCache.delete(parseCookies(req).stayloud_session);if(d1Enabled)await d1DeleteSession(parseCookies(req).stayloud_session);}catch(e){console.error('Logout:',e?.message||e)}
 clearSessionCookie(res); res.status(204).end();
});
// "Supprimer mon compte" (required by the App Store and Google Play): the
// password is asked again, then every row of the user is erased.
app.post('/api/auth/delete-account',requireAuth,async(req,res)=>{
 try{
  const dk='u'+req.user.id;if(!deleteFails.allowed(dk))return tooMany(res,deleteFails.retryAfter(dk),'essais de mot de passe');
  const u=await d1AuthenticateUser(req.user.username,String(req.body?.password||''));
  if(!u||Number(u.id)!==Number(req.user.id)){deleteFails.add(dk);return res.status(403).json({error:'Mot de passe incorrect'})}
  const id=Number(req.user.id);
  await d1DeleteAccount(id);
  try{deleteLocalUser(id)}catch(e){console.error('Local account delete:',e?.message||e)}
  for(const [k,v] of sessionCache)if(Number(v?.user?.id)===id)sessionCache.delete(k);
  restoredUsers.delete(id);communityCache=null;
  clearSessionCookie(res);res.json({ok:true});
 }catch(e){res.status(502).json({error:e.message||'Suppression impossible'})}
});
app.get('/api/auth/me',async(req,res)=>{
 try{
  if(!d1Enabled)return res.status(401).json({error:'Non connecté'});
  const user=await sessionUser(parseCookies(req).stayloud_session);
  if(!user)return res.status(401).json({error:'Non connecté'});
  upsertLocalUserMirror(user); await ensureUserRestored(user.id); res.json({user});
 }catch(e){res.status(503).json({error:'Service de comptes indisponible'})}
});
app.patch('/api/auth/email',requireAuth,async(req,res)=>{
 try{const user=await d1UpdateUserEmail(req.user.id,req.body?.email);upsertLocalUserMirror(user);res.json({user});}
 catch(e){const msg=String(e?.message||e);res.status(400).json({error:/unique|constraint/i.test(msg)?'Adresse e-mail déjà utilisée':msg})}
});
app.post('/api/auth/forgot-password',async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase();
 const generic='Si cette adresse correspond à un compte STAYPIT, un e-mail avec votre nom d’utilisateur et un lien pour changer de mot de passe va être envoyé.';
 try{
  if(!/^\S+@\S+\.\S+$/.test(email))return res.json({ok:true,message:generic});
  if(!d1Enabled)return res.status(503).json({error:'La récupération par e-mail doit être configurée sur le serveur avec D1.'});
  const ip=clientIp(req);if(!forgotIp.allowed(ip))return tooMany(res,forgotIp.retryAfter(ip),'demandes de récupération');forgotIp.add(ip);
  // Same answer as a normal request: never reveal whether the address exists.
  if(!forgotEmail.allowed(email))return res.json({ok:true,message:generic});forgotEmail.add(email);
  const user=await d1FindUserByEmail(email); if(!user)return res.json({ok:true,message:generic});
  const {token}=await d1CreatePasswordReset(user.id);
  const base=String(process.env.APP_PUBLIC_URL||'').replace(/\/$/,'');
  if(!base)return res.status(503).json({error:'La récupération par e-mail doit être configurée sur le serveur (APP_PUBLIC_URL).'});
  const apiKey=String(process.env.RESEND_API_KEY||'').trim(), from=String(process.env.EMAIL_FROM||'').trim();
  if(!apiKey||!from)return res.status(503).json({error:'La récupération par e-mail doit être configurée sur le serveur (RESEND_API_KEY et EMAIL_FROM).'});
  const resetUrl=base+'/?reset='+encodeURIComponent(token);
  // One e-mail covers both "forgot password" and "forgot username".
  const safeName=String(user.username||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=`<div style="background:#050607;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#e8ebee"><div style="max-width:480px;margin:0 auto;background:#0d1116;border:1px solid #2a333d;border-radius:14px;overflow:hidden">${base?`<img src="${base}/staypit-banner.png" alt="STAYPIT Radar Metal" width="480" style="display:block;width:100%;height:auto">`:''}<div style="padding:22px"><p style="margin:0 0 14px">Bonjour,</p><p style="margin:0 0 6px">Votre nom d’utilisateur STAYPIT :</p><p style="margin:0 0 18px;font-size:22px;font-weight:bold;color:#ff2733">${safeName}</p><p style="margin:0 0 16px">Pour choisir un nouveau mot de passe :</p><p style="margin:0 0 18px"><a href="${resetUrl}" style="display:inline-block;background:#e50914;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">Choisir un nouveau mot de passe</a></p><p style="margin:0 0 8px;font-size:13px;color:#9aa3ad">Ce lien expire dans 30 minutes et ne peut être utilisé qu’une seule fois. Vous pouvez aussi vous connecter avec votre adresse e-mail à la place du nom d’utilisateur.</p><p style="margin:0;font-size:13px;color:#9aa3ad">Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail.</p></div></div></div>`;
  const rr=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[user.email],subject:'STAYPIT — vos identifiants',html})});
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

app.get("/api/health",(_,res)=>res.json({ok:true,version:"7.37.0",mode:"manual-city-source-selection",d1:d1ConfigStatus()}));
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
// Best Deezer album match for "artist + album" (public Deezer API, no key).
// Deezer public API: max ~50 requests / 5 s per server IP. Over the quota it
// answers HTTP 200 with {error:{code:4}}; that used to be read as "album not
// found" and cached. Calls are spaced out, quota errors are retried once and
// never cached as a miss.
let deezerGate=Promise.resolve();
function deezerSlot(){const p=deezerGate.then(()=>new Promise(r=>setTimeout(r,180)));deezerGate=p.catch(()=>{});return p}
// Album / artist searches carry no expiring preview links: their answers are
// shared by every user for 3 days (6 h when Deezer found nothing), see apicache.js.
function deezerJson(url,tries=2){
 if(!/api\.deezer\.com\/(search\/(album|artist)\?|artist\/\d+\/albums)/.test(url))return deezerJsonLive(url,tries);
 return cachedJson('dz:'+url,d=>Array.isArray(d?.data)&&d.data.length?3*864e5:6*3600e3,()=>deezerJsonLive(url,tries));
}
async function deezerJsonLive(url,tries=2){
 for(let i=0;i<tries;i++){
  await deezerSlot();
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8000);
  try{
   const r=await fetch(url,{signal:ac.signal,headers:{Accept:"application/json"}});
   if(!r.ok)throw new Error(`Deezer HTTP ${r.status}`);
   const d=await r.json();
   if(d?.error){if(i<tries-1){await new Promise(r=>setTimeout(r,1500));continue}throw new Error("Deezer momentanément saturé")}
   return d;
  }catch(e){if(i>=tries-1)throw e;await new Promise(r=>setTimeout(r,800))}
  finally{clearTimeout(timer)}
 }
}
const deezerAlbumHits=new Map();
// Album titles differ between MusicBrainz and Deezer ("… - Live Act" vs
// "… (Live)", "Deluxe", "Remastered", self-titled albums…). Compare cleaned
// titles by words, and when the free-text search finds nothing, fall back to
// the artist's own album list on Deezer.
function cleanAlbumTitle(t){return normMusic(String(t||"").replace(/\(([^)]*)\)|\[([^\]]*)\]/g," $1$2 ").replace(/\b(deluxe|remaster(ed)?|edition|version|expanded|anniversary|bonus|tracks?|reissue|explicit)\b/gi," "))}
function albumTitleScore(a,b){const x=cleanAlbumTitle(a),y=cleanAlbumTitle(b);if(!x||!y)return 0;if(x===y)return 10;if(x.includes(y)||y.includes(x))return 7;
 const A=new Set(x.split(" ")),B=new Set(y.split(" "));let n=0;for(const w of A)if(B.has(w))n++;const j=n/new Set([...A,...B]).size;return j>=0.6?6:j>=0.4?4:0}
function artistMatch(a,b){const x=normMusic(a),y=normMusic(b);if(!x||!y)return 0;if(x===y)return 8;if(x.includes(y)||y.includes(x))return 4;return 0}
function bestDeezerAlbum(rows,artist,album,{sameArtist=false,knownArtist=false}={}){
 const ranked=rows.map(a=>{const am=knownArtist?8:artistMatch(a?.artist?.name,artist),tm=albumTitleScore(a?.title,album);return {a,am,tm,score:am+tm}}).filter(x=>x.a?.id&&x.tm>0&&(!sameArtist||x.am>0)).sort((p,q)=>q.score-p.score||(q.tm-p.tm));
 const top=ranked[0];if(!top)return null;
 if(top.am>0&&top.tm>=4)return top.a;
 if(!sameArtist&&top.tm>=10)return top.a;
 return null;
}
async function findDeezerAlbum(artist,album,{sameArtist=false}={}){
 const key=(sameArtist?"s|":"a|")+normMusic(artist)+"|"+normMusic(album),mem=deezerAlbumHits.get(key);
 if(mem&&mem.until>Date.now())return mem.hit;
 let hit=null;
 const d=await deezerJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(`${artist} ${album}`)}&limit=25`);
 const rows=Array.isArray(d?.data)?d.data:[];
 hit=bestDeezerAlbum(rows,artist,album,{sameArtist:true});
 if(!hit){
  // Fallback: the artist's discography on Deezer.
  const sa=await deezerJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=5`);
  const arts=(Array.isArray(sa?.data)?sa.data:[]).filter(x=>x?.id&&artistMatch(x.name,artist)>0).sort((p,q)=>artistMatch(q.name,artist)-artistMatch(p.name,artist)||(Number(q.nb_fan||0)-Number(p.nb_fan||0)));
  if(arts[0]){const al=await deezerJson(`https://api.deezer.com/artist/${arts[0].id}/albums?limit=200`);hit=bestDeezerAlbum(Array.isArray(al?.data)?al.data:[],artist,album,{knownArtist:true})}
 }
 // Last resort for previews only: same exact title by another credited artist.
 if(!hit&&!sameArtist)hit=bestDeezerAlbum(rows,artist,album);
 deezerAlbumHits.set(key,{hit,until:Date.now()+(hit?24*3600e3:10*60e3)});if(deezerAlbumHits.size>3000)deezerAlbumHits.delete(deezerAlbumHits.keys().next().value);
 return hit;
}
// Direct album links: Deezer from its API, Spotify through Odesli (song.link,
// free, ~10 requests/min). Results are kept in D1 so each album is looked up
// once; the buttons fall back to a search page until a link is known.
const albumLinkMem=new Map();let odesliChain=Promise.resolve(),odesliWaiting=0;
function odesliSpotify(deezerUrl){
 if(odesliWaiting>=6)return Promise.resolve(undefined);
 odesliWaiting++;
 const job=odesliChain.then(async()=>{
  try{
   const ac=new AbortController(),t=setTimeout(()=>ac.abort(),9000);
   try{
    const r=await fetch(`https://api.song.link/v1-alpha.1/links?userCountry=FR&url=${encodeURIComponent(deezerUrl)}`,{signal:ac.signal,headers:{Accept:"application/json"}});
    if(r.status===429)return undefined;
    if(!r.ok)return null;
    const d=await r.json();const u=String(d?.linksByPlatform?.spotify?.url||"");
    return /^https:\/\/open\.spotify\.com\//.test(u)?u:null;
   }finally{clearTimeout(t)}
  }catch{return undefined}
  finally{odesliWaiting--}
 });
 // Next lookup at least 6.5 s later (Odesli allows ~10 requests per minute).
 odesliChain=job.catch(()=>{}).then(()=>new Promise(r=>setTimeout(r,6500)));
 return job;
}
async function albumLinks(artist,album){
 const key="albumlink|"+normMusic(artist)+"|"+normMusic(album);
 const mem=albumLinkMem.get(key);if(mem&&mem.until>Date.now())return mem.v;
 let v=d1Enabled?await d1GetCacheValue(key).catch(()=>null):null;
 const fresh=v&&(v.spotify||Date.now()-Number(v.at||0)<24*3600e3);
 if(!fresh){
  const hit=await findDeezerAlbum(artist,album,{sameArtist:true}).catch(()=>null);
  const deezer=hit?.id?`https://www.deezer.com/album/${hit.id}`:(v?.deezer||null);
  let spotify=v?.spotify||null;
  if(deezer&&!spotify){const sp=await odesliSpotify(deezer);if(sp===undefined){v={deezer,spotify:null,at:0};albumLinkMem.set(key,{v,until:Date.now()+60e3});return v}spotify=sp}
  v={deezer,spotify,at:Date.now()};
  if(d1Enabled&&(deezer||spotify))d1SetCacheValue(key,v).catch(()=>{});
 }
 albumLinkMem.set(key,{v,until:Date.now()+6*3600e3});if(albumLinkMem.size>3000)albumLinkMem.delete(albumLinkMem.keys().next().value);
 return v;
}
app.get("/api/music/album-links",async(req,res)=>{try{const artist=String(req.query.artist||"").trim().slice(0,120),album=String(req.query.album||"").trim().slice(0,160);if(!artist||!album)return res.status(400).json({error:"artist et album requis"});const v=await albumLinks(artist,album);res.json({deezer:v?.deezer||null,spotify:v?.spotify||null})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/music/album-tracks",async(req,res)=>{
 try{
  const artist=String(req.query.artist||"").trim(),album=String(req.query.album||"").trim();
  if(!artist||!album)return res.status(400).json({error:"artist et album requis"});
  const key="tracks|"+normMusic(artist)+"|"+normMusic(album);
  const cached=deezerPreviewCache.get(key);
  if(cached && cached.expires>Date.now()) return res.json(cached.data);
  const hit=await findDeezerAlbum(artist,album);
  if(!hit?.id){const data={ok:false,error:"Album introuvable"};deezerPreviewCache.set(key,{expires:Date.now()+10*60*1000,data});return res.json(data);}
  const td=await deezerJson(`https://api.deezer.com/album/${hit.id}/tracks?limit=100`);
  const tracks=(Array.isArray(td?.data)?td.data:[]).map((t,i)=>({id:t.id,title:t.title||`Piste ${i+1}`,preview:t.preview||null,trackUrl:t.link||null,artist:t.artist?.name||artist,album:t.album?.title||album}));
  if(!tracks.length)return res.status(502).json({error:"Pistes indisponibles pour le moment"});
  const data={ok:true,album:hit.title||album,tracks};
  // Deezer preview URLs are signed and expire: keep them only a few minutes.
  deezerPreviewCache.set(key,{expires:Date.now()+10*60*1000,data});
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
  const d=await deezerJson(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${album}`)}&limit=25`); const rows=Array.isArray(d?.data)?d.data:[];
  const na=normMusic(artist), nb=normMusic(album);
  const ranked=rows.map(t=>{const ta=normMusic(t?.artist?.name),tb=normMusic(t?.album?.title);let score=0;if(ta===na)score+=8;else if(ta.includes(na)||na.includes(ta))score+=4;if(tb===nb)score+=8;else if(tb.includes(nb)||nb.includes(tb))score+=4;if(t?.preview)score+=2;return {t,score};}).sort((a,b)=>b.score-a.score);
  const hit=ranked.find(x=>x.t?.preview && x.score>=12)?.t || ranked.find(x=>x.t?.preview && x.score>=8)?.t;
  if(!hit?.preview){const data={ok:false,error:"Aucun extrait disponible"};deezerPreviewCache.set(key,{expires:Date.now()+10*60*1000,data});return res.json(data);}
  const data={ok:true,preview:hit.preview,title:hit.title||"Extrait",trackUrl:hit.link||null,artist:hit.artist?.name||artist,album:hit.album?.title||album};
  deezerPreviewCache.set(key,{expires:Date.now()+10*60*1000,data});
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
function agendaData(x){const o=x&&typeof x==="object"?x:{};const pick=k=>String(o[k]??"").slice(0,300);return {title:pick("title"),artist:pick("artist"),date:pick("date").slice(0,25),time:pick("time"),venue:pick("venue"),city:pick("city"),country:pick("country"),url:pick("url"),provider:pick("provider"),setlistId:pick("setlistId").slice(0,20)}}
app.get("/api/agenda",requireAuth,async(req,res)=>{try{const rows=d1Enabled?await d1ListUserConcerts(req.user.id):[...(localAgenda.get(req.user.id)||new Map()).values()];res.json({items:rows.map(r=>({key:r.ckey,status:r.status,data:typeof r.data==="string"?JSON.parse(r.data||"{}"):r.data||{},updatedAt:r.updated_at}))})}catch(e){res.status(502).json({error:e.message})}});
app.put("/api/agenda",requireAuth,async(req,res)=>{try{const key=String(req.body?.key||"").trim().slice(0,200),status=String(req.body?.status||"");if(!key||!AGENDA_STATUS.has(status))return res.status(400).json({error:"Concert ou statut invalide"});const data=agendaData(req.body?.data);if(d1Enabled)await d1SetUserConcert(req.user.id,key,status,data);else{if(!localAgenda.has(req.user.id))localAgenda.set(req.user.id,new Map());localAgenda.get(req.user.id).set(key,{ckey:key,status,data,updated_at:new Date().toISOString()})}res.json({ok:true,key,status})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/agenda",requireAuth,async(req,res)=>{try{const key=String(req.query.key||req.body?.key||"").trim();if(!key)return res.status(400).json({error:"Concert manquant"});if(d1Enabled)await d1DeleteUserConcert(req.user.id,key);else localAgenda.get(req.user.id)?.delete(key);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
// ---- Friends: see which concerts friends marked "J'y vais" / "Intéressé" ----
app.get("/api/friends",requireAuth,async(req,res)=>{try{const me=req.user.id,out={friends:[],incoming:[],outgoing:[]};for(const r of await d1ListFriendships(me)){const u={id:Number(r.other_id),username:r.other_name};if(r.status==="accepted")out.friends.push(u);else if(Number(r.addressee_id)===me)out.incoming.push(u);else out.outgoing.push(u)}const by=(a,b)=>a.username.localeCompare(b.username,"fr",{sensitivity:"base"});out.friends.sort(by);out.incoming.sort(by);out.outgoing.sort(by);res.json(out)}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/friends",requireAuth,async(req,res)=>{try{const name=String(req.body?.username||"").trim();if(!name)return res.status(400).json({error:"Nom d’utilisateur manquant"});const other=await d1FindUserByUsername(name);if(!other)return res.status(404).json({error:`Aucun compte STAYPIT « ${name.slice(0,40)} »`});if(other.id===req.user.id)return res.status(400).json({error:"C’est ton propre compte 🙂"});if(await d1BlockedBetween(req.user.id,other.id))return res.status(403).json({error:"Impossible d’ajouter ce compte"});const status=await d1RequestFriend(req.user.id,other.id);res.json({ok:true,status,user:{id:other.id,username:other.username}})}catch(e){res.status(502).json({error:e.message})}});
// Block / report (App Store & Google Play rules for content made by members).
app.get("/api/blocks",requireAuth,async(req,res)=>{try{res.json({items:(await d1ListBlocks(req.user.id)).map(r=>({id:Number(r.id),username:r.username}))})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/blocks/:id",requireAuth,async(req,res)=>{try{const other=Number(req.params.id);if(!other||other===req.user.id)return res.status(400).json({error:"Compte invalide"});await d1BlockUser(req.user.id,other);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/blocks/:id",requireAuth,async(req,res)=>{try{await d1UnblockUser(req.user.id,Number(req.params.id));res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/reports",requireAuth,async(req,res)=>{try{const b=req.body||{},t=(k,n)=>String(b[k]??"").replace(/\s+/g," ").trim().slice(0,n);
 const reason=t("reason",60)||"Autre",details=t("details",1000),content=t("content",600),kind=t("kind",20)||"utilisateur",target=t("targetName",40);
 if(await d1CountRecentSupport(req.user.id,new Date(Date.now()-3600e3).toISOString())>=5)return res.status(429).json({error:"Trop de messages en peu de temps, réessaie dans une heure"});
 const msg=[`Signalement : ${kind}${target?` de « ${target} »`:""}${b.targetId?` (compte n°${Number(b.targetId)||"?"})`:""}`,`Motif : ${reason}`,content?`Contenu : ${content}`:"",details?`Précisions : ${details}`:""].filter(Boolean).join("\n");
 await d1AddSupportMessage(req.user.id,"Signalement",msg);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/friends/:id/accept",requireAuth,async(req,res)=>{try{const ok=await d1AcceptFriend(req.user.id,Number(req.params.id));if(!ok)return res.status(404).json({error:"Demande introuvable"});res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/friends/:id",requireAuth,async(req,res)=>{try{await d1RemoveFriend(req.user.id,Number(req.params.id));res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/friends/agenda",requireAuth,async(req,res)=>{try{const rows=await d1FriendsConcerts(req.user.id);res.json({items:rows.map(r=>({key:r.ckey,status:r.status,user:{id:Number(r.user_id),username:r.username},data:typeof r.data==="string"?JSON.parse(r.data||"{}"):r.data||{}}))})}catch(e){res.status(502).json({error:e.message})}});
// ---- Aide › Contact : messages to the administrator, read and answered in the app ----
// Administrators: usernames in ADMIN_USERS (comma separated) on Render, or by
// default the very first account created (the owner).
let firstUserId=null;
async function isAdmin(user){
 const list=String(process.env.ADMIN_USERS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(list.length)return list.includes(String(user?.username||"").toLowerCase());
 if(firstUserId==null)firstUserId=await d1FirstUserId().catch(()=>0);
 return Number(user?.id)===Number(firstUserId);
}
async function requireAdmin(req,res,next){try{if(!(await isAdmin(req.user)))return res.status(403).json({error:"Réservé à l’administrateur"});next()}catch(e){res.status(502).json({error:e.message})}}
app.get("/api/support/status",requireAuth,async(req,res)=>{try{const admin=await isAdmin(req.user);res.json({isAdmin:admin,...await d1SupportCounts(req.user.id,admin),communityPending:admin?await d1CountPendingCommunity().catch(()=>0):0})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/support",requireAuth,async(req,res)=>{try{const message=String(req.body?.message||"").trim(),subject=String(req.body?.subject||"").trim();if(message.length<3)return res.status(400).json({error:"Écris ton message"});if(await d1CountRecentSupport(req.user.id,new Date(Date.now()-3600e3).toISOString())>=5)return res.status(429).json({error:"Trop de messages en peu de temps, réessaie dans une heure"});await d1AddSupportMessage(req.user.id,subject,message);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/support/mine",requireAuth,async(req,res)=>{try{const rows=await d1MySupportMessages(req.user.id);await d1MarkRepliesSeen(req.user.id);res.json({items:rows})}catch(e){res.status(502).json({error:e.message})}});
// Concert sources health (Mon compte › Administration › État des sources) and
// alerts sent to the administrator's "Messages reçus".
app.get("/api/admin/sources/find",requireAuth,requireAdmin,(req,res)=>res.json(findInSources(String(req.query.q||"").slice(0,80))));
// Daily check of the sources and services (e-mail + message when something is wrong).
app.get("/api/admin/monitor",requireAuth,requireAdmin,async(req,res)=>{try{res.json({last:await lastDailyCheck()})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/admin/monitor/run",requireAuth,requireAdmin,async(req,res)=>{try{res.json({last:await runDailyCheck({force:true})})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/admin/sources/test",requireAuth,requireAdmin,async(req,res)=>{try{res.json({results:await testSources()})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/admin/sources",requireAuth,requireAdmin,async(req,res)=>{try{res.json({sources:await sourcesHealth()})}catch(e){res.status(502).json({error:e.message})}});
const adminMessage=async(subject,message)=>{if(!d1Enabled)return;const names=String(process.env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean);let id=0;if(names.length){const u=await d1FindUserByUsername(names[0]).catch(()=>null);id=Number(u?.id)||0}if(!id)id=await d1FirstUserId();if(id)await d1AddSupportMessage(id,subject,message)};
setAlertSink(adminMessage);setMonitorSink(adminMessage);
app.get("/api/support/admin",requireAuth,requireAdmin,async(req,res)=>{try{res.json({items:await d1AllSupportMessages()})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/support/:id/read",requireAuth,requireAdmin,async(req,res)=>{try{await d1MarkSupportRead(req.params.id);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/support/:id/reply",requireAuth,requireAdmin,async(req,res)=>{try{const reply=String(req.body?.reply||"").trim();if(!reply)return res.status(400).json({error:"Réponse vide"});await d1ReplySupport(req.params.id,reply);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/support/:id",requireAuth,requireAdmin,async(req,res)=>{try{await d1DeleteSupport(req.params.id);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
// "Signaler un concert": a member adds a show the sources miss; it appears in
// the concert lists (near me / city) only once the administrator approves it.
let communityCache=null;
async function approvedCommunity(){if(communityCache&&Date.now()-communityCache.at<5*60e3)return communityCache.rows;const rows=await d1ApprovedCommunityConcerts(new Date().toISOString().slice(0,10));communityCache={at:Date.now(),rows};return rows}
const ccOut=r=>({id:Number(r.id),user:{id:Number(r.user_id),username:r.username||""},title:r.title,bands:r.bands||"",date:r.date,time:r.time||"",venue:r.venue||"",city:r.city,url:r.url||"",note:r.note||"",status:r.status,createdAt:r.created_at,reviewedAt:r.reviewed_at||""});
app.post("/api/community-concerts",requireAuth,async(req,res)=>{try{const b=req.body||{},t=(k,n)=>String(b[k]??"").replace(/\s+/g," ").trim().slice(0,n);
 const title=t("title",160),bands=t("bands",400),date=t("date",10),time=t("time",5),venue=t("venue",120),city=t("city",80),url=t("url",500),note=t("note",500);
 if(!title&&!bands)return res.status(400).json({error:"Indique le nom du concert ou les groupes"});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<new Date().toISOString().slice(0,10))return res.status(400).json({error:"Date invalide (le concert doit être à venir)"});
 if(time&&!/^\d{2}:\d{2}$/.test(time))return res.status(400).json({error:"Heure invalide"});
 if(!city)return res.status(400).json({error:"Indique la ville"});
 if(url&&!/^https?:\/\//i.test(url))return res.status(400).json({error:"Le lien doit commencer par http:// ou https://"});
 if(await d1CountRecentCommunity(req.user.id,new Date(Date.now()-864e5).toISOString())>=10)return res.status(429).json({error:"Trop de concerts signalés aujourd’hui, réessaie demain"});
 let g=null;try{g=await geocodeQuery(city)}catch{}if(!g||!Number.isFinite(Number(g.lat)))return res.status(400).json({error:`Ville introuvable : ${city}`});
 await d1AddCommunityConcert(req.user.id,{title:title||bands,bands,date,time,venue,city,lat:Number(g.lat),lon:Number(g.lon),url,note});res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/community-concerts/mine",requireAuth,async(req,res)=>{try{res.json({items:(await d1MyCommunityConcerts(req.user.id)).map(ccOut)})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/community-concerts/admin",requireAuth,requireAdmin,async(req,res)=>{try{res.json({items:(await d1AllCommunityConcerts()).map(ccOut)})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/community-concerts/:id/:action(approve|reject)",requireAuth,requireAdmin,async(req,res)=>{try{await d1SetCommunityStatus(req.params.id,req.params.action==="approve"?"approved":"rejected");communityCache=null;res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/community-concerts/:id",requireAuth,requireAdmin,async(req,res)=>{try{await d1DeleteCommunityConcert(req.params.id);communityCache=null;res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
const normCity=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
// "Quoi de neuf" popup at app start: pending friend requests + concerts
// friends marked since the popup was last closed (first time: last 7 days).
// Only concerts are shared with friends; followed groups stay private.
app.get("/api/friends/news",requireAuth,async(req,res)=>{try{const me=req.user.id;const [rels,rows,seenAt]=await Promise.all([d1ListFriendships(me),d1FriendsConcerts(me),d1GetFriendsSeen(me)]);const since=seenAt||new Date(Date.now()-7*864e5).toISOString(),today=new Date().toISOString().slice(0,10);
 const incoming=rels.filter(r=>r.status!=="accepted"&&Number(r.addressee_id)===me).map(r=>({id:Number(r.other_id),username:r.other_name}));
 const concerts=rows.map(r=>({key:r.ckey,status:r.status,user:{id:Number(r.user_id),username:r.username},data:typeof r.data==="string"?JSON.parse(r.data||"{}"):r.data||{},updatedAt:r.updated_at})).filter(r=>String(r.updatedAt||"")>since&&String(r.data?.date||"").slice(0,10)>=today).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,30);
 const shares=(await d1SharesFor(me,since)).map(r=>{let artist={};try{artist=JSON.parse(r.artist_json||"{}")}catch{}return {id:Number(r.id),from:{id:Number(r.from_id),username:r.username},artist,message:r.message||"",createdAt:r.created_at}});
 res.json({incoming,concerts,shares,since})}catch(e){res.status(502).json({error:e.message})}});
// "Partager à un ami": recommend a band to accepted friends only.
// "Partages reçus": every band a friend shared with me, until I delete it.
app.get("/api/shares/received",requireAuth,async(req,res)=>{try{const rows=await d1SharesHistory(req.user.id);res.json({items:rows.map(r=>{let artist={};try{artist=JSON.parse(r.artist_json||"{}")}catch{}return {id:Number(r.id),from:{id:Number(r.from_id),username:r.username},artist,message:r.message||"",createdAt:r.created_at}})})}catch(e){res.status(502).json({error:e.message})}});
app.delete("/api/shares/:id",requireAuth,async(req,res)=>{try{await d1HideShare(req.user.id,Number(req.params.id));res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/shares",requireAuth,async(req,res)=>{try{const me=req.user.id,a=req.body?.artist||{},name=String(a.name||"").trim().slice(0,120);if(!name)return res.status(400).json({error:"Groupe manquant"});
 const friends=new Set((await d1ListFriendships(me)).filter(r=>r.status==="accepted").map(r=>Number(r.other_id)));const to=[...new Set((Array.isArray(req.body?.to)?req.body.to:[]).map(Number))].filter(id=>friends.has(id));if(!to.length)return res.status(400).json({error:"Choisis au moins un ami"});
 const pick=k=>String(a[k]??"").trim().slice(0,400);const photo=pick("photoUrl");
 await d1ShareBand(me,to,{name,mbid:pick("mbid"),style:pick("style"),country:pick("country"),photoUrl:/^https?:\/\//.test(photo)?photo:""},req.body?.message);res.json({ok:true,sent:to.length})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/friends/news/seen",requireAuth,async(req,res)=>{try{await d1SetFriendsSeen(req.user.id,new Date().toISOString());res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
// Clips & Radio › Radio: metal web radios (Radio Browser) and the title on air.
app.get("/api/radio/stations",async(req,res)=>{try{const style=String(req.query.style||"all");if(style!=="all"&&!RADIO_STYLES[style])return res.status(400).json({error:"Style inconnu"});res.json({styles:Object.keys(RADIO_STYLES),...await radioStations(style)})}catch(e){res.status(502).json({error:"Radios indisponibles pour le moment"})}});
app.get("/api/radio/byids",async(req,res)=>{try{const ids=String(req.query.ids||"").split(",").map(x=>x.trim()).filter(Boolean);res.json({stations:await radioByIds(ids)})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/radio/nowplaying",async(req,res)=>{try{res.json(await radioNowPlaying(String(req.query.id||"")))}catch{res.json({title:null})}});
app.post("/api/radio/click",(req,res)=>{radioClick(String(req.query.id||""));res.json({ok:true})});
// "Nouvel album" / "Nouveau concert" alerts (badges on Actus and Concerts).
// Albums come from MusicBrainz in the background (shared 6 h cache, 1 request
// per second): the first answer may still be computing.
const albumJobs=new Map();
function userAlbums(uid,artists){
 let st=albumJobs.get(uid);const sig=artists.map(a=>a.id+":"+(a.mbid||"")).join(",");
 if(!st||st.sig!==sig||Date.now()-st.at>6*3600e3){
  const prev=st;st={sig,at:Date.now(),map:prev?.map||new Map(),done:false};albumJobs.set(uid,st);const job=st;
  job.promise=(async()=>{for(const a of artists){if(!a.mbid)continue;try{job.map.set(a.id,recentAlbums(a,await artistReleaseGroups(a.mbid)))}catch{}}job.done=true})().catch(()=>{job.done=true});
 }
 return st;
}
app.get("/api/alerts",requireAuth,async(req,res)=>{try{
 const uid=req.user.id,artists=localArtistsForUser(uid);
 const st=userAlbums(uid,artists);if(!st.done)await Promise.race([st.promise,new Promise(r=>setTimeout(r,2500))]);
 const events=eventList({userId:uid});const seen=await d1AlertSeenKeys(uid);
 const {albums,concerts,toMark}=pickNew({artists,albumsByArtist:st.map,events,seen});
 if(toMark.length)await d1MarkAlertsSeen(uid,toMark);
 // Concerts: around the place the user last searched (else all of France).
 let near=concerts;const lat=Number(req.query.lat),lon=Number(req.query.lon),r=Math.min(Math.max(Number(req.query.radius)||50,5),200);
 if(Number.isFinite(lat)&&Number.isFinite(lon)&&concerts.length){const ok=new Map((await rowsNear(concerts.map(c=>({...c})),lat,lon,r)).map(c=>[c.key,c.distanceKm]));near=concerts.filter(c=>ok.has(c.key)).map(c=>({...c,distanceKm:ok.get(c.key)}))}
 res.json({albums,concerts:near,computing:!st.done,area:Number.isFinite(lat)?"near":"france"})}catch(e){res.status(502).json({error:e.message})}});
// Actus › Sorties: announced and recent albums / EPs of the user's bands
// (same MusicBrainz data as the alerts, computed in the background).
app.get("/api/releases",requireAuth,async(req,res)=>{try{const uid=req.user.id,artists=localArtistsForUser(uid);
 const st=userAlbums(uid,artists);if(!st.done)await Promise.race([st.promise,new Promise(r=>setTimeout(r,2500))]);
 const items=[...st.map.values()].flat();const seen=new Set();const uniq=items.filter(x=>!seen.has(x.key)&&seen.add(x.key));
 res.json({items:uniq,computing:!st.done,bands:artists.filter(a=>a.mbid).length})}catch(e){res.status(502).json({error:e.message})}});
// 🎫 Billets: does Ticketmaster sell this concert, and has Bandsintown the
// organiser's ticket link? (cached; limited per address)
const ticketsIp=makeLimiter({max:120,windowMs:15*60e3});
app.get("/api/tickets",requireAuth,async(req,res)=>{try{const ip=req.ip||"";if(!ticketsIp.allowed(ip))return res.status(429).json({error:"Trop de recherches, réessaie dans quelques minutes."});ticketsIp.add(ip);
 const r=await findTickets({band:req.query.artist,date:req.query.date,city:req.query.city});res.json({...r,ticketmasterConfigured:ticketmasterConfigured()})}catch(e){res.status(502).json({error:e.message})}});
// "Mes concerts passés": setlist of a concert, and a band's past concerts
// (setlist.fm, cached; limited per address).
const setlistIp=makeLimiter({max:90,windowMs:15*60e3});
function setlistGuard(req,res){if(!setlistConfigured()){res.json({configured:false});return false}const ip=req.ip||"";if(!setlistIp.allowed(ip)){res.status(429).json({error:"Trop de recherches, réessaie dans quelques minutes."});return false}setlistIp.add(ip);return true}
app.get("/api/setlist",requireAuth,async(req,res)=>{try{if(!setlistGuard(req,res))return;res.json({configured:true,setlist:await findSetlist({band:req.query.artist,date:req.query.date,city:req.query.city,id:req.query.id})})}catch(e){res.status(502).json({error:"setlist.fm ne répond pas pour le moment."})}});
app.get("/api/setlists/search",requireAuth,async(req,res)=>{try{if(!setlistGuard(req,res))return;res.json({configured:true,...await searchSetlists({band:req.query.artist,page:req.query.p})})}catch(e){res.status(502).json({error:"setlist.fm ne répond pas pour le moment."})}});
// Clips: a band's YouTube videos, played inside the app (cached a week).
// prefetch=1: prepared in the background, within a part of the daily quota.
const videosIp=makeLimiter({max:90,windowMs:15*60e3});
app.get("/api/videos",requireAuth,async(req,res)=>{try{if(!youtubeConfigured())return res.json({configured:false,items:[]});const ip=req.ip||"";if(!videosIp.allowed(ip))return res.status(429).json({error:"Trop de recherches, réessaie dans quelques minutes."});videosIp.add(ip);
 res.json({configured:true,items:await bandVideos({band:req.query.artist,kind:String(req.query.kind||"clips"),prefetch:req.query.prefetch==="1"})})}catch(e){if(e instanceof PrefetchSkipped)return res.json({configured:true,items:[],skipped:true});res.status(502).json({error:"YouTube ne répond pas pour le moment."})}});
app.get("/api/videos/feed",requireAuth,async(req,res)=>{try{if(!youtubeConfigured())return res.json({configured:false,items:[]});res.json({configured:true,...await videoFeed(localArtistsForUser(req.user.id).map(a=>({id:a.id,name:a.name})))})}catch(e){res.status(502).json({error:"YouTube ne répond pas pour le moment."})}});
app.post("/api/alerts/seen",requireAuth,async(req,res)=>{try{const keys=(Array.isArray(req.body?.keys)?req.body.keys:[]).map(String).filter(k=>/^[ac]:/.test(k)&&k.length<200).slice(0,300);if(keys.length)await d1MarkAlertsSeen(req.user.id,keys);res.json({ok:true})}catch(e){res.status(502).json({error:e.message})}});
// "Ajouter à mon calendrier": one concert as an .ics file (opens the phone's
// calendar), and the user's agenda as a feed phones subscribe to (secret link).
const pubBase=req=>String(process.env.APP_PUBLIC_URL||"").replace(/\/$/,"")||`${req.protocol}://${req.get("host")}`;
app.get("/api/calendar/event.ics",(req,res)=>{const q=req.query,t=k=>String(q[k]||"").replace(/\s+/g," ").trim().slice(0,300);
 const c={title:t("title"),artist:t("artist"),date:t("date").slice(0,10),time:t("time").slice(0,5),venue:t("venue"),city:t("city"),url:/^https?:\/\//i.test(t("url"))?t("url"):""};
 if(!validConcert(c))return res.status(400).type("text/plain").send("Date manquante");
 res.set("Content-Type","text/calendar; charset=utf-8");res.set("Content-Disposition",`inline; filename="concert-${c.date}.ics"`);res.send(calendar([vevent(c)],{name:"Concert"}))});
app.get("/api/calendar/feed",requireAuth,async(req,res)=>{try{const token=await d1CalendarToken(req.user.id,false);const url=`${pubBase(req)}/cal/${token}.ics`;res.json({url,webcal:url.replace(/^https?:/,"webcal:")})}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/calendar/feed/renew",requireAuth,async(req,res)=>{try{const token=await d1CalendarToken(req.user.id,true);const url=`${pubBase(req)}/cal/${token}.ics`;res.json({url,webcal:url.replace(/^https?:/,"webcal:")})}catch(e){res.status(502).json({error:e.message})}});
app.get("/cal/:token.ics",async(req,res)=>{try{const uid=/^[A-Za-z0-9_-]{20,64}$/.test(req.params.token)?await d1UserByCalendarToken(req.params.token):0;if(!uid)return res.status(404).type("text/plain").send("Agenda introuvable");
 const from=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
 const evs=(await d1ListUserConcerts(uid)).map(r=>{let d={};try{d=typeof r.data==="string"?JSON.parse(r.data||"{}"):r.data||{}}catch{}return {...r,d}}).filter(r=>(r.status==="going"||r.status==="interested")&&validConcert(r.d)&&String(r.d.date).slice(0,10)>=from)
  .map(r=>vevent(r.d,{status:r.status,uid:"agenda-"+crypto.createHash("sha1").update(uid+"|"+r.ckey).digest("hex").slice(0,20)+"@stayloud-radar.online"}));
 res.set("Content-Type","text/calendar; charset=utf-8");res.set("Cache-Control","private, max-age=900");res.send(calendar(evs,{name:"STAYPIT – mes concerts"}))}catch(e){res.status(502).type("text/plain").send("Agenda indisponible")}});
app.get("/api/providers/status",(_,res)=>res.json({providers:runStatus()}));
app.get("/api/discover/location",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});const p=await geocodeQuery(q);if(!p)return res.status(404).json({error:"position introuvable"});res.json(p)}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/city-concerts",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});const out=await discoverManualCityConcerts(q);try{out.items=mergeCommunityConcerts(out.items,(await approvedCommunity()).filter(c=>normCity(c.city)===normCity(q)),NaN,NaN,0)}catch{}res.json(out);}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/resolve-city",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});const p=await geocodeQuery(q);if(!p)return res.status(404).json({error:`ville introuvable : ${q}`});res.json({city:q,resolvedCity:p.resolved_city||q,country:p.country||"France",lat:p.lat,lon:p.lon,display_name:p.display_name||`${q}, France`,resolvedCityVerified:true});}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/reverse",async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});try{const {reverseCity}=await import("./providers/discovery.js");res.json(await reverseCity(lat,lon))}catch(e){res.status(502).json({error:e.message})}});
app.get("/clip/:id",async(req,res)=>{const id=String(req.params.id||"");if(!CLIP_ID.test(id))return res.redirect(302,"/");
  const meta=await clipMeta(id);const proto=String(req.headers["x-forwarded-proto"]||req.protocol||"https").split(",")[0];
  res.set("Cache-Control","public, max-age=3600");res.type("html").send(clipPageHTML(id,meta||{},`${proto}://${req.get("host")}`))});
app.get("/api/discover/activity",requireAuth,async(req,res)=>{try{let names=[];try{names=JSON.parse(String(req.query.names||"[]"))}catch{}names=[...new Set((Array.isArray(names)?names:[]).map(n=>String(n||"").trim().slice(0,120)).filter(Boolean))].slice(0,30);
  const out={},todo=[...names];const worker=async()=>{while(todo.length){const n=todo.shift();try{const a=await bandActivity(n);if(a)out[n]=a}catch{}}};
  await Promise.all([worker(),worker(),worker(),worker()]);res.set("Cache-Control","private, max-age=1800");res.json({items:out})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/artists",async(req,res)=>{try{const style=String(req.query.style||"all");const limit=Math.min(Number(req.query.limit||18),30);const page=Math.max(0,Math.min(Number(req.query.page)||0,50));res.json(await discoverArtists(style,limit,page))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/festivals",async(req,res)=>{let lat=Number(req.query.lat),lon=Number(req.query.lon),radius=Number(req.query.radius||75);const targetCity=String(req.query.targetCity||req.query.city||"").trim();const place={city:targetCity,locality:String(req.query.locality||"").trim(),municipality:String(req.query.municipality||"").trim(),county:String(req.query.county||"").trim(),state:String(req.query.state||"").trim(),country:String(req.query.country||"").trim(),manualTarget:Boolean(targetCity),targetLat:Number(req.query.targetLat),targetLon:Number(req.query.targetLon),resolvedCityVerified:String(req.query.resolvedCityVerified||"")==='1'};try{if(targetCity){const g=await geocodeQuery(targetCity);if(!g)throw new Error(`Ville introuvable : ${targetCity}`);lat=g.lat;lon=g.lon;place.city=g.city||targetCity;place.lat=g.lat;place.lon=g.lon;place.country=g.country||"France"}else if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});res.json(await discoverNearbyFestivals(lat,lon,Math.min(Math.max(radius,5),100),place.city||place.country?place:null))}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/geo/cities",requireAuth,async(req,res)=>{try{res.json({coords:await locateCities(req.body?.cities)})}catch(e){res.status(502).json({error:"Villes introuvables"})}});
app.get("/api/discover/concerts",async(req,res)=>{let lat=Number(req.query.lat),lon=Number(req.query.lon),radius=Number(req.query.radius||75);const targetCity=String(req.query.targetCity||req.query.city||"").trim();const place={city:targetCity,locality:String(req.query.locality||"").trim(),municipality:String(req.query.municipality||"").trim(),county:String(req.query.county||"").trim(),state:String(req.query.state||"").trim(),country:String(req.query.country||"").trim(),manualTarget:Boolean(targetCity),targetLat:Number(req.query.targetLat),targetLon:Number(req.query.targetLon),resolvedCityVerified:String(req.query.resolvedCityVerified||"")==='1'};try{if(targetCity){const g=await geocodeQuery(targetCity);if(!g)throw new Error(`Ville introuvable : ${targetCity}`);lat=g.lat;lon=g.lon;place.city=g.city||targetCity;place.lat=g.lat;place.lon=g.lon;place.country=g.country||"France"}else if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});const r=Math.min(Math.max(radius,5),100);const out=await discoverNearbyConcerts(lat,lon,r,place.city||place.country?place:null);try{const base=Number.isFinite(Number(out?.place?.lat))?out.place:{lat,lon};out.items=mergeCommunityConcerts(out.items,await approvedCommunity(),Number(base.lat),Number(base.lon),r)}catch(e){console.error('Community concerts merge:',e?.message||e)}try{const user=await optionalUser(req);if(user){const followed=eventList({userId:user.id});const base=Number.isFinite(Number(out?.place?.lat))?out.place:{lat,lon};out.items=await mergeFollowedConcerts(out.items,followed,Number(base.lat),Number(base.lon),r)}}catch(e){console.error('Followed concerts merge:',e?.message||e)}res.json(out)}catch(e){res.status(502).json({error:e.message})}});
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
cron.schedule(process.env.MONITOR_CRON||"17 7 * * *",()=>runDailyCheck().catch(e=>console.error("Daily check:",e?.message||e)),{timezone:"Europe/Paris"});
