import {d1PutBandNews,d1PutBandEvents} from "./d1.js";
import {bandKey,artistNewsRows,artistEventRows,completeNewsKeys,pruneOldNews,newsCutoffIso,getArtist,getArtists,putNews,replaceArtistEvents,providerRun,cleanArtistNews,migrateConcertEngineV59,setArtistSourceUrls} from "./db.js";
import {gdelt,googleNews,enrichDates} from "./providers/news.js";
import {liveMentions} from "./providers/live-mentions.js";
import {fetchExternalConcerts} from "./providers/concert-web.js";
import {resolve as resolveMusicBrainz} from "./providers/musicbrainz.js";

const running=new Map();

export async function refreshArtist(id){
 if(running.has(id))return running.get(id);
 const p=run(id).finally(()=>running.delete(id));running.set(id,p);return p;
}
async function run(id){
 const {report,pending}=await refreshArtistNews(id,{enrich:false});
 await enrichArtistNews(id,pending);
 Object.assign(report,{live:(await refreshArtistConcerts(id)).live});
 return report;
}

// News step: identity check, then all news providers in parallel. Articles are
// stored as soon as they are found; returns those still missing a date/image
// so the caller can fill them later with enrichArtistNews.
export async function refreshArtistNews(id,{enrich=true}={}){
 let artist=getArtist(id);if(!artist)throw new Error("Artiste introuvable");
 // Canonicalize the artist identity before any provider search. This fixes
 // aliases/typos such as "Landmarks" -> "LANDMVRKS" so every downstream
 // provider searches the real artist instead of the ambiguous input.
 try{
  // Si l'utilisateur a choisi explicitement un MBID, son identité est verrouillée.
  // Cela évite qu'un groupe homonyme soit remplacé au prochain rafraîchissement.
  if(!artist.mbid && !artist.identity_locked){
   const identity=await resolveMusicBrainz(artist.name);
   if(identity?.mbid){
    const {updateArtist}=await import("./db.js");
    updateArtist(id,{name:identity.name,mbid:identity.mbid,style:identity.style||null});
    artist=getArtist(id);
   }
  }
 }catch{}
 const report={artist:artist.name,news:{},live:{},errors:[]};
 migrateConcertEngineV59();

 cleanArtistNews(id,artist.name);
 pruneOldNews(id);
 const providers=[["gdelt",a=>gdelt(a,{enrich:false})],["google-news",a=>googleNews(a,{enrich:false})],["live-mentions",liveMentions]];
 const found=await Promise.all(providers.map(async([name,fn])=>{
  try{const rows=await fn(artist);for(const n of rows)putNews(id,n);report.news[name]=rows.length;return rows}
  catch(e){report.errors.push(`${name}:${e.message}`);providerRun(name,e.message);return []}
 }));
 const cutoff=newsCutoffIso();
 // Newest articles first, so the top of Radar gets its photos first.
 // Only articles not already stored with a date and a photo need their page read.
 const known=completeNewsKeys(id);
 const pending=found.flat().filter(x=>x.url&&!known.has(x.dedupe_key)&&!(x.published_at&&x.image_url)&&(!x.published_at||String(x.published_at)>=cutoff))
  .sort((a,b)=>String(b.published_at||'').localeCompare(String(a.published_at||'')));
 if(enrich){await enrichArtistNews(id,pending);await saveNewsCache(id);return {report,pending:[]}}
 await saveNewsCache(id);
 return {report,pending};
}
// Fill photos/dates for articles of several groups at once ({artistId,row}
// items, in priority order).
export async function enrichNewsItems(items){
 if(!items?.length)return;
 const done=await enrichDates(items.map(x=>x.row),items.length);
 done.forEach((row,i)=>{if(getArtist(items[i].artistId))putNews(items[i].artistId,row)});
 for(const id of new Set(items.map(x=>x.artistId)))await saveNewsCache(id);
}
// Durable copy in D1 (see band_cache): failures only cost a slower next start.
export async function saveNewsCache(id){const a=getArtist(id);if(!a)return;try{await d1PutBandNews(bandKey(a),artistNewsRows(id))}catch(e){console.error('News cache:',e?.message||e)}}
export async function saveEventsCache(id){const a=getArtist(id);if(!a)return;try{await d1PutBandEvents(bandKey(a),artistEventRows(id))}catch(e){console.error('Events cache:',e?.message||e)}}
export async function enrichArtistNews(id,rows){
 if(!rows?.length||!getArtist(id))return;
 for(const n of await enrichDates(rows,80))putNews(id,n);
 await saveNewsCache(id);
}

export async function refreshArtistConcerts(id){
 const artist=getArtist(id);if(!artist)throw new Error("Artiste introuvable");
 const report={artist:artist.name,live:{},errors:[]};
 // Concerts: the primary references are Bandsintown and InfoConcert, plus lineup discovery on event pages.
 // Their artist calendars are merged by date + city + venue.
 try{
  const result=await fetchExternalConcerts(artist);
  const rows=result.rows||[];
  report.live.sources=result.sources;
  setArtistSourceUrls(id,{bandsintownUrl:result.sources?.Bandsintown?.url||null,infoconcertUrl:result.sources?.InfoConcert?.url||null});
  report.live.externalConcerts=rows.length;
  // Never erase a calendar because both source pages temporarily failed.
  // If at least one source answered, however, synchronize strictly to the
  // two allowed references and remove all legacy events.
  report.live.total=replaceArtistEvents(id,rows);
  report.live.preservedExisting=false;
  await saveEventsCache(id);
 }catch(e){
  report.live.preservedExisting=true;
  report.errors.push(`external-concerts:${e.message}`);
  providerRun("concerts:external",e.message);
 }
 return report;
}

export async function refreshAll(){
 migrateConcertEngineV59();
 const reports=[];for(const a of getArtists()){try{reports.push(await refreshArtist(a.id))}catch(e){reports.push({artist:a.name,errors:[e.message]})}}return reports;
}
