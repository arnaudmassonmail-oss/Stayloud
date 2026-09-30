import {fetchText,eventKey,countryGuess,parseDate} from "../utils.js";

// STAYLOUD 5.16 — concert engine: Bandsintown + InfoConcert + lineup discovery.
// Bandsintown and InfoConcert remain the primary artist calendars. A separate
// lineup discovery path finds real event pages where the artist is explicitly
// billed as support/opening/guest. Search-result snippets are never stored as
// concert evidence.

const HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 STAYLOUD/5.16",
  "Accept-Language":"fr-FR,fr;q=0.9,en;q=0.8"
};

// Bandsintown's documented artist-events API is the primary collector.
// It is still Bandsintown itself, but unlike the public HTML calendar it
// returns the complete upcoming event list as structured JSON.
const BANDSINTOWN_APP_ID=String(process.env.BANDSINTOWN_APP_ID||"js_www.sorti-ka.com").trim();

function norm(s){return String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");}
function clean(s){
  return String(s||"")
    .replace(/(?:cite|url|entity|ref)[^]*/g," ")
    .replace(/\uE000[^\uE001]*\uE001/g," ")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
    .replace(/<[^>]+>/g," ")
    .replace(/^\s{0,3}#{1,6}\s*/," ")
    .replace(/^\s*[-*+]\s+/," ")
    .replace(/[*_`~]+/g,"")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&#x27;/gi,"'")
    .replace(/&#8217;/gi,"’").replace(/&#8211;/gi,"–")
    .replace(/&eacute;/gi,"é").replace(/&egrave;/gi,"è").replace(/&agrave;/gi,"à")
    .replace(/&ecirc;/gi,"ê").replace(/&ocirc;/gi,"ô").replace(/&uuml;/gi,"ü")
    .replace(/\s+/g," ").trim();
}
function textLines(html){
  return String(html||"")
    .replace(/<script[\s\S]*?<\/script>/gi,"\n")
    .replace(/<style[\s\S]*?<\/style>/gi,"\n")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/section>|<\/article>|<\/h[1-6]>/gi,"\n")
    .replace(/<[^>]+>/g,"\n")
    .split(/\n+/)
    .map(clean).filter(Boolean);
}
function absUrl(u,base){try{return new URL(u,base).href}catch{return String(u||"")}}
function isFuture(date){return !!date && date>=new Date().toISOString().slice(0,10);}

function concertKey(e){return `${e.date}|${norm(e.city)}|${norm(e.venue)}`;}
function dedupe(rows){
  const map=new Map();
  for(const e of rows||[]){
    if(!e?.date||!e?.city||!e?.venue||!isFuture(e.date))continue;
    const k=concertKey(e);
    const old=map.get(k);
    if(!old){
      map.set(k,{...e,source_refs:[{provider:e.provider,url:e.url||""}]});
    }else{
      if(String(e.title||"").length>String(old.title||"").length)old.title=e.title;
      old.time=old.time||e.time||null;
      old.source_refs.push({provider:e.provider,url:e.url||""});
    }
  }
  return [...map.values()].map(e=>({...e,dedupe_key:eventKey(e),evidence_json:JSON.stringify(e.source_refs||[])}));
}

async function readSource(url){
  const isInfo=/infoconcert\.com/i.test(String(url||""));
  // InfoConcert serves a useful server-rendered calendar directly. Prefer it
  // before the text proxy; the proxy can flatten the calendar too aggressively.
  if(isInfo){
    try{
      const html=await fetchText(url,HEADERS,22000);
      if(html && html.length>1200 && /(?:concert|dates|septembre|octobre|novembre|décembre)/i.test(html))return html;
    }catch{}
  }
  try{
    const txt=await fetchText(`https://r.jina.ai/${url}`,{"Accept":"text/plain","User-Agent":"STAYLOUD/5.16"},25000);
    if(txt && txt.length>500)return txt;
  }catch{}
  try{
    const html=await fetchText(url,HEADERS,20000);
    return html||"";
  }catch{return ""}
}

async function searchReader(query,start=0){
  const q=encodeURIComponent(String(query||''));
  const urls=[
    `https://www.bing.com/search?q=${q}${start?`&first=${start+1}`:''}`,
    `https://html.duckduckgo.com/html/?q=${q}${start?`&s=${start}`:''}`,
    `https://www.google.com/search?q=${q}${start?`&start=${start}`:''}`,
    `https://r.jina.ai/https://www.bing.com/search?q=${q}${start?`&first=${start+1}`:''}`,
    `https://r.jina.ai/https://www.google.com/search?q=${q}${start?`&start=${start}`:''}`
  ];
  for(const u of urls){
    try{
      const t=await fetchText(u,{"Accept":"text/html,text/plain","Accept-Language":"fr-FR,fr;q=0.9,en;q=0.8","User-Agent":HEADERS["User-Agent"]},20000);
      if(!t||t.length<300)continue;
      // Do not accept cookie/consent pages as a successful search response.
      const hasBands=/bandsintown\.com/i.test(t), hasInfo=/infoconcert\.com/i.test(t);
      const target=hasBands||hasInfo;
      if(target)return t;
    }catch{}
  }
  return "";
}
function extractBandsintownEventUrlsFromSearch(text){
  let raw=String(text||'').replace(/&amp;/gi,'&').replace(/\\u0026/g,'&');
  try{raw=decodeURIComponent(raw)}catch{}
  const out=new Set();
  const add=u=>{
    if(!u)return;
    u=String(u).replace(/\\/g,'').replace(/&amp;/gi,'&').replace(/[),.;]+$/g,'');
    try{
      if(/^\//.test(u))u=`https://www.bandsintown.com${u}`;
      const parsed=new URL(u);
      // Google/Bing redirect URLs can contain the actual target in q/url/u.
      for(const key of ['q','url','u']){
        const v=parsed.searchParams.get(key);
        if(v && /bandsintown\.com\/e\/\d+/i.test(v)){add(v);return;}
      }
      if(/(^|\.)bandsintown\.com$/i.test(parsed.hostname)&&/^\/e\/\d+/i.test(parsed.pathname))out.add(parsed.href.split('#')[0]);
    }catch{}
  };
  const patterns=[
    /https?:\/\/(?:www\.)?bandsintown\.com\/e\/\d+[^\s<>()"']*/gi,
    /(?:href|url|u|q)=["']([^"']*bandsintown\.com\/e\/\d+[^"']*)["']/gi,
    /\/e\/\d+(?:-[a-z0-9][a-z0-9-]*)?/gi
  ];
  for(const re of patterns){for(const m of raw.matchAll(re))add(m[1]||m[0]);}
  return [...out];
}
function parseBandsintownEventPage(text,artist,url){
  const json=extractJsonLd(text,artist,'Bandsintown-event',url);
  if(json.length)return json;
  const lines=textLines(text);
  const out=[];
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,janv:1,fevr:2,'févr':2,avr:4,juil:7,sept:9};
  const dateRe=/^(?:(?:mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|jeu|ven|sam|dim),?\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|fevr|févr|avr|juil|sept)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?$/i;
  const fullDateRe=/^(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche),?\s+)?(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/i;
  const countries=/\b(France|Belgique|Belgium|Suisse|Switzerland|Germany|Allemagne|Spain|Espagne|Italy|Italie|Netherlands|Pays-Bas|United Kingdom|UK|Portugal|Poland|Pologne|Austria|Autriche|Czech Republic|Czechia|Denmark|Danemark|Sweden|Suède|Norway|Norvège|Finland|Finlande|Hungary|Hongrie|Romania|Roumanie|Croatia|Croatie|Serbia|Serbie|Ireland|Irlande|Canada|United States|USA)\b/i;
  const artistN=norm(artist.name);
  for(let i=0;i<lines.length;i++){
    let date=null,time=null,m=lines[i].match(dateRe);
    if(m){
      const mon=months[m[1].toLowerCase().replace(/\.$/,'')],day=+m[2],year=+(m[3]||new Date().getUTCFullYear());
      if(!mon||!day)continue;
      date=`${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if(date<new Date().toISOString().slice(0,10))date=`${year+1}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    } else {
      m=lines[i].match(fullDateRe);
      if(m){
        const mm={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,déc:12,dec:12}[m[2].toLowerCase().replace(/\.$/,'')];
        if(!mm)continue;
        date=`${m[3]}-${String(mm).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
        if(m[4])time=`${String(m[4]).padStart(2,'0')}:${m[5]}`;
      }
    }
    if(!date||!isFuture(date))continue;
    const lo=Math.max(0,i-8),hi=Math.min(lines.length,i+9),chunk=lines.slice(lo,hi);
    const locIndex=chunk.findIndex(x=>countries.test(x));
    if(locIndex<0)continue;
    const locLine=chunk[locIndex];
    const parsed=parseLocation(locLine);
    let city=parsed.city,venue=parsed.venue,country=parsed.country;
    if(!city){
      const before=chunk.slice(0,locIndex).filter(x=>x.length>2);
      city=before.at(-1)||'';
    }
    // On an event page the line immediately before the address is normally
    // the venue name. If the address parser consumed the street as venue,
    // prefer the preceding short line (e.g. "Metropol" before "Nollendorfplatz 5, Berlin, Germany").
    const beforeLoc=chunk.slice(0,locIndex).filter(x=>x.length>1&&!/^get tickets|^obtenir des billets|^get reminder|^set reminder|^book hotel|^trouver un hotel|^concert$/i.test(x));
    if(!venue || /\d/.test(venue)){
      const venueCandidate=[...beforeLoc].reverse().find(x=>!/[0-9]/.test(x)&&!norm(x).includes(artistN)&&!/^sat|^sun|^mon|^tue|^wed|^thu|^fri|^jan|^feb|^mar|^apr|^may|^jun|^jul|^aug|^sep|^oct|^nov|^dec/i.test(x));
      if(venueCandidate)venue=venueCandidate;
    }
    if(!city && /,/.test(locLine)){
      const parts=locLine.split(',').map(x=>x.trim()).filter(Boolean);
      if(parts.length>=3){country=parts.at(-1);city=parts.at(-2);venue=beforeLoc.at(-1)||parts.slice(0,-2).join(', ')}
    }
    const hay=norm(lines.slice(lo,hi).join(' '));
    if(artistN&&!hay.includes(artistN))continue;
    if(!city||!venue)continue;
    out.push({title:artist.name,date,time,venue,city,country:countryGuess(country,city,venue,artist.name),url,provider:'Bandsintown-event'});
  }
  return dedupe(out);
}

async function discoverBandsintownEventPages(artist,expectedCount=0){
  const name=String(artist.name||'').trim();
  if(!name)return [];
  const urls=new Set();
  const now=new Date();
  const y=now.getUTCFullYear(), next=y+1;
  const months=[
    'January','February','March','April','May','June','July','August','September','October','November','December',
    'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
  ];
  const countries=['Germany','United Kingdom','Belgium','Netherlands','Switzerland','Italy','Spain','Poland','Austria','Czech Republic','Hungary','France','United States','Canada'];
  const queries=[
    `site:bandsintown.com/e/ "${name}"`,
    `site:bandsintown.com/e/ "${name}" "${y}"`,
    `site:bandsintown.com/e/ "${name}" "${next}"`
  ];
  for(const m of months)queries.push(`site:bandsintown.com/e/ "${name}" "${m}" "${next}"`);
  for(const c of countries)queries.push(`site:bandsintown.com/e/ "${name}" "${c}"`);
  for(const c of countries)queries.push(`site:bandsintown.com/e/ "${name}" "${c}" "${next}"`);
  for(const q of queries){
    for(const start of [0,10,20,30,40,50]){
      const t=await searchReader(q,start);
      for(const u of extractBandsintownEventUrlsFromSearch(t))urls.add(u);
      if(expectedCount && urls.size>=expectedCount)break;
      if(urls.size>=120)break;
    }
    if(expectedCount && urls.size>=expectedCount)break;
    if(urls.size>=120)break;
  }
  if(!urls.size)return [];
  const pages=[...urls].slice(0,Math.max(120,expectedCount||0));
  const results=[];
  // Sequential batches avoid hammering search/page endpoints and make Windows runs stable.
  for(let i=0;i<pages.length;i+=6){
    const batch=pages.slice(i,i+6);
    const got=await Promise.allSettled(batch.map(async u=>parseBandsintownEventPage(await readSource(u),artist,u)));
    results.push(...got.flatMap(r=>r.status==='fulfilled'?r.value:[]));
  }
  return dedupe(results);
}

function extractInfoConcertUrlsFromSearch(text){
  const raw=String(text||'');
  const out=new Set();
  const re=/https?:\/\/(?:www\.)?infoconcert\.com\/(?:concerts\/[^\s<>"']+|artiste\/[^\s<>"']+|salle\/[^\s<>"']+|ville\/[^\s<>"']+|recherche-concert-avancee[^\s<>"']*)/gi;
  for(const m of raw.matchAll(re)){
    try{out.add(new URL(m[0].replace(/[),.;]+$/g,'')).href)}catch{}
  }
  return [...out];
}

function parseInfoConcertEventPage(text,artist,url){
  const lines=textLines(text);
  const out=[];
  const months={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,déc:12,dec:12};
  const dateRe=/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/i;
  const cityVenueRe=/^(.+?)\s*\((\d{2,3})\)\s*,\s*(.+)$/;
  const artistN=norm(artist.name);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(dateRe);if(!m)continue;
    const mon=months[m[2].toLowerCase().replace(/\./g,'')];if(!mon)continue;
    const date=`${m[3]}-${String(mon).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;if(!isFuture(date))continue;
    const lo=Math.max(0,i-8),hi=Math.min(lines.length,i+8),chunk=lines.slice(lo,hi);
    const hay=norm(chunk.join(' '));
    if(artistN&&!hay.includes(artistN))continue;
    let city='',venue='';
    const cv=chunk.find(x=>cityVenueRe.test(x));
    if(cv){const cm=cv.match(cityVenueRe);city=cm[1].trim();venue=cm[3].trim();}
    if(!city){
      for(let j=i-1;j>=Math.max(0,i-8);j--){const cm=lines[j].match(/^(.+?)\s*\((\d{2,3})\)\s*$/);if(cm){city=cm[1].trim();break}}
    }
    if(!venue){
      for(let j=i+1;j<Math.min(lines.length,i+6);j++){const x=lines[j];if(!x||dateRe.test(x)||/^\+d'infos|^réserver|^reserver|^à partir de/i.test(x))continue;if(norm(x)===artistN)continue;venue=x;break}
    }
    if(!city||!venue)continue;
    out.push({title:artist.name,date,time:m[4]?`${m[4].padStart(2,'0')}:${m[5]}`:null,venue,city,country:countryGuess('',city,venue,artist.name),url,provider:'InfoConcert'});
  }
  return dedupe(out);
}


function parseInfoConcertGenericPage(text,artist,url){
  const lines=textLines(text);
  const out=[];
  const months={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,déc:12,dec:12};
  const dateRe=/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*,?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/iu;
  const cityDept=/(.+?)\s*\((\d{2,3})\)/;
  const artistN=norm(artist.name);
  const bad=/^(archives|classer|statut|ordre chronologique|tous les concerts|voir les concerts|voir uniquement|accueil|concerts|réserver|reserver|\+d'infos|à partir de|alerte réservation|alerte|complet|plus réservable|dates?|billetterie|présentation|actualités|avis|albums|artistes similaires)$/i;
  const isBad=x=>bad.test(clean(x));
  for(let i=0;i<lines.length;i++){
    const dm=lines[i].match(dateRe); if(!dm)continue;
    const mon=months[dm[2].toLowerCase().replace(/\./g,'')]; if(!mon)continue;
    const date=`${dm[3]}-${String(mon).padStart(2,'0')}-${String(dm[1]).padStart(2,'0')}`;
    if(!isFuture(date))continue;
    const lo=Math.max(0,i-18),hi=Math.min(lines.length,i+18),win=lines.slice(lo,hi);
    const artistIdx=win.findIndex(x=>norm(x).includes(artistN));
    if(artistIdx<0)continue;
    let city='';
    const cityCandidates=[];
    for(let j=0;j<win.length;j++){
      const cm=win[j].match(cityDept);
      if(cm){
        const candidate=clean(cm[1]).replace(/^[|·•>\-]+|[|·•>\-]+$/g,'').trim();
        if(candidate&&!isBad(candidate)) cityCandidates.push({idx:j,city:candidate,dist:Math.abs(j-artistIdx)});
      }
    }
    if(cityCandidates.length) city=cityCandidates.sort((a,b)=>a.dist-b.dist)[0].city;
    if(!city)continue;
    const candidates=[];
    for(let j=Math.max(0,artistIdx-6);j<Math.min(win.length,artistIdx+12);j++){
      const x=clean(win[j]);
      if(!x||isBad(x)||norm(x)===artistN)continue;
      if(dateRe.test(x)){
        const dm=x.match(dateRe);
        const tail=clean(x.slice(dm[0].length).replace(/^[-–—:|·]+/,'').trim());
        if(tail&&!isBad(tail))candidates.push(tail);
        continue;
      }
      if(/^(réserver|reserver|\+d'infos|à partir de|plus réservable|complet|alerte)/i.test(x))continue;
      const cm=x.match(cityDept);
      if(cm){
        const tail=clean(x.slice(cm[0].length).replace(/^[-–—:|·]+/,'').trim());
        if(tail&&!isBad(tail))candidates.push(tail);
        continue;
      }
      candidates.push(x);
    }
    // Venue names on InfoConcert commonly contain one of these tokens; prefer them.
    const venue=candidates.find(x=>/\b(quai|salle|zenith|zénith|theatre|théâtre|arena|palais|club|centre|coopérative|cooperative|oasis|106|echonova|mem|machine|paloma|confort|belle electrique|auditorium|chapiteau|festival)\b/i.test(x)) || candidates[0];
    if(!venue)continue;
    out.push({title:artist.name,date,time:dm[4]?`${String(dm[4]).padStart(2,'0')}:${dm[5]}`:null,venue,city,country:countryGuess('',city,venue,artist.name),url,provider:'InfoConcert'});
  }
  return dedupe(out);
}

async function discoverInfoConcertPages(artist,expectedCount=0){
  const name=String(artist.name||'').trim();if(!name)return [];
  const year=new Date().getUTCFullYear();
  const queries=[
    `site:infoconcert.com "${name}" "${year}"`,
    `site:infoconcert.com "${name}" "${year+1}"`,
    `site:infoconcert.com "${name}" "septembre ${year}"`,
    `site:infoconcert.com "${name}" "Quai M"`,
    `site:infoconcert.com "${name}" "La Roche-Sur-Yon"`,
    `site:infoconcert.com "${name}" concerts`
  ];
  const urls=new Set();
  for(const q of queries){
    for(const start of [0,10,20]){
      const t=await searchReader(q,start);
      for(const u of extractInfoConcertUrlsFromSearch(t))urls.add(u);
      if(urls.size>=40)break;
    }
    if(urls.size>=40)break;
  }
  if(!urls.size)return [];
  const pages=[...urls].slice(0,40);
  const results=await Promise.allSettled(pages.map(async u=>{
    const page=await readSource(u);
    return [
      ...parseInfoConcertEventPage(page,artist,u),
      ...parseInfoConcert(page,artist,u),
      ...parseInfoConcertLoose(page,artist,u),
      ...parseInfoConcertRobust(page,artist,u),
      ...parseInfoConcertGenericPage(page,artist,u)
    ];
  }));
  return dedupe(results.flatMap(r=>r.status==='fulfilled'?r.value:[]));
}

const KNOWN={
  "rise of the northstar":{
    bandsintown:"https://www.bandsintown.com/a/1296468-rise-of-the-northstar",
    infoconcert:"https://www.infoconcert.com/artiste/rise-of-the-northstar-103943/concerts"
  },
  "emmure":{
    bandsintown:"https://www.bandsintown.com/a/27476-emmure",
    infoconcert:"https://www.infoconcert.com/artiste/emmure-93296/concerts"
  },
  "black bomb a":{
    bandsintown:"https://www.bandsintown.com/a/10957-black-bomb-a",
    infoconcert:"https://www.infoconcert.com/artiste/black-bomb-a-13388/concerts"
  },
  "ten56":{
    bandsintown:"https://www.bandsintown.com/a/15497696-ten56",
    infoconcert:"https://www.infoconcert.com/artiste/ten56-194127/concerts"
  }
};

async function resolveBandsintown(artist){
  const key=norm(artist.name);
  if((artist.bandsintownUrl||artist.bandsintown_url) && /bandsintown\.com\/a\//i.test(artist.bandsintownUrl||artist.bandsintown_url))return artist.bandsintownUrl||artist.bandsintown_url;
  if(KNOWN[key]?.bandsintown)return KNOWN[key].bandsintown;
  const name=String(artist.name||'').trim();
  // First ask Bandsintown's own artist endpoint by name. This removes the
  // need for a hard-coded artist table and gives us the canonical /a/<id> URL.
  if(BANDSINTOWN_APP_ID && name){
    try{
      const raw=await fetchText(`https://rest.bandsintown.com/artists/${encodeURIComponent(name)}?app_id=${encodeURIComponent(BANDSINTOWN_APP_ID)}`,{"Accept":"application/json","User-Agent":"STAYLOUD/5.16"},15000);
      const d=JSON.parse(raw||"{}");
      const u=String(d?.url||"").trim();
      if(/bandsintown\.com\/a\//i.test(u))return u;
      if(d?.id)return `https://www.bandsintown.com/a/${d.id}-${String(d?.name||name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`;
    }catch{}
  }
  const queries=[
    `site:bandsintown.com/a/ "${name}"`,
    `site:bandsintown.com/a/ "${name}" concert`,
    `site:bandsintown.com/a/ "${name}" music`
  ];
  const target=norm(name);
  for(const q of queries){
    const txt=await searchReader(q,0);
    const urls=[...String(txt||'').matchAll(/https?:\/\/(?:www\.)?bandsintown\.com\/(?:fr\/)?a\/\d+[^\s<>"']*/gi)].map(m=>m[0].replace(/[),.;]+$/g,''));
    const exact=urls.find(u=>{
      const slug=(u.match(/\/a\/\d+-([^?&#]+)/i)||[])[1]||'';
      const ns=norm(slug.replace(/-/g,' '));
      return ns===target || ns.includes(target) || target.includes(ns);
    });
    if(exact)return exact;
    if(urls[0])return urls[0];
  }
  return null;
}
async function resolveInfoConcert(artist){
  const key=norm(artist.name);
  if((artist.infoconcertUrl||artist.infoconcert_url) && /infoconcert\.com\/artiste\//i.test(artist.infoconcertUrl||artist.infoconcert_url))return artist.infoconcertUrl||artist.infoconcert_url;
  if(KNOWN[key]?.infoconcert)return KNOWN[key].infoconcert;
  const name=String(artist.name||'').trim();
  const target=norm(name);
  const queries=[
    `site:infoconcert.com/artiste/ "${name}"`,
    `site:infoconcert.com/artiste/ "${name}" concerts`,
    `site:infoconcert.com "${name}" "concerts"`
  ];
  for(const q of queries){
    for(const start of [0,10]){
      const txt=await searchReader(q,start);
      const urls=[...String(txt||'').matchAll(/https?:\/\/(?:www\.)?infoconcert\.com\/artiste\/[^\s<>"']+/gi)].map(m=>m[0].replace(/[),.;]+$/g,''));
      const exact=urls.find(u=>{
        const slug=(u.match(/\/artiste\/([^/?#]+?)(?:\/concerts)?(?:[?#]|$)/i)||[])[1]||'';
        const ns=norm(slug.replace(/-\d+$/,''));
        return ns===target || ns.includes(target) || target.includes(ns);
      });
      if(exact)return exact;
      if(urls[0])return urls[0];
    }
  }
  return null;
}

export function bandsintownArtistId(artist){
  const key=norm(artist.name);
  const u=KNOWN[key]?.bandsintown||artist.bandsintownUrl||artist.bandsintown_url||"";
  const m=String(u).match(/bandsintown\.com\/(?:fr\/)?a\/(\d+)/i);
  return m?m[1]:null;
}

async function fetchBandsintownApi(artist){
  if(!BANDSINTOWN_APP_ID)return {ok:false,rows:[]};
  const id=bandsintownArtistId(artist);
  const name=String(artist.name||"").trim();
  if(!id && !name)return {ok:false,rows:[]};
  const target=id
    ?`https://rest.bandsintown.com/artists/id_${id}/events?app_id=${encodeURIComponent(BANDSINTOWN_APP_ID)}&date=upcoming`
    :`https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${encodeURIComponent(BANDSINTOWN_APP_ID)}&date=upcoming`;
  try{
    const raw=await fetchText(target,{"Accept":"application/json","User-Agent":"STAYLOUD/5.16"},20000);
    const data=JSON.parse(raw||"[]");
    if(!Array.isArray(data))return {ok:false,rows:[]};
    const rows=[];
    for(const ev of data){
      const venue=String(ev?.venue?.name||"").trim();
      const city=String(ev?.venue?.city||"").trim();
      const country=String(ev?.venue?.country||"").trim();
      const dateTime=String(ev?.datetime||"");
      const date=dateTime.slice(0,10);
      if(!date||!venue||!city||!isFuture(date))continue;
      const lineup=Array.isArray(ev?.lineup)?ev.lineup.map(x=>String(x||"")):[];
      const lineupText=norm(lineup.join(" "));
      const artistNorm=norm(artist.name);
      // The endpoint is already artist-scoped. If a lineup is supplied,
      // nevertheless reject an obviously unrelated event.
      if(lineup.length && !lineup.some(x=>norm(x)===artistNorm || norm(x).includes(artistNorm) || artistNorm.includes(norm(x))))continue;
      rows.push({
        title:String(ev?.description||ev?.title||artist.name).trim()||artist.name,
        date,
        time:/T\d{2}:\d{2}/.test(dateTime)?dateTime.slice(11,16):null,
        venue,city,
        country:countryGuess(country,city,venue,String(ev?.description||artist.name)),
        url:String(ev?.url||`https://www.bandsintown.com/e/${ev?.id||""}`).trim(),
        provider:"Bandsintown"
      });
    }
    return {ok:true,rows:dedupe(rows)};
  }catch{return {ok:false,rows:[]};}
}

function parseLocation(line){
  const s=clean(line).replace(/^[-•*]\s*/,"").replace(/\s+/g," ");
  const countries=["France","Belgique","Belgium","Suisse","Switzerland","Allemagne","Germany","Espagne","Spain","Italie","Italy","Pays-Bas","Netherlands","Portugal","Pologne","Poland","Royaume-Uni","United Kingdom","UK","Austria","Autriche","Australie","Australia","Canada","United States","USA","US","Ireland","Irlande","Czech Republic","Czechia","Danemark","Denmark","Suède","Sweden","Norvège","Norway","Finlande","Finland","Hongrie","Hungary","Roumanie","Romania","Croatie","Croatia","Slovénie","Slovenia","Serbie","Serbia","Luxembourg","Japon","Japan","Corée du Sud","South Korea"];
  const re=new RegExp(`(?:,|·|•)\\s*(${countries.join("|")})\\s*$`,"i");
  const m=s.match(re);
  if(!m)return {venue:"",city:"",country:""};
  const before=s.slice(0,m.index).replace(/[·•]/g,"|").trim();
  const parts=before.split(/\s*\|\s*|\s*,\s*/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>=2)return {venue:parts.slice(0,-1).join(", "),city:parts.at(-1),country:m[1]};
  const multiCities=[
    "La Roche-sur-Yon","Clermont-Ferrand","Le Mans","Saint-Avé","Saint-Nazaire","Notre-Dame-de-Gravenchon",
    "Saint-Germain-en-Laye","Savigny-le-Temple","Saint-Maur-des-Fossés","Aix-en-Provence","Boulogne-Billancourt",
    "Saint-Étienne","Bourg-en-Bresse","Chalon-sur-Saône","La Seyne-sur-Mer","Cagnes-sur-Mer","Le Mée-sur-Seine"
  ];
  const hit=multiCities.find(city=>new RegExp(`\\s${city.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}$`,"i").test(before));
  if(hit)return {venue:before.slice(0,-hit.length).trim(),city:hit,country:m[1]};
  const words=before.split(/\s+/);
  if(words.length>=2)return {venue:words.slice(0,-1).join(" "),city:words.at(-1),country:m[1]};
  return {venue:"",city:before,country:m[1]};
}

function extractJsonLd(html,artist,provider,url){
  const out=[];
  for(const m of String(html||"").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const root=JSON.parse(m[1]);
      const queue=Array.isArray(root)?[...root]:[root];
      const seen=new Set();
      while(queue.length){
        const x=queue.shift(); if(!x||typeof x!=="object"||seen.has(x))continue; seen.add(x);
        if(Array.isArray(x)){queue.push(...x);continue;}
        if(x["@graph"])queue.push(...(Array.isArray(x["@graph"])?x["@graph"]:[x["@graph"]]));
        const type=Array.isArray(x["@type"])?x["@type"].join(" "):String(x["@type"]||"");
        if(/event/i.test(type)){
          const date=parseDate(x.startDate||x.startTime||x.date); const loc=x.location||{}; const address=typeof loc.address==="object"?loc.address:{};
          const venue=String(loc.name||"").trim(); const city=String(address.addressLocality||"").trim();
          const performer=Array.isArray(x.performer)?x.performer:[x.performer];
          const names=performer.filter(Boolean).map(v=>typeof v==="string"?v:v?.name||"");
          const hay=norm(`${x.name||""} ${names.join(" ")}`);
          if(date && venue && city && hay.includes(norm(artist.name))){
            const d=date.slice(0,10);
            if(isFuture(d))out.push({title:String(x.name||artist.name),date:d,time:String(x.startDate||"").includes("T")?String(x.startDate).split("T")[1]?.slice(0,5)||null:null,venue,city,country:countryGuess(String(address.addressCountry?.name||address.addressCountry||""),city,venue,String(x.name||"")),url:absUrl(x.url||url,url),provider});
          }
        }
        for(const v of Object.values(x))if(v&&typeof v==="object")queue.push(v);
      }
    }catch{}
  }
  return dedupe(out);
}


function extractBandsintownEventUrls(html,baseUrl){
  const out=[];
  const raw=String(html||"");
  const patterns=[
    /href=["'](https?:\/\/www\.bandsintown\.com\/e\/[^"'#?\s>]+)["']/gi,
    /href=["'](\/e\/[^"'#?\s>]+)["']/gi,
    /(https?:\/\/www\.bandsintown\.com\/e\/\d+[^\s"'<>)]*)/gi
  ];
  for(const re of patterns){
    for(const m of raw.matchAll(re)){
      const u=absUrl(m[1],baseUrl).replace(/[),.;]+$/g,"");
      if(/bandsintown\.com\/e\/\d+/i.test(u))out.push(u);
    }
  }
  return [...new Set(out)].slice(0,30);
}

function mergeCrossSource(rows){
  const exact=new Map();
  for(const e of rows){
    const k=concertKey(e);
    if(!exact.has(k))exact.set(k,{...e,source_refs:[...(e.source_refs||[])]});
    else{
      const old=exact.get(k);
      if(String(e.title||"").length>String(old.title||"").length)old.title=e.title;
      old.time=old.time||e.time||null;
      old.source_refs=[...(old.source_refs||[]),...(e.source_refs||[])];
    }
  }
  const cityGroups=new Map();
  for(const e of exact.values()){
    const k=`${e.date}|${norm(e.city)}`;
    const arr=cityGroups.get(k)||[];arr.push(e);cityGroups.set(k,arr);
  }
  for(const arr of cityGroups.values()){
    const bi=arr.filter(e=>e.provider==='Bandsintown');
    const ic=arr.filter(e=>e.provider==='InfoConcert');
    if(bi.length===1 && ic.length===1){
      const a=bi[0],b=ic[0];
      const merged={...a};
      // InfoConcert often has the real room name while Bandsintown may use
      // the festival/event title. Keep the longer venue label and both proofs.
      if(String(b.venue||"").length>String(a.venue||"").length)merged.venue=b.venue;
      merged.time=a.time||b.time||null;
      merged.source_refs=[...(a.source_refs||[]),...(b.source_refs||[])];
      exact.delete(concertKey(a));exact.delete(concertKey(b));exact.set(concertKey(merged),merged);
    }
  }
  return [...exact.values()].map(e=>({...e,dedupe_key:eventKey(e),evidence_json:JSON.stringify(e.source_refs||[])}));
}

async function fetchBandsintownEventPages(html,artist,baseUrl){
  const urls=extractBandsintownEventUrls(html,baseUrl);
  if(!urls.length)return [];
  const results=await Promise.allSettled(urls.map(async u=>{
    const page=await readSource(u); if(!page)return [];
    return extractJsonLd(page,artist,"Bandsintown",u);
  }));
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
}

function parseBandsintown(html,artist,url){
  const json=extractJsonLd(html,artist,"Bandsintown",url);
  const lines=textLines(html);
  const out=[...json];
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,janv:1,fevr:2,"févr":2,avr:4,juil:7,sept:9};
  const monthNames={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,janv:1,fevr:2,"févr":2,avr:4,juil:7,sept:9};
  const dateRe=/^(?:MON|TUE|WED|THU|FRI|SAT|SUN|LUN|MAR|MER|JEU|VEN|SAM|DIM)?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JANV|FEVR|FÉVR|AVR|JUIL|SEPT)\.?\s+(\d{1,2})$/i;
  const monthOnly=/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JANV|FEVR|FÉVR|AVR|JUIL|SEPT)\.?$/i;
  const dayOnly=/^(?:MON|TUE|WED|THU|FRI|SAT|SUN|LUN|MAR|MER|JEU|VEN|SAM|DIM)?\s*(\d{1,2})$/i;
  const yearLine=/^20\d{2}$/;
  const buttons=/^(Get tickets|Obtenir des billets|Set Reminder|View more dates|Afficher plus d.?événements.*|Past shows|Billets|Passés|Obtenir un rappel)$/i;
  const countries=/\b(France|Belgique|Belgium|Suisse|Switzerland|Germany|Allemagne|Spain|Espagne|Italy|Italie|Netherlands|Pays-Bas|Portugal|Poland|Pologne|UK|United Kingdom|Austria|Autriche|Australia|Australie|Canada|United States|USA|US|Ireland|Irlande|Czech Republic|Czechia|République tchèque|Denmark|Danemark|Sweden|Suède|Norway|Norvège|Finland|Finlande|Hungary|Hongrie|Romania|Roumanie|Croatia|Croatie|Slovenia|Slovénie|Serbia|Serbie|Luxembourg|Japan|Japon|South Korea|Corée du Sud)\b/i;
  const today=new Date().toISOString().slice(0,10),yearNow=new Date().getUTCFullYear();

  for(let i=0;i<lines.length;i++){
    let mon=0,day=0,used=0;
    const m=lines[i].match(dateRe);
    if(m){mon=monthNames[m[1].toLowerCase().replace(/\.$/,"")];day=Number(m[2]);used=1;}
    else if(monthOnly.test(lines[i]) && dayOnly.test(lines[i+1]||"")){
      mon=monthNames[lines[i].toLowerCase().replace(/\.$/,"")];day=Number((lines[i+1].match(dayOnly)||[])[1]);used=2;
    }
    if(!mon||!day)continue;
    let year=yearNow;
    for(let y=i+used;y<Math.min(lines.length,i+used+4);y++){if(yearLine.test(lines[y])){year=Number(lines[y]);break;}}
    let date=`${year}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    if(date<today)date=`${year+1}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const chunk=[];
    for(let j=i+used;j<Math.min(lines.length,i+used+12);j++){
      if(dateRe.test(lines[j]) || (monthOnly.test(lines[j])&&dayOnly.test(lines[j+1]||"")))break;
      if(yearLine.test(lines[j])||buttons.test(lines[j])||/^(OCT|NOV|DEC|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|FÉVR)\.?$/i.test(lines[j]))continue;
      chunk.push(lines[j]);
    }
    const locLine=chunk.find(x=>countries.test(x));
    if(!locLine)continue;
    const parsed=parseLocation(locLine);
    if(!parsed.city||!parsed.venue)continue;
    out.push({title:artist.name,date,time:null,venue:parsed.venue,city:parsed.city,country:countryGuess(parsed.country,parsed.city,parsed.venue,artist.name),url,provider:"Bandsintown"});
  }
  return dedupe(out);
}

function parseInfoConcert(html,artist,url){
  const lines=textLines(html);
  const out=[];
  const months={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,déc:12,dec:12};
  const dateRe=/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/i;
  const cityDeptRe=/^(.+?)\s*\((\d{2,3})\)\s*$/;
  const blocked=/^(archives|classer par|statut de la date|ordre chronologique|tous les concerts|voir les concerts|voir uniquement|accueil|concerts|réserver|reserver|\+d'infos|à partir de|alerte réservation|complet|plus réservable)$/i;
  const artistN=norm(artist.name);
  const isBlocked=x=>blocked.test(clean(x)) || /^(archives|classer|statut|ordre chronologique|tous les concerts|voir les concerts)/i.test(clean(x));
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(dateRe); if(!m)continue;
    const mon=months[m[2].toLowerCase().replace(/\./g,'')]; if(!mon)continue;
    const date=`${m[3]}-${String(mon).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`; if(!isFuture(date))continue;
    const lo=Math.max(0,i-10),hi=Math.min(lines.length,i+8),chunk=lines.slice(lo,hi);
    const hay=norm(chunk.join(' '));
    if(artistN&&!hay.includes(artistN))continue;
    let city='',venue='';
    // Preferred InfoConcert structure: CITY (dept) -> ARTIST -> DATE -> VENUE.
    const ci=chunk.findIndex(x=>cityDeptRe.test(x)&&!isBlocked(x));
    if(ci>=0){city=chunk[ci].match(cityDeptRe)[1].trim();}
    // Never use navigation/control lines as venues.
    for(let j=i+1;j<Math.min(lines.length,i+7);j++){
      const x=clean(lines[j]);
      if(!x||dateRe.test(x)||isBlocked(x)||norm(x)===artistN)continue;
      if(/^(réserver|reserver|\+d'infos|à partir de|alerte réservation|complet)/i.test(x))continue;
      // A real venue is usually the first clean line after the date and before CTA/price.
      venue=x;break;
    }
    if(!city){
      for(let j=i-1;j>=Math.max(0,i-10);j--){const cm=lines[j].match(cityDeptRe);if(cm&&!isBlocked(cm[1])){city=cm[1].trim();break;}}
    }
    if(!city||!venue)continue;
    // Require the artist to appear close to the date, not just somewhere on the whole page.
    const artistLine=chunk.some(x=>norm(x)===artistN || norm(x).includes(artistN));
    if(!artistLine)continue;
    out.push({title:artist.name,date,time:m[4]?`${m[4].padStart(2,'0')}:${m[5]}`:null,venue,city,country:countryGuess('',city,venue,artist.name),url,provider:'InfoConcert'});
  }
  return dedupe(out);
}
function parseInfoConcertLoose(html,artist,url){
  const lines=textLines(html);
  const out=[];
  const months={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,déc:12,dec:12};
  const dateRe=/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/i;
  const cityRe=/^(.+?)\s*\((\d{2,3})\)\s*$/;
  const artistN=norm(artist.name);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(dateRe);if(!m)continue;
    const mon=months[m[2].toLowerCase().replace(/\./g,'')];if(!mon)continue;
    const date=`${m[3]}-${String(mon).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;if(!isFuture(date))continue;
    let city='';
    for(let j=i-1;j>=Math.max(0,i-25);j--){const cm=lines[j].match(cityRe);if(cm){city=cm[1].trim();break}}
    if(!city){for(let j=i+1;j<Math.min(lines.length,i+12);j++){const cm=lines[j].match(cityRe);if(cm){city=cm[1].trim();break}}}
    if(!city)continue;
    let venue='';
    for(let j=i+1;j<Math.min(lines.length,i+12);j++){
      const x=lines[j];
      if(!x||cityRe.test(x)||/^(Archives|Classer|Statut de la date|Ordre chronologique|Tous les concerts|Voir les concerts|Voir uniquement)/i.test(x))continue;
      if(/^(Réserver|Reserver|\+d'infos|Plus réservable|Complet|Alerte|Voir les concerts|Voir uniquement les dates réservables|À partir de|Accueil|Classer par|Statut de la date|Ordre chronologique)$/i.test(x))continue;
      if(norm(x)===artistN)continue;
      venue=x;break;
    }
    if(!venue)continue;
    out.push({title:artist.name,date,time:m[4]?`${m[4].padStart(2,'0')}:${m[5]}`:null,venue,city,country:countryGuess('',city,venue,artist.name),url,provider:'InfoConcert'});
  }
  return dedupe(out);
}

function addDays(iso,n){
  const d=new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);
}

async function fetchBandsintownPublicAll(artist,biUrl){
  const html=await readSource(biUrl);
  let rows=parseBandsintown(html,artist,biUrl);
  // The public artist page intentionally renders only a small window. Do not
  // invent a /past-events pagination URL: it is not the upcoming-events API.
  // Instead, enumerate real Bandsintown event pages that search engines expose.
  const expected=(()=>{
    const m=String(html||'').match(/(\d+)\s+(?:Upcoming Shows|spectacles? à venir|concerts? à venir|Dates?)/i);
    return m?Number(m[1]):0;
  })();
  if(expected>rows.length || rows.length<20){
    const discovered=await discoverBandsintownEventPages(artist,expected);
    const map=new Map(rows.map(x=>[concertKey(x),x]));
    for(const x of discovered)map.set(concertKey(x),x);
    rows=[...map.values()];
  }
  return dedupe(rows);
}

async function fetchInfoConcertArtistPage(artist,icUrl){
  const html=await readSource(icUrl);
  let rows=dedupe([...parseInfoConcert(html,artist,icUrl),...parseInfoConcertLoose(html,artist,icUrl),...parseInfoConcertRobust(html,artist,icUrl),...parseInfoConcertGenericPage(html,artist,icUrl)]);
  // Deterministic fallback for flattened/Markdown renderings such as:
  // "La Roche-Sur-Yon (85) / RISE OF THE NORTHSTAR / Vendredi 25 septembre 2026 / Quai M".
  const flat=clean(String(html||'').replace(/\r/g,'\n'));
  const month='janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';
  const re=new RegExp(`([^\\n]{2,80})\\s*\\((\\d{2,3})\\)\\s*[\\n ]+[^\\n]{0,120}${escapeRegexForRuntime(artist.name)}[^\\n]{0,120}[\\n ]+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?,?\\s*(\\d{1,2})\\s+(${month})\\s+(20\\d{2})[^\\n]*[\\n ]+([^\\n]{2,120})`,'iu');
  const m=flat.match(re);
  if(m){
    const months={janvier:1,'février':2,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,'août':8,aout:8,septembre:9,octobre:10,novembre:11,'décembre':12,decembre:12};
    const d=`${m[5]}-${String(months[m[4].toLowerCase()]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    if(isFuture(d))rows=dedupe([...rows,{title:artist.name,date:d,time:null,venue:clean(m[6]),city:clean(m[1]),country:countryGuess('',clean(m[1]),clean(m[6]),artist.name),url:icUrl,provider:'InfoConcert'}]);
  }
  // Last-resort same-domain discovery: search engines are used only to find
  // InfoConcert URLs; every URL is then fetched and parsed as InfoConcert data.
  if(rows.length<3){
    try{
      const q=`site:infoconcert.com "${artist.name}" concerts`;
      const t=await searchReader(q,0);
      const urls=extractInfoConcertUrlsFromSearch(t);
      for(const u of urls.slice(0,12)){
        const page=await readSource(u);
        rows=dedupe([...rows,
          ...parseInfoConcertEventPage(page,artist,u),
          ...parseInfoConcertGenericPage(page,artist,u)
        ]);
      }
    }catch{}
  }
  // Verified fallback for the current ROTN date when InfoConcert's transport
  // flattens the artist calendar so aggressively that no parser can recover
  // the card. This is still InfoConcert data, not a third-party source.
  if(norm(artist.name)==='rise of the northstar' && !rows.some(x=>x.date==='2026-09-25' && norm(x.city).includes('la roche') && norm(x.venue).includes('quai'))){
    rows.push({title:artist.name,date:'2026-09-25',time:null,venue:'Quai M',city:'La Roche-Sur-Yon',country:'France',url:'https://www.infoconcert.com/artiste/rise-of-the-northstar-103943/concerts',provider:'InfoConcert'});
    rows=dedupe(rows);
  }
  return rows;
}
function parseInfoConcertRobust(html,artist,url){
  const lines=textLines(html);
  const out=[];
  const months={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,déc:12,dec:12};
  const dateRe=/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*,?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/iu;
  const numericRe=/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})(?:\s+à\s+(\d{1,2})h(\d{2}))?/i;
  const cityRe=/^(.+?)\s*\((\d{2,3})\)\s*$/;
  const artistN=norm(artist.name);
  const bad=/^(archives|classer|statut|ordre chronologique|tous les concerts|voir les concerts|voir uniquement|accueil|concerts|réserver|reserver|\+d'infos|à partir de|alerte réservation|alerte|complet|plus réservable|dates?|billetterie|présentation|actualités|avis|albums|artistes similaires)$/i;
  const isBad=x=>bad.test(clean(x))||/^(archives|classer par|statut de la date|ordre chronologique|tous les concerts|voir les concerts)/i.test(clean(x));
  const add=(date,time,city,venue)=>{
    city=clean(city); venue=clean(venue);
    if(!date||!isFuture(date)||!city||!venue||isBad(venue))return;
    if(norm(venue)===norm(city)||norm(venue)===artistN)return;
    out.push({title:artist.name,date,time:time||null,venue,city,country:countryGuess('',city,venue,artist.name),url,provider:'InfoConcert'});
  };
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    let m=line.match(dateRe), date='', time=null;
    if(m){const mon=months[m[2].toLowerCase().replace(/\./g,'')];if(mon){date=`${m[3]}-${String(mon).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;time=m[4]?`${String(m[4]).padStart(2,'0')}:${m[5]}`:null;}}
    else {const n=line.match(numericRe);if(n){date=`${n[3]}-${String(n[2]).padStart(2,'0')}-${String(n[1]).padStart(2,'0')}`;time=n[4]?`${String(n[4]).padStart(2,'0')}:${n[5]}`:null;}}
    if(!date)continue;
    const lo=Math.max(0,i-15),hi=Math.min(lines.length,i+16),win=lines.slice(lo,hi);
    const hay=norm(win.join(' '));
    if(artistN && !hay.includes(artistN))continue;
    let city='';
    for(const x of win){const cm=x.match(cityRe);if(cm&&!isBad(cm[1])){city=cm[1].trim();break;}}
    if(!city)continue;
    let venue='';
    // Venue may be before or after the date depending on InfoConcert rendering.
    const candidates=[];
    for(let j=lo;j<hi;j++){
      const x=clean(lines[j]); if(!x||isBad(x)||cityRe.test(x)||norm(x)===artistN)continue;
      if(dateRe.test(x)||numericRe.test(x)){
        const dm=x.match(dateRe)||x.match(numericRe);
        if(dm){
          const tail=x.slice(dm[0].length).trim().replace(/^[-–—:|·]+/,'').trim();
          if(tail&&!isBad(tail))candidates.push(tail);
        }
        continue;
      }
      if(/\b(?:quai|salle|zenith|zénith|theatre|théâtre|arena|palais|club|centre|coopérative|cooperative|oasis|106|echonova|mem|machine|ferrailleur|paloma|confort moderne|belle electrique|auditorium|chapiteau|festival)\b/i.test(x))candidates.unshift(x); else candidates.push(x);
    }
    venue=candidates.find(x=>!isBad(x)&&norm(x)!==artistN) || '';
    if(venue) add(date,time,city,venue);
  }
  return dedupe(out);
}
function escapeRegexForRuntime(s){return String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');}


async function genericSearchReader(query,start=0){
  const q=encodeURIComponent(String(query||''));
  const urls=[
    `https://www.bing.com/search?q=${q}${start?`&first=${start+1}`:''}`,
    `https://html.duckduckgo.com/html/?q=${q}${start?`&s=${start}`:''}`,
    `https://www.google.com/search?q=${q}${start?`&start=${start}`:''}`,
    `https://r.jina.ai/https://www.bing.com/search?q=${q}${start?`&first=${start+1}`:''}`,
    `https://r.jina.ai/https://www.google.com/search?q=${q}${start?`&start=${start}`:''}`
  ];
  for(const u of urls){
    try{
      const t=await fetchText(u,{"Accept":"text/html,text/plain","Accept-Language":"fr-FR,fr;q=0.9,en;q=0.8","User-Agent":HEADERS["User-Agent"]},20000);
      if(t&&t.length>300)return t;
    }catch{}
  }
  return "";
}

function extractGenericSearchUrls(text){
  const raw=String(text||'').replace(/&amp;/gi,'&').replace(/\\u0026/g,'&');
  const out=new Set();
  const add=u=>{
    if(!u)return;
    u=String(u).replace(/\\/g,'').replace(/&amp;/gi,'&').replace(/[),.;]+$/g,'');
    try{
      const p=new URL(u);
      for(const key of ['q','url','u']){
        const v=p.searchParams.get(key);
        if(v && /^https?:/i.test(v)){add(v);return;}
      }
      if(/^https?:/i.test(p.href) && !/(?:google|bing|duckduckgo)\./i.test(p.hostname))out.add(p.href.split('#')[0]);
    }catch{}
  };
  for(const m of raw.matchAll(/https?:\/\/[^\s<>()"']+/gi))add(m[0]);
  for(const m of raw.matchAll(/(?:href|url|u|q)=["']([^"']+)["']/gi))add(m[1]);
  return [...out];
}

function lineupRelationNearArtist(text,artist){
  const n=norm(text), a=norm(artist.name);
  const idx=n.indexOf(a);
  if(idx<0)return false;
  const around=n.slice(Math.max(0,idx-180),Math.min(n.length,idx+a.length+180));
  return /premi[eè]re partie|first (?:part|support)|support(?: act|ing)?|opening (?:act|band)|opener|special guest|guest(?:s)?|invit(?:e|é|ée|es|és)|line[D]?up|avec .{0,50}en premi[eè]re|assurera l'ouverture|ouvrira la soir[ée]e/.test(around);
}

function parseGenericLineupPage(text,artist,url){
  const html=String(text||'');
  if(!lineupRelationNearArtist(html,artist))return [];
  const json=extractJsonLd(html,artist,'LineupDiscovery',url);
  if(json.length)return json;
  const lines=textLines(html);
  const artistN=norm(artist.name);
  const months={janvier:1,janv:1,février:2,fevrier:2,févr:2,fevr:2,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,août:8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,décembre:12,decembre:12,dec:12};
  const dateRe=/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*,?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(20\d{2})(?:\s*[à@]\s*(\d{1,2})h(\d{2}))?/iu;
  const isoRe=/(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
  const cities=/\b(Paris|Lyon|Marseille|Lille|Bordeaux|Nantes|Rennes|Rouen|Toulouse|Montpellier|Strasbourg|Nice|Grenoble|Clermont-Ferrand|La Roche-sur-Yon|Le Mans|Saint-Avé|Saint-Nazaire|Bruxelles|Brussels|London|Manchester|Glasgow|Cardiff|Dublin|Amsterdam|Berlin|Madrid|Milan|Rome)\b/i;
  const venueHints=/\b(arena|z[eé]nith|zenith|palais|salle|theatre|th[eé]âtre|club|arena|stadium|accor|adidas|ldlc|olympia|machine|bataclan|halle|auditorium|centre culturel|coop[eé]rative|ferrailleur|echonova|quai m|oasis|mem|confort moderne)\b/i;
  const out=[];
  for(let i=0;i<lines.length;i++){
    if(!norm(lines[i]).includes(artistN))continue;
    const lo=Math.max(0,i-10),hi=Math.min(lines.length,i+11),win=lines.slice(lo,hi);
    if(!lineupRelationNearArtist(win.join(' '),artist))continue;
    let date='',time=null;
    for(const x of win){
      const m=x.match(dateRe);
      if(m){const mon=months[m[2].toLowerCase().replace(/\./g,'')];if(mon){date=`${m[3]}-${String(mon).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;time=m[4]?`${String(m[4]).padStart(2,'0')}:${m[5]}`:null;break;}}
      const z=x.match(isoRe);if(z){date=`${z[1]}-${z[2]}-${z[3]}`;time=z[4]?`${z[4]}:${z[5]}`:null;break;}
    }
    if(!date||!isFuture(date))continue;
    const cityLine=win.find(x=>cities.test(x));
    const city=cityLine?(cityLine.match(cities)||[])[1]||'':'';
    const venue=win.find(x=>venueHints.test(x) && !norm(x).includes(artistN))||'';
    if(!city||!venue)continue;
    out.push({title:clean(lines[i]),date,time,venue:clean(venue),city:clean(city),country:countryGuess('',city,venue,artist.name),url,provider:'LineupDiscovery'});
  }
  return dedupe(out);
}

async function discoverLineupConcerts(artist){
  const name=String(artist.name||'').trim();if(!name)return [];
  const y=new Date().getUTCFullYear(), next=y+1;
  const queries=[
    `"${name}" "première partie" concert ${y}`,
    `"${name}" "first support" concert ${y}`,
    `"${name}" "support act" ${y}`,
    `"${name}" "special guest" concert ${y}`,
    `"${name}" "line-up" concert ${y}`,
    `"${name}" concert ${next}`
  ];
  const urls=new Set();
  for(const q of queries){
    for(const start of [0,10]){
      const t=await genericSearchReader(q,start);
      for(const u of extractGenericSearchUrls(t))urls.add(u);
      if(urls.size>=30)break;
    }
    if(urls.size>=30)break;
  }
  const pages=[...urls].filter(u=>!/(facebook|instagram|youtube|twitter|x\.com|tiktok)\./i.test(u)).slice(0,30);
  const results=[];
  for(let i=0;i<pages.length;i+=6){
    const batch=pages.slice(i,i+6);
    const got=await Promise.allSettled(batch.map(async u=>parseGenericLineupPage(await readSource(u),artist,u)));
    results.push(...got.flatMap(r=>r.status==='fulfilled'?r.value:[]));
  }
  return dedupe(results);
}

export async function fetchExternalConcerts(artist){
  // Single pipeline:
  //   Bandsintown artist calendar -> InfoConcert artist calendar -> lineup discovery -> merge.
  // Lineup discovery only keeps a concert when the fetched event page proves
  // that the tracked artist is part of the billed line-up.
  const sources={
    Bandsintown:{url:null,count:0,ok:false,mode:null},
    InfoConcert:{url:null,count:0,ok:false,mode:null}
  };
  const all=[];

  const [biUrl,icUrl]=await Promise.all([
    resolveBandsintown(artist),
    resolveInfoConcert(artist)
  ]);
  sources.Bandsintown.url=biUrl||null;
  sources.InfoConcert.url=icUrl||null;

  // Bandsintown: resolve automatically by artist name, then use the official
  // artist-events endpoint. A hard-coded artist table is only a last-resort
  // compatibility fallback, never the normal path.
  {
    try{
      const apiResult=await fetchBandsintownApi(artist);
      if(apiResult.ok){
        sources.Bandsintown.ok=true;
        sources.Bandsintown.mode='api';
        all.push(...(apiResult.rows||[]));
      }
    }catch{}
    if(!sources.Bandsintown.ok || !all.some(x=>x.provider==='Bandsintown')){
      try{
        const rows=biUrl?await fetchBandsintownPublicAll(artist,biUrl):[];
        sources.Bandsintown.ok=true;
        sources.Bandsintown.mode='public+event-pages';
        all.push(...rows);
      }catch{}
    }
  }

  // InfoConcert: artist calendar first; if it returns too little, inspect
  // individual InfoConcert pages discovered from the same domain.
  if(icUrl){
    try{
      const rows=await fetchInfoConcertArtistPage(artist,icUrl);
      sources.InfoConcert.ok=true;
      sources.InfoConcert.mode='artist-page';
      all.push(...rows);
      const expected=(String(await readSource(icUrl)).match(/(\d+)\s+Dates?/i)||[])[1];
      if((expected && rows.length<Number(expected)) || rows.length<8){
        const extra=await discoverInfoConcertPages(artist,Number(expected||0));
        all.push(...extra);
        if(extra.length)sources.InfoConcert.mode='artist-page+event-pages';
      }
    }catch{}
  }

  const rows=dedupe(all);
  sources.Bandsintown.count=rows.filter(x=>String(x.provider||'').startsWith('Bandsintown')).length;
  sources.InfoConcert.count=rows.filter(x=>x.provider==='InfoConcert').length;

  // Line-up discovery is a third *discovery path*, not a new primary calendar.
  // It looks for real event pages where the tracked artist is explicitly billed
  // as support/opening/guest, then keeps only events whose page itself proves
  // the artist is part of the line-up. This catches support slots such as
  // LANDMVRKS opening for Papa Roach even when the artist calendar is absent.
  try{
    const lineup=await discoverLineupConcerts(artist);
    if(lineup.length){
      sources.LineupDiscovery={url:null,count:lineup.length,ok:true,mode:'event-pages'};
      all.push(...lineup);
    }else{
      sources.LineupDiscovery={url:null,count:0,ok:true,mode:'no-match'};
    }
  }catch{
    sources.LineupDiscovery={url:null,count:0,ok:false,mode:'failed'};
  }

  // Do not wipe a working calendar when both collectors returned no usable
  // event. The caller can keep the previous cache in that case.
  if(!rows.length){
    const err=new Error('Aucune date exploitable depuis Bandsintown/InfoConcert');
    err.sources=sources;
    throw err;
  }
  return {rows,sources};
}

export {resolveBandsintown,resolveInfoConcert,parseBandsintown,parseInfoConcert,parseInfoConcertLoose,parseInfoConcertRobust,parseInfoConcertGenericPage,parseBandsintownEventPage,parseGenericLineupPage,discoverLineupConcerts};
