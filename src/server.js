import express from "express";
import cron from "node-cron";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getArtists,getArtist,upsertArtist,updateArtist,deleteArtist,newsList,eventList,runStatus,mergeArtistEvents} from "./db.js";
import {resolve,resolveByMbid,searchArtistCandidates,fetchArtistProfile,discoverArtistPhoto,discoverArtistPhotos} from "./providers/musicbrainz.js";
import {refreshArtist,refreshAll} from "./aggregator.js";
import {bandsintownArtistId,resolveBandsintown,resolveInfoConcert} from "./providers/concert-web.js";
import {discoverArtists,discoverNearbyConcerts,discoverNearbyFestivals,geocodeQuery} from "./providers/discovery.js";

const app=express();app.use(express.json({limit:"10mb"}));
const dir=path.dirname(fileURLToPath(import.meta.url));app.use(express.static(path.join(dir,"../public"),{etag:false,lastModified:false,setHeaders:(res,filePath)=>{if(filePath.endsWith(".html"))res.setHeader("Cache-Control","no-store");}}));

app.get("/api/health",(_,res)=>res.json({ok:true,version:"7.0.0",mode:"concerts-bandsintown-infoconcert-lineup-canonical"}));
app.get("/api/artists",(_,res)=>res.json({artists:getArtists()}));
app.get("/api/artists/:id/profile",async(req,res)=>{try{const a=getArtist(Number(req.params.id));if(!a)return res.status(404).json({error:"introuvable"});res.json(await fetchArtistProfile(a))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/photo",async(req,res)=>{try{const name=String(req.query.name||"").trim();if(!name)return res.status(400).json({error:"name requis"});res.json(await discoverArtistPhoto(name))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/artists/candidates",async(req,res)=>{try{const name=String(req.query.name||"").trim();if(!name)return res.status(400).json({error:"name requis"});res.json({input:name,items:await searchArtistCandidates(name,8)})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/artists/photo-candidates",async(req,res)=>{try{const name=String(req.query.name||"").trim(),context=String(req.query.context||"").trim(),force=String(req.query.force||"")==="1",page=Math.max(0,Number(req.query.page||0)||0);let exclude=[];try{exclude=JSON.parse(String(req.query.exclude||"[]"));if(!Array.isArray(exclude))exclude=[]}catch{};if(!name)return res.status(400).json({error:"name requis"});const bandsintownUrl=String(req.query.bandsintownUrl||'').trim();res.json({items:await discoverArtistPhotos(name,5,context,{force,page,exclude,bandsintownUrl})})}catch(e){res.status(502).json({error:e.message})}});
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
app.post("/api/artists",async(req,res)=>{
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
  const a=upsertArtist(canonicalName,r.mbid||null,style||r.style||null,{disambiguation:disambiguation||r.disambiguation||null,country:country||r.country||null,photoUrl:photoUrl||null,identitySource:identitySource||null,identityKey:identityKey||null,identityLocked:identityLocked});
  if(String(req.body?.bandsintownUrl||"").trim()){const {setArtistSourceUrls}=await import("./db.js");setArtistSourceUrls(a.id,{bandsintownUrl:String(req.body.bandsintownUrl).trim()});}
  // Return immediately after saving the artist/photo. The full refresh (concerts,
  // lineup, news, etc.) can be slow and is not required to validate a simple
  // photo selection. Keep the existing refresh behaviour, but run it in the
  // background so the Add button is responsive.
  const savedArtist=getArtist(a.id);
  res.status(201).json({artist:savedArtist,report:null,refreshing:true});
  setTimeout(()=>{refreshArtist(a.id).catch(e=>console.error(`Background refresh failed for artist ${a.id}:`,e?.message||e))},0);
 }catch(e){res.status(502).json({error:e.message})}
});
app.patch("/api/artists/:id",(req,res)=>{const id=Number(req.params.id),a=getArtist(id);if(!a)return res.status(404).json({error:"introuvable"});const style=req.body?.style===null?null:String(req.body?.style??"").trim()||null;const photoUrl=req.body?.photoUrl===null?null:String(req.body?.photoUrl??"").trim()||null;const description=req.body?.description===null?null:String(req.body?.description??"").trim()||null;res.json({artist:updateArtist(id,{style,photoUrl,description})})});
app.delete("/api/artists/:id",(req,res)=>{const id=Number(req.params.id);if(!getArtist(id))return res.status(404).json({error:"introuvable"});deleteArtist(id);res.status(204).end()});
app.post("/api/artists/:id/refresh",async(req,res)=>{try{res.json(await refreshArtist(Number(req.params.id)))}catch(e){res.status(502).json({error:e.message})}});
app.post("/api/artists/:id/bandsintown-widget",(req,res)=>{try{const id=Number(req.params.id);const a=getArtist(id);if(!a)return res.status(404).json({error:"introuvable"});const rows=Array.isArray(req.body?.rows)?req.body.rows:[];const safe=rows.map(x=>({...x,provider:"Bandsintown"}));res.json({ok:true,count:mergeArtistEvents(id,safe)})}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/artists/:id/concert-sources",async(req,res)=>{try{const a=getArtist(Number(req.params.id));if(!a)return res.status(404).json({error:"introuvable"});const [bandsintown,infoconcert]=await Promise.all([resolveBandsintown(a),resolveInfoConcert(a)]);res.json({artist:a.name,bandsintown,infoconcert})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/artists/:id/bandsintown-id",(req,res)=>{const a=getArtist(Number(req.params.id));if(!a)return res.status(404).json({error:"introuvable"});res.json({id:bandsintownArtistId(a)})});
app.get("/api/radar",(req,res)=>res.json({items:newsList({artistId:req.query.artistId?Number(req.query.artistId):undefined,limit:Math.min(Number(req.query.limit||500),1000)})}));
app.get("/api/live",(req,res)=>res.json({items:eventList({artistId:req.query.artistId?Number(req.query.artistId):undefined,country:String(req.query.country||"").trim()||undefined,limit:Math.min(Number(req.query.limit||500),1000)})}));
app.get("/api/providers/status",(_,res)=>res.json({providers:runStatus()}));
app.get("/api/discover/location",async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.status(400).json({error:"q requis"});const p=await geocodeQuery(q);if(!p)return res.status(404).json({error:"position introuvable"});res.json(p)}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/reverse",async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});try{const {reverseCity}=await import("./providers/discovery.js");res.json(await reverseCity(lat,lon))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/artists",async(req,res)=>{try{const style=String(req.query.style||"all");const limit=Math.min(Number(req.query.limit||18),30);res.json({items:await discoverArtists(style,limit)})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/festivals",async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon),radius=Number(req.query.radius||75);if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});const place={city:String(req.query.city||"").trim(),locality:String(req.query.locality||"").trim(),municipality:String(req.query.municipality||"").trim(),county:String(req.query.county||"").trim(),state:String(req.query.state||"").trim(),country:String(req.query.country||"").trim()};try{res.json(await discoverNearbyFestivals(lat,lon,Math.min(Math.max(radius,5),100),place.city||place.country?place:null))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/discover/concerts",async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon),radius=Number(req.query.radius||75);if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"lat/lon requis"});const place={city:String(req.query.city||"").trim(),locality:String(req.query.locality||"").trim(),municipality:String(req.query.municipality||"").trim(),county:String(req.query.county||"").trim(),state:String(req.query.state||"").trim(),country:String(req.query.country||"").trim()};try{res.json(await discoverNearbyConcerts(lat,lon,Math.min(Math.max(radius,5),100),place.city||place.country?place:null))}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/live/sources",(_,res)=>res.json({sources:[{name:"Bandsintown",type:"artist-calendar",free:true,configured:true},{name:"InfoConcert",type:"artist-calendar",free:true,configured:true},{name:"LineupDiscovery",type:"event-lineup-discovery",free:true,configured:true}]}));

const port=Number(process.env.PORT||8787);
app.listen(port,()=>{console.log(`Music Radar V2: http://localhost:${port}`);setTimeout(()=>refreshAll().catch(e=>console.error(e)),500)});
cron.schedule(process.env.REFRESH_CRON||"*/30 * * * *",()=>refreshAll().catch(e=>console.error(e)));
