import {getArtist,getArtists,putNews,replaceArtistEvents,providerRun,cleanArtistNews,migrateConcertEngineV59,setArtistSourceUrls} from "./db.js";
import {gdelt,googleNews} from "./providers/news.js";
import {liveMentions} from "./providers/live-mentions.js";
import {fetchExternalConcerts} from "./providers/concert-web.js";
import {resolve as resolveMusicBrainz} from "./providers/musicbrainz.js";

const running=new Map();

export async function refreshArtist(id){
 if(running.has(id))return running.get(id);
 const p=run(id).finally(()=>running.delete(id));running.set(id,p);return p;
}
async function run(id){
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
 for(const [name,fn] of [["gdelt",gdelt],["google-news",googleNews],["live-mentions",liveMentions]]){
  try{const rows=await fn(artist);for(const n of rows)putNews(id,n);report.news[name]=rows.length}
  catch(e){report.errors.push(`${name}:${e.message}`);providerRun(name,e.message)}
 }

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
