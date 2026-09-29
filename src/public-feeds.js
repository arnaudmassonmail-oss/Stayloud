import {XMLParser} from "fast-xml-parser";
import {fetchText,countryGuess,eventKey,newsKey,parseDate} from "../utils.js";
import {providerRun} from "../db.js";

function config(){
 try{return JSON.parse(process.env.LIVE_FEEDS_JSON||"[]")}catch{return []}
}
function match(name,title,description=""){
 const a=String(name).toLowerCase().trim(),t=`${title} ${description}`.toLowerCase();
 return t.includes(a);
}
function parseIcs(text,source,artistNames){
 const lines=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
 const events=[];let cur=null;
 for(const raw of lines){
  const line=raw.trim();
  if(line==="BEGIN:VEVENT"){cur={};continue}
  if(line==="END:VEVENT"&&cur){events.push(cur);cur=null;continue}
  if(!cur)continue;
  const i=line.indexOf(":");if(i<0)continue;
  const k=line.slice(0,i).split(";")[0],v=line.slice(i+1).replace(/\\,/g,",").replace(/\\n/g," ");
  cur[k]=v;
 }
 return events.flatMap(e=>{
  const name=artistNames.find(a=>match(a,e.SUMMARY||"",e.DESCRIPTION||""));if(!name)return[];
  const dt=String(e.DTSTART||"").replace(/[^0-9TZ]/g,"");
  const date=dt.length>=8?`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`:null;
  const time=dt.length>=13?`${dt.slice(9,11)}:${dt.slice(11,13)}`:null;
  const x={artistName:name,title:e.SUMMARY||name,date,time,venue:e.LOCATION||"",city:"",country:"",url:e.URL||"",provider:`feed:${source}`};
  return [{...x,country:countryGuess(x.country,x.city,x.venue,x.title),dedupe_key:eventKey(x)}];
 });
}
function parseRss(xml,source,artistNames){
 const d=new XMLParser({ignoreAttributes:false}).parse(xml);let it=d?.rss?.channel?.item||d?.feed?.entry||[];if(!Array.isArray(it))it=[it];
 return it.flatMap(x=>{
  const title=String(x.title?.["#text"]||x.title||"");const desc=String(x.description||x.summary||"");
  const name=artistNames.find(a=>match(a,title,desc));if(!name)return[];
  const url=String(x.link?.["@_href"]||x.link||"");const pub=x.pubDate||x.published||x.updated;
  const rawDate=parseDate(pub);const date=rawDate?.slice(0,10)||null,time=rawDate?.slice(11,16)||null;
  const ev={artistName:name,title,date,time,venue:"",city:"",country:"",url,provider:`feed:${source}`};
  return [{...ev,dedupe_key:eventKey(ev)}];
 });
}
export async function fetchPublicLiveFeeds(artists){
 const cfg=config(),out=[];
 for(const f of cfg){
  try{
   const text=await fetchText(f.url);
   const names=artists.map(a=>a.name);
   const rows=(String(f.format||"").toLowerCase()==="ics"||/\\.ics($|\\?)/i.test(f.url))
     ?parseIcs(text,f.name||f.url,names):parseRss(text,f.name||f.url,names);
   out.push(...rows);providerRun(`live-feed:${f.name||f.url}`);
  }catch(e){providerRun(`live-feed:${f.name||f.url}`,e.message)}
 }
 return out;
}
export function listConfiguredFeeds(){return config().map(x=>({name:x.name||x.url,url:x.url,format:x.format||"auto"}))}
