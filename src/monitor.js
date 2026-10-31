// Daily check of the concert sources and the outside services, run by the
// server itself every morning. It reads one page of each source (as the
// admin "Tester les sources" button does), looks at the quality of what was
// read (concerts found, cities that can be placed), checks the quotas of
// ScraperAPI, YouTube, Ticketmaster and setlist.fm, and e-mails the
// administrator (plus a message in "Messages reçus") when something is
// wrong. The same problems are not sent again for 3 days.
import {testSources} from "./providers/discovery.js";
import {d1ApiCacheGet,d1ApiCachePut} from "./d1.js";

const KEY="monitor:last",RESEND_AFTER=3*24*3600e3;
const MIN_ROWS={cm:10,sdm:10,sk2:1};
let sink=null,last=null;
export function setMonitorSink(fn){sink=fn}


// Source test results -> problems found ("" when all is fine).
export function sourceProblems(results){
  const out=[];
  for(const r of results||[]){
    if(r.id==="bi"||r.id==="tm")continue; // known limits: Bandsintown blocks the relay, Ticketmaster France has no location search
    const best=(r.attempts||[]).reduce((b,a)=>a.rows>(b?.rows||0)?a:b,null);
    const min=MIN_ROWS[r.id]||1;
    if(!best||best.rows<min){
      const why=(r.attempts||[]).map(a=>`${a.via} : ${a.status?"HTTP "+a.status:"pas de réponse"}, ${a.rows} concert(s) — ${String(a.title||"").slice(0,90)}`).join(" | ");
      out.push(`${r.name} : ${best?.rows||0} concert lu (au moins ${min} attendus). ${why}`);
      continue;
    }
    if(best.badCities!=null&&best.rows&&best.badCities/best.rows>0.3)out.push(`${r.name} : ${best.badCities} concerts sur ${best.rows} ont une ville illisible (ex. « ${String(best.badSample||"").slice(0,80)} ») : la présentation de la page a sans doute changé.`);
  }
  return out;
}

async function getJson(url,opts={}){const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),15000);
  try{const r=await fetch(url,{...opts,signal:ctl.signal});let body=null;try{body=await r.json()}catch{}return {status:r.status,body}}finally{clearTimeout(t)}}

// Quotas and keys of the outside services (each check costs at most 1 unit).
async function serviceProblems(){
  const out=[],info={};
  const sk=String(process.env.SCRAPERAPI_KEY||"").trim();
  if(sk){try{const r=await getJson(`https://api.scraperapi.com/account?api_key=${encodeURIComponent(sk)}`);
    const used=Number(r.body?.requestCount),limit=Number(r.body?.requestLimit);
    if(r.status!==200)out.push(`ScraperAPI : compte illisible (HTTP ${r.status}), la clé SCRAPERAPI_KEY est peut-être invalide.`);
    else if(Number.isFinite(used)&&Number.isFinite(limit)&&limit>0){info.scraperapi=`${used} / ${limit} crédits utilisés`;
      if(used/limit>=0.8)out.push(`ScraperAPI : ${used} crédits utilisés sur ${limit} ce mois-ci (${Math.round(100*used/limit)} %). Au-delà, Concerts-Metal, Sueur de Metal et Songkick ne seront plus lus.`)}}
   catch(e){out.push(`ScraperAPI : pas de réponse (${e?.message||e}).`)}}
  else if(!process.env.JINA_API_KEY)out.push("Aucun relais configuré (SCRAPERAPI_KEY vide) : les agendas qui bloquent le serveur ne peuvent pas être lus.");
  const yt=String(process.env.YOUTUBE_API_KEY||"").trim();
  if(yt){try{const r=await getJson(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(yt)}`);
    if(r.status!==200){const reason=r.body?.error?.errors?.[0]?.reason||"";out.push(`YouTube : HTTP ${r.status}${reason?" ("+reason+")":""}. ${/quota/i.test(reason)?"Le quota du jour est épuisé : les clips reviendront demain.":"La clé YOUTUBE_API_KEY est peut-être invalide."}`)}}
   catch(e){out.push(`YouTube : pas de réponse (${e?.message||e}).`)}}
  const tm=String(process.env.TICKETMASTER_API_KEY||"").trim();
  if(tm){try{const r=await getJson(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(tm)}&countryCode=FR&size=1`);
    if(r.status!==200)out.push(`Ticketmaster : HTTP ${r.status}. La clé TICKETMASTER_API_KEY est peut-être invalide ou son quota épuisé : le bouton 🎫 ne trouvera plus Ticketmaster.`)}
   catch(e){out.push(`Ticketmaster : pas de réponse (${e?.message||e}).`)}}
  const fm=String(process.env.SETLISTFM_API_KEY||"").trim();
  if(fm){try{const r=await getJson("https://api.setlist.fm/rest/1.0/search/artists?artistName=Gojira",{headers:{"x-api-key":fm,Accept:"application/json"}});
    if(r.status!==200)out.push(`setlist.fm : HTTP ${r.status}. La clé SETLISTFM_API_KEY est peut-être invalide : les setlists ne s'afficheront plus.`)}
   catch(e){out.push(`setlist.fm : pas de réponse (${e?.message||e}).`)}}
  return {problems:out,info};
}

async function sendEmail(subject,text){
  const apiKey=String(process.env.RESEND_API_KEY||"").trim(),from=String(process.env.EMAIL_FROM||"").trim();
  const to=String(process.env.ALERT_EMAIL||"contact@stayloud-radar.online").trim();
  if(!apiKey||!from||!to)return false;
  const html=`<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px"><h2 style="color:#c40010">STAYLOUD · contrôle du jour</h2>${text.split("\n").map(l=>l?`<p style="margin:6px 0">${l.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}</p>`:"").join("")}</div>`;
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html})});
  return r.ok;
}

export async function runDailyCheck({force=false,now=Date.now()}={}){
  let results=[],srcErr="";
  try{results=await testSources()}catch(e){srcErr=String(e?.message||e)}
  const svc=await serviceProblems();
  const problems=[...(srcErr?[`Test des sources impossible : ${srcErr}`]:[]),...sourceProblems(results),...svc.problems];
  const summary=results.map(r=>{const best=(r.attempts||[]).reduce((b,a)=>a.rows>(b?.rows||0)?a:b,null);return `${r.name} : ${best?.rows||0}`}).join(" · ");
  const sig=problems.map(p=>p.split(" :")[0]).sort().join("|");
  let prev=null;try{prev=(await d1ApiCacheGet(KEY))?.value}catch{}
  const repeat=prev&&prev.sig===sig&&now-(prev.alertedAt||0)<RESEND_AFTER;
  let alerted=false,emailed=false;
  if(problems.length&&(force||!repeat)){
    const text=`Le contrôle automatique de ce matin a trouvé ${problems.length} problème${problems.length>1?"s":""} :\n\n${problems.map(p=>"• "+p).join("\n")}\n\nConcerts lus : ${summary||"?"}${svc.info.scraperapi?`\nScraperAPI : ${svc.info.scraperapi}`:""}\n\nDétails : Mon compte › Administration › État des sources.`;
    try{emailed=await sendEmail(`STAYLOUD : ${problems.length} problème${problems.length>1?"s":""} détecté${problems.length>1?"s":""}`,text)}catch(e){console.error("Monitor e-mail:",e?.message||e)}
    try{await sink?.(`Contrôle du jour : ${problems.length} problème${problems.length>1?"s":""}`,text);alerted=true}catch(e){console.error("Monitor message:",e?.message||e)}
  }
  last={at:now,ok:!problems.length,problems,summary,info:svc.info,emailed,alerted,sig,alertedAt:alerted||emailed?now:(prev?.alertedAt||0)};
  try{await d1ApiCachePut(KEY,last,now)}catch{}
  return last;
}
export async function lastDailyCheck(){if(last)return last;try{return (await d1ApiCacheGet(KEY))?.value||null}catch{return null}}
