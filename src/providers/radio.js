// Metal web radios (Clips & Radio › Radio) from Radio Browser, the free and
// open directory of internet radios (https://www.radio-browser.info, no key).
// Only stations that work in the app are kept: last check OK, HTTPS stream
// (an http stream is blocked inside an https page), MP3/AAC (plays on iPhone
// and Android), no HLS. Lists are shared by every user (apicache.js).
import {cachedJson} from "../apicache.js";

const SERVERS=["de1","de2","nl1","fi1","at1"].map(s=>`https://${s}.api.radio-browser.info`);
const UA="STAYLOUD-Radar-Metal/1.0 (stayloud-radar.online)";
// App styles -> Radio Browser tags (exact tag match).
export const RADIO_STYLES={
  "Metal":["metal","heavy metal"],
  "Alternative":["alternative metal"],
  "Black Metal":["black metal"],
  "Death Metal":["death metal","brutal death metal"],
  "Deathcore":["deathcore"],
  "Doom / Stoner":["doom metal","stoner rock","stoner metal","sludge metal"],
  "Hardcore":["hardcore punk","metallic hardcore","beatdown"],
  "Metalcore":["metalcore"],
  "Nu Metal":["nu metal","nu-metal","numetal"],
  "Post-Hardcore":["post-hardcore"],
  "Progressif":["progressive metal","prog metal","djent"],
  "Thrash Metal":["thrash metal","thrash"],
  "Punk":["punk","punk rock","oi"],
  "Grunge":["grunge"],
  "Rock":["hard rock"]
};
// "hardcore" alone is also a techno style: such stations are left out.
const NOT_METAL=/\b(gabber|hardstyle|techno|edm|trance|house|frenchcore|uptempo|dance|schlager|christian|worship|pop)\b/i;
const OK_CODEC=/^(mp3|aac|aac\+|he-aac|aacp)$/i;

async function rb(path){
  let err;
  for(const base of SERVERS){
    const ac=new AbortController(),t=setTimeout(()=>ac.abort(),8000);
    try{
      const r=await fetch(base+path,{signal:ac.signal,headers:{Accept:"application/json","User-Agent":UA}});
      if(!r.ok)throw new Error(`Radio Browser HTTP ${r.status}`);
      return await r.json();
    }catch(e){err=e}finally{clearTimeout(t)}
  }
  throw err||new Error("Radio Browser indisponible");
}
const known=new Map(); // stationuuid -> station (for now playing / clicks)
function clean(s,style){
  const url=String(s.url_resolved||s.url||"").trim();
  return {id:String(s.stationuuid||""),name:String(s.name||"").replace(/\s+/g," ").trim().slice(0,80),url,
    favicon:/^https:\/\//i.test(String(s.favicon||""))?String(s.favicon):"",
    tags:String(s.tags||"").split(",").map(t=>t.trim()).filter(Boolean).slice(0,6),
    country:String(s.countrycode||"").toUpperCase(),codec:String(s.codec||""),bitrate:Number(s.bitrate)||0,
    votes:Number(s.votes)||0,clicks:Number(s.clickcount)||0,homepage:/^https?:\/\//i.test(String(s.homepage||""))?String(s.homepage):"",style};
}
function usable(s){
  const url=String(s.url_resolved||s.url||"");
  return Number(s.lastcheckok)===1&&/^https:\/\//i.test(url)&&!Number(s.hls)&&!/\.m3u8(\?|$)/i.test(url)&&OK_CODEC.test(String(s.codec||"").trim())&&!NOT_METAL.test(String(s.tags||""))&&String(s.name||"").trim();
}
const normName=n=>String(n||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
async function stationsForStyle(style){
  const tags=RADIO_STYLES[style];if(!tags)return [];
  const lists=await Promise.all(tags.map(tag=>cachedJson(`radio:tag:${tag}`,d=>Array.isArray(d)&&d.length?12*3600e3:3600e3,
    ()=>rb(`/json/stations/search?tag=${encodeURIComponent(tag)}&tagExact=true&hidebroken=true&order=clickcount&reverse=true&limit=80`)).catch(()=>[])));
  const seen=new Set(),out=[];
  for(const s of lists.flat()){
    if(!usable(s))continue;const k=normName(s.name);if(!k||seen.has(k)||seen.has(s.stationuuid))continue;seen.add(k);seen.add(s.stationuuid);
    out.push(clean(s,style));
  }
  out.sort((a,b)=>(b.votes+b.clicks*2)-(a.votes+a.clicks*2));
  const top=out.slice(0,20);for(const s of top)known.set(s.id,s);return top;
}
// One style, or every style (a row per style, a station in one row only).
export async function radioStations(style="all"){
  if(style!=="all")return {groups:[{style,stations:await stationsForStyle(style)}]};
  const names=Object.keys(RADIO_STYLES),used=new Set(),groups=[];
  const all=await Promise.all(names.map(n=>stationsForStyle(n).catch(()=>[])));
  names.forEach((n,i)=>{const st=all[i].filter(s=>!used.has(s.id));st.forEach(s=>used.add(s.id));if(st.length)groups.push({style:n,stations:st})});
  return {groups};
}
async function stationById(id){
  if(known.has(id))return known.get(id);
  if(!/^[0-9a-f-]{36}$/i.test(id))return null;
  const d=await rb(`/json/stations/byuuid/${id}`).catch(()=>[]);const s=Array.isArray(d)?d[0]:null;
  if(!s||!usable(s))return null;const c=clean(s,"");known.set(id,c);return c;
}
// Look up several stations (favorites kept on the phone) by id.
export async function radioByIds(ids){
  const out=[];for(const id of ids.slice(0,30)){const s=await stationById(String(id)).catch(()=>null);if(s)out.push(s)}return out;
}
// "En ce moment": the title the radio announces in its stream (ICY metadata).
// Only stations served by this list can be read (never an arbitrary URL).
const npCache=new Map(),npInflight=new Map();
export async function radioNowPlaying(id){
  const hit=npCache.get(id);if(hit&&Date.now()<hit.until)return hit.v;
  if(npInflight.has(id))return npInflight.get(id);
  const job=(async()=>{
    const st=await stationById(id);if(!st)return {title:null};
    let title=null,noMeta=false;
    const ac=new AbortController(),t=setTimeout(()=>ac.abort(),7000);
    try{
      const r=await fetch(st.url,{signal:ac.signal,headers:{"Icy-MetaData":"1","User-Agent":UA}});
      const metaint=Number(r.headers.get("icy-metaint"))||0;
      if(!metaint||metaint>65536||!r.body){noMeta=true}else{
        const reader=r.body.getReader();let buf=new Uint8Array(0);
        while(buf.length<metaint+1+255*16){const {value,done}=await reader.read();if(done)break;const n=new Uint8Array(buf.length+value.length);n.set(buf);n.set(value,buf.length);buf=n;
          if(buf.length>metaint){const len=buf[metaint]*16;if(buf.length>=metaint+1+len){const meta=new TextDecoder("utf-8").decode(buf.slice(metaint+1,metaint+1+len));const m=meta.match(/StreamTitle='([^']*)'/);title=m?m[1].trim()||null:null;break}}}
        reader.cancel().catch(()=>{});
      }
    }catch{}finally{clearTimeout(t);ac.abort()}
    if(title&&/^(unknown|-|\s*-\s*)$/i.test(title))title=null;
    const v={title:title?title.slice(0,160):null};
    npCache.set(id,{v,until:Date.now()+(noMeta?10*60e3:20e3)});if(npCache.size>500)npCache.delete(npCache.keys().next().value);
    return v;
  })().finally(()=>npInflight.delete(id));
  npInflight.set(id,job);return job;
}
// Radio Browser asks apps to report a play (its popularity ranking).
export function radioClick(id){if(/^[0-9a-f-]{36}$/i.test(id))rb(`/json/url/${id}`).catch(()=>{})}
