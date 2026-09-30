import {fetchText,eventKey,countryGuess} from "../utils.js";
import {providerRun} from "../db.js";

const VENUES=[
  {name:"La Machine du Moulin Rouge",url:"https://www.lamachinedumoulinrouge.com/agenda/",city:"Paris",country:"France"}
];
const MONTHS={janvier:1,fevrier:2,"février":2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,"août":8,septembre:9,octobre:10,novembre:11,decembre:12,"décembre":12};
const esc=s=>String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function stripHtml(s){return String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim()}
function normalize(s){return String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function artistMatch(name,text){
 const n=normalize(name).trim();const t=normalize(text);if(!n)return false;
 return new RegExp(`(^|[^a-z0-9])${esc(n).replace(/\s+/g,"\\s+")}(?=$|[^a-z0-9])`,`i`).test(t);
}
function parseAgenda(html,venue,artists){
 const text=stripHtml(html);
 const headingRe=/\b(Janvier|Février|Fevrier|Mars|Avril|Mai|Juin|Juillet|Août|Aout|Septembre|Octobre|Novembre|Décembre|Decembre)\s+(20\d{2})\b/gi;
 const headings=[];let m;
 while((m=headingRe.exec(text))) headings.push({index:m.index,month:MONTHS[m[1].toLowerCase()],year:Number(m[2])});
 const out=[];
 const eventRe=/\b(?:Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\s+(\d{2})\/(\d{2})\s+(?:Complet\s+)?Concert\s+(.{3,220}?)(?=\s+(?:Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\s+\d{2}\/\d{2}\s+|$)/gi;
 while((m=eventRe.exec(text))){
   const h=headings.filter(x=>x.index<=m.index).at(-1);if(!h)continue;
   const day=Number(m[1]),month=Number(m[2]);if(month!==h.month)continue;
   const title=m[3].replace(/\s+/g," ").trim();
   for(const artist of artists){
     if(!artistMatch(artist.name,title))continue;
     const date=`${h.year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
     const x={artistName:artist.name,title,date,time:null,venue:venue.name,city:venue.city,country:countryGuess(venue.country,venue.city,venue.name,title),url:venue.url,provider:`venue:${venue.name}`};
     out.push({...x,dedupe_key:eventKey(x)});
   }
 }
 return out;
}
export async function fetchVenueCalendars(artists){
 const out=[];
 for(const venue of VENUES){
  try{const rows=parseAgenda(await fetchText(venue.url,{},20000),venue,artists);out.push(...rows);providerRun(`venue:${venue.name}`)}
  catch(e){providerRun(`venue:${venue.name}`,e.message)}
 }
 return out;
}
export function listVenueCalendars(){return VENUES.map(v=>({name:v.name,url:v.url,format:"html",free:true,configured:true}))}
