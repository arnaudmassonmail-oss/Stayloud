// Where to buy tickets for one concert (🎫 Billets menu).
// - Ticketmaster: the Discovery API says whether Ticketmaster sells this
//   concert and gives the page of that date (needs TICKETMASTER_API_KEY).
// - Bandsintown: its events often carry the organiser's ticket link.
// Both answers are cached (one lookup serves every user).
import {fetchJson} from "../utils.js";
import {cachedJson} from "../apicache.js";

const HOUR=3600e3;
const BANDSINTOWN_APP_ID=String(process.env.BANDSINTOWN_APP_ID||"js_www.sorti-ka.com").trim();
const norm=s=>String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export const ticketmasterConfigured=()=>!!String(process.env.TICKETMASTER_API_KEY||"").trim();

// Same city: "Paris 18" / "Paris" / "PARIS" all match.
function sameCity(a,b){const x=norm(a),y=norm(b);if(!x||!y)return true;return x===y||x.startsWith(y+" ")||y.startsWith(x+" ")}
function sameBand(text,band){const t=norm(text),b=norm(band);return !!b&&(` ${t} `).includes(` ${b} `)}
function dayAfter(ymd){const d=new Date(ymd+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}

// Discovery API events -> the one for this band, date and city.
export function pickTicketmaster(data,{band,date,city}){
  const events=data?._embedded?.events||[];
  const hits=events.filter(e=>{
    if(String(e?.dates?.start?.localDate||"")!==date)return false;
    const names=[e?.name,...(e?._embedded?.attractions||[]).map(a=>a?.name)].join(" | ");
    if(!sameBand(names,band))return false;
    const v=e?._embedded?.venues?.[0];return sameCity(v?.city?.name,city);
  });
  const e=hits.find(x=>/^https?:\/\//.test(String(x?.url||"")));
  return e?{url:String(e.url),name:String(e.name||"")}:null;
}
// Bandsintown events -> ticket link of the one for this date and city.
export function pickBandsintown(events,{date,city}){
  for(const ev of Array.isArray(events)?events:[]){
    if(String(ev?.datetime||"").slice(0,10)!==date||!sameCity(ev?.venue?.city,city))continue;
    const offer=(ev?.offers||[]).find(o=>/^https?:\/\//.test(String(o?.url||""))&&!/sold\s*out/i.test(String(o?.status||"")));
    if(offer)return {url:String(offer.url),status:String(offer.status||"")};
  }
  return null;
}

async function ticketmaster({band,date,city}){
  const key=String(process.env.TICKETMASTER_API_KEY||"").trim();if(!key)return null;
  return cachedJson(`tix:tm:${norm(band)}|${date}|${norm(city)}`,v=>v?24*HOUR:6*HOUR,async()=>{
    const p=new URLSearchParams({apikey:key,keyword:band,countryCode:"FR",classificationName:"music",size:"50",
      startDateTime:`${date}T00:00:00Z`,endDateTime:`${dayAfter(date)}T12:00:00Z`});
    const data=await fetchJson(`https://app.ticketmaster.com/discovery/v2/events.json?${p}`,{headers:{Accept:"application/json"}},10000);
    return pickTicketmaster(data,{band,date,city});
  });
}
async function bandsintown({band,date,city}){
  if(!BANDSINTOWN_APP_ID)return null;
  const events=await cachedJson(`tix:bit:${norm(band)}`,12*HOUR,()=>fetchJson(`https://rest.bandsintown.com/artists/${encodeURIComponent(band)}/events?app_id=${encodeURIComponent(BANDSINTOWN_APP_ID)}&date=upcoming`,{headers:{Accept:"application/json"}},10000).then(d=>Array.isArray(d)?d.map(ev=>({datetime:ev?.datetime,venue:{city:ev?.venue?.city},offers:(ev?.offers||[]).map(o=>({url:o?.url,status:o?.status}))})):[]));
  return pickBandsintown(events,{date,city});
}

export async function findTickets({band,date,city}){
  band=String(band||"").trim().slice(0,120);date=String(date||"").slice(0,10);city=String(city||"").trim().slice(0,80);
  if(!band||!/^\d{4}-\d{2}-\d{2}$/.test(date))return {ticketmaster:null,official:null};
  const [tm,bit]=await Promise.all([ticketmaster({band,date,city}).catch(()=>null),bandsintown({band,date,city}).catch(()=>null)]);
  return {ticketmaster:tm,official:bit};
}

// "Autour de moi": Ticketmaster's metal concerts around a point (official
// API, nothing to scrape, so it cannot be blocked). Cached 6 h per area.
const GH="0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash(lat,lon,len=7){let la=[-90,90],lo=[-180,180],bit=0,ch=0,even=true,out="";
  while(out.length<len){const r=even?lo:la,v=even?lon:lat,mid=(r[0]+r[1])/2;if(v>=mid){ch=(ch<<1)|1;r[0]=mid}else{ch=ch<<1;r[1]=mid}even=!even;if(++bit===5){out+=GH[ch];bit=0;ch=0}}return out}
// Discovery API events -> concert rows (same shape as the other sources).
// Ticketmaster France files metal under several genres ("Metal", "Hard
// Rock", "Rock"…), so all music is asked for and the metal styles are kept.
const METAL_GENRE=/metal|hard ?rock|punk|hardcore|grind|doom|thrash|sludge|stoner|\bcore\b|deathcore|metalcore/i;
export function isMetalEvent(e){return (e?.classifications||[]).some(c=>METAL_GENRE.test([c?.genre?.name,c?.subGenre?.name].filter(Boolean).join(" ")))}
export function ticketmasterRows(data,{metalOnly=false}={}){
  const out=[];
  for(const e of data?._embedded?.events||[]){
    if(metalOnly&&!isMetalEvent(e))continue;
    const date=String(e?.dates?.start?.localDate||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    if(/cancel/i.test(String(e?.dates?.status?.code||"")))continue;
    const v=e?._embedded?.venues?.[0]||{},bands=(e?._embedded?.attractions||[]).map(a=>String(a?.name||"").trim()).filter(Boolean);
    const lat=Number(v?.location?.latitude),lon=Number(v?.location?.longitude);
    out.push({title:String(e.name||bands.join(" + ")).trim(),artist:bands[0]||"",date,time:/^\d{2}:\d{2}/.test(String(e?.dates?.start?.localTime||""))?String(e.dates.start.localTime).slice(0,5):null,
      venue:String(v.name||"").trim(),city:String(v?.city?.name||"").trim(),country:v?.country?.countryCode==="FR"?"France":String(v?.country?.name||""),url:String(e.url||""),provider:"Ticketmaster",
      ...(Number.isFinite(lat)&&Number.isFinite(lon)?{_place:{coordinates:{latitude:lat,longitude:lon}}}:{})});
  }
  return out;
}
export async function ticketmasterNearby(lat,lon,radiusKm=50){
  const key=String(process.env.TICKETMASTER_API_KEY||"").trim();
  if(!key||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon)))return {rows:[],configured:!!key};
  const r=Math.max(10,Math.min(150,Math.round(Number(radiusKm)||50)+20));
  const rows=await cachedJson(`tm:near:${Number(lat).toFixed(1)}|${Number(lon).toFixed(1)}|${r}`,6*HOUR,async()=>{
    const rows=[];
    for(const page of [0,1]){
      const p=new URLSearchParams({apikey:key,classificationName:"music",geoPoint:geohash(Number(lat),Number(lon)),radius:String(r),unit:"km",size:"200",page:String(page),sort:"date,asc",startDateTime:new Date().toISOString().slice(0,19)+"Z"});
      const data=await fetchJson(`https://app.ticketmaster.com/discovery/v2/events.json?${p}`,{headers:{Accept:"application/json"}},10000);
      rows.push(...ticketmasterRows(data,{metalOnly:true}));
      if((Number(data?.page?.totalPages)||1)<=page+1)break;
    }
    return rows;
  });
  return {rows,configured:true};
}
