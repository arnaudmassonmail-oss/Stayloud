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
