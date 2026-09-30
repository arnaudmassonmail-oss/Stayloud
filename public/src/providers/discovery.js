import {fetchJson,fetchText,sleep,eventKey} from "../utils.js";
import {XMLParser} from "fast-xml-parser";
import {getArtists,putEvent} from "../db.js";

const geoCache=new Map();
let geoLast=0;
const MB_BASE="https://musicbrainz.org/ws/2";
let mbLast=0;
async function mb(url){
  const wait=Math.max(0,1100-(Date.now()-mbLast));if(wait)await sleep(wait);mbLast=Date.now();
  let err;
  for(let i=0;i<4;i++){
    try{return await fetchJson(url,{headers:{Accept:"application/json","User-Agent":"STAYLOUD-Music-Radar/3.0 (local app)"}},20000)}
    catch(e){err=e;await sleep(1400*Math.pow(2,i))}
  }
  throw err;
}

const STYLE_TAGS={"Metalcore":["metalcore"],"Deathcore":["deathcore"],"Hardcore":["hardcore"],"Nu Metal":["nu metal","nu-metal"],"Death Metal":["death metal","death-metal"],"Black Metal":["black metal","black-metal"],"Thrash Metal":["thrash metal","thrash-metal"],"Alternative":["alternative metal","alternative-metal","alternative rock"],"Post-Hardcore":["post-hardcore"],"Progressif":["progressive metal","progressive rock"],"Hard Rock":["hard rock"],"Metal":["metal"]};
const FESTIVAL_METAL_TAGS=["metal","metalcore","deathcore","hardcore","death metal","black metal","thrash metal","nu metal","progressive metal","alternative metal","post-hardcore","hard rock","doom","stoner","djent","grind","heavy metal","crossover","industrial metal","groove metal","technical death metal","punk hardcore"];
const BROAD_METAL_TERMS=[...FESTIVAL_METAL_TAGS,"punk","post-metal","mathcore","metallic hardcore","electronicore","folk metal","power metal","speed metal","sludge","gothic metal","symphonic metal","avant-garde metal"];

const REGIONAL_CITY_COORDS={
  Nantes:[47.2184,-1.5536],Vallet:[47.1627,-1.2667],Clisson:[47.0875,-1.2826],Cugand:[47.0638,-1.2517],Montaigu:[46.9744,-1.3116],"Montaigu-Vendée":[46.9744,-1.3116],Rezé:[47.1911,-1.5441],Carquefou:[47.2979,-1.4937],"Saint-Herblain":[47.226,-1.6484],"Le Bignon":[47.0997,-1.4924],Pontchâteau:[47.4367,-2.0911],Angers:[47.4784,-0.5632],"La Roche-sur-Yon":[46.6705,-1.426],Savenay:[47.3606,-1.942],"Saint-Macaire-en-Mauges":[47.1233,-0.994],"Saint-Hilaire-de-Riez":[46.7211,-1.9465],"Saint-Nazaire":[47.2738,-2.2137],Cholet:[47.0594,-0.878],Cordemais:[47.2917,-1.8783],"Le Bignon":[47.0997,-1.4924],"Chemillé-en-Anjou":[47.2142,-0.7268],"Saint-Prouant":[46.771,-0.967],"Saint-Macaire-en-Mauges":[47.1233,-0.994],"Saint-Sébastien-sur-Loire":[47.207,-1.503],"Saint-Julien-de-Concelles":[47.253,-1.385]
};

function norm(s){return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function followedNames(){return new Set(getArtists().map(a=>norm(a.name)))}

// A nearby-concert result is also useful to an artist's own calendar.
// The discovery page and the tracked-artist calendar used to be two separate
// pipelines, which meant a show such as "Rise Of The Northstar + ten56."
// could appear near the user without appearing under Rise Of The Northstar.
function artistMentionedInEvent(artist,event){
  const name=norm(artist?.name);
  if(!name)return false;
  const hay=norm(`${event?.title||''} ${event?.details||''}`);
  if(hay.includes(name))return true;
  // Handle common punctuation/spacing differences without matching a short
  // artist name inside an unrelated word.
  const tokens=name.split(/\s+/).filter(Boolean);
  if(tokens.length>=2){
    const re=new RegExp(`(^|\\W)${tokens.map(x=>x.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')).join('\\W+')}($|\\W)`,'iu');
    return re.test(String(`${event?.title||''} ${event?.details||''}`));
  }
  return false;
}

function syncNearbyEventsToFollowedArtists(items){
  const artists=getArtists();
  let linked=0;
  for(const event of Array.isArray(items)?items:[]){
    if(!event?.date||!event?.venue||!event?.city)continue;
    for(const artist of artists){
      if(!artistMentionedInEvent(artist,event))continue;
      const row={
        title:String(event.title||artist.name).trim(),
        date:String(event.date).slice(0,10),
        time:event.time||null,
        venue:String(event.venue||'').trim(),
        city:String(event.city||'').trim(),
        country:String(event.country||'France').trim(),
        url:String(event.url||''),
        provider:`discovery:${event.provider||'nearby'}`,
        evidence_json:JSON.stringify({kind:'nearby-discovery',source:event.provider||'nearby',linkedArtist:artist.name,details:event.details||''})
      };
      row.dedupe_key=eventKey(row);
      putEvent(artist.id,row);
      linked++;
    }
  }
  return linked;
}
function cleanArtist(a){return {id:a.id,name:a.name,sortname:a.sortname||a.name,score:a.score||0,disambiguation:a.disambiguation||'',style:inferStyle((a.tags||[]).map(t=>String(t.name||'').toLowerCase()))}}
function inferStyle(tags){const t=tags.join(' ');const rules=[['Deathcore',/deathcore/],['Metalcore',/metalcore/],['Post-Hardcore',/post-hardcore/],['Hardcore',/hardcore/],['Nu Metal',/nu metal|nu-metal/],['Death Metal',/death metal/],['Black Metal',/black metal/],['Thrash Metal',/thrash metal/],['Progressif',/progressive metal|progressive rock/],['Alternative',/alternative metal|alternative rock/],['Hard Rock',/hard rock/],['Metal',/metal/]];return rules.find(([,re])=>re.test(t))?.[0]||null}

export async function reverseCity(lat,lon){
  for(const zoom of [14,12,10]){try{const u=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=${zoom}&addressdetails=1`;const d=await fetchJson(u,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0'}},12000);const a=d?.address||{};const locality=a.village||a.hamlet||a.suburb||a.locality||'';const city=a.city||a.town||a.municipality||a.city_district||locality||'';const county=a.county||'';const state=a.state||'';const country=a.country||'';if(city||country)return {city,locality,municipality:a.municipality||'',county,state,country,lat:Number(lat),lon:Number(lon),display_name:String(d?.display_name||'')}}catch{}}
  return {city:'',locality:'',municipality:'',county:'',state:'',country:'',lat:Number(lat),lon:Number(lon),display_name:''};
}

export async function geocodeQuery(query){const q=String(query||'').trim();if(!q)return null;const key='query|'+norm(q);if(geoCache.has(key))return geoCache.get(key);const wait=Math.max(0,1050-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();try{const d=await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);const hit=d?.[0];const out=hit?{lat:Number(hit.lat),lon:Number(hit.lon),display_name:String(hit.display_name||q)}:null;geoCache.set(key,out);return out}catch{geoCache.set(key,null);return null}}
async function geocodeCity(city,country=''){const c=String(city||'').trim();if(!c)return null;const direct=REGIONAL_CITY_COORDS[Object.keys(REGIONAL_CITY_COORDS).find(k=>norm(k)===norm(c))];if(direct)return {lat:direct[0],lon:direct[1]};const key=norm(`${c}|${country}`);if(geoCache.has(key))return geoCache.get(key);const wait=Math.max(0,1050-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();try{const q=encodeURIComponent([c,country].filter(Boolean).join(', '));const d=await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);const hit=d?.[0];const out=hit?{lat:Number(hit.lat),lon:Number(hit.lon)}:null;geoCache.set(key,out);return out}catch{geoCache.set(key,null);return null}}
function distanceKm(lat1,lon1,lat2,lon2){const toRad=v=>v*Math.PI/180,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}

async function withDistance(rows,lat,lon,radiusKm){
  const out=[];
  for(const row of rows){
    const p=row._place||{};
    let elat=Number(p.coordinates?.latitude), elon=Number(p.coordinates?.longitude);
    const city=row.city||p.area?.name||'';
    if(!Number.isFinite(elat)||!Number.isFinite(elon)){const g=await geocodeCity(city,row.country||'');if(g){elat=g.lat;elon=g.lon}}
    if(Number.isFinite(elat)&&Number.isFinite(elon)){const d=distanceKm(lat,lon,elat,elon);if(d<=radiusKm)out.push({...row,distanceKm:Math.round(d*10)/10})}
  }
  return out;
}

const DISCOVER_FALLBACK={
  all:[['Thrown','Metalcore'],['Silent Planet','Metalcore'],['Invent Animate','Metalcore'],['Make Them Suffer','Metalcore'],['Imminence','Metalcore'],['Ten56','Metalcore'],['Brand Of Sacrifice','Deathcore'],['Paleface Swiss','Deathcore'],['Bodysnatcher','Deathcore'],['Boundaries','Metalcore'],['Kublai Khan TX','Hardcore'],['Jesus Piece','Hardcore']],
  Metalcore:[['Thrown','Metalcore'],['Silent Planet','Metalcore'],['Invent Animate','Metalcore'],['Imminence','Metalcore'],['Boundaries','Metalcore'],['Ten56','Metalcore']],
  Deathcore:[['Brand Of Sacrifice','Deathcore'],['Paleface Swiss','Deathcore'],['Bodysnatcher','Deathcore'],['Shadow Of Intent','Deathcore']],
  Hardcore:[['Kublai Khan TX','Hardcore'],['Jesus Piece','Hardcore'],['Drain','Hardcore'],['Speed','Hardcore']],
  'Nu Metal':[['From Ashes To New','Nu Metal'],['Tetrarch','Nu Metal'],['Tall Toomey','Nu Metal']],
  'Death Metal':[['Skeletal Remains','Death Metal'],['200 Stab Wounds','Death Metal'],['Gatecreeper','Death Metal']],
  'Black Metal':[['Gaerea','Black Metal'],['Kanonenfieber','Black Metal'],['Spectral Wound','Black Metal']],
  'Thrash Metal':[['Warbringer','Thrash Metal'],['Municipal Waste','Thrash Metal'],['Evile','Thrash Metal']],
  Alternative:[['Loathe','Alternative'],['Spiritbox','Alternative'],['Sleep Token','Alternative']],
  'Post-Hardcore':[['Holding Absence','Post-Hardcore'],['Static Dress','Post-Hardcore'],['Thornhill','Post-Hardcore']],
  Progressif:[['Periphery','Progressif'],['TesseracT','Progressif'],['ERRA','Progressif']]
};
export async function discoverArtists(style='all',limit=18){
  const followed=followedNames();
  const tags=style==='all'?['metal','metalcore','deathcore','hardcore','death metal','black metal','thrash metal','nu metal','progressive metal','alternative metal','post-hardcore','hard rock']:(STYLE_TAGS[style]||['metal']);
  const q=`type:group AND (${tags.map(t=>`tag:"${t}"`).join(' OR ')})`;
  try{
    const d=await mb(`${MB_BASE}/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=${Math.min(100,Math.max(20,limit*3))}`);
    const rows=(d.artists||[]).map(cleanArtist).filter(a=>!followed.has(norm(a.name))&&a.style);
    const seen=new Set(),out=[];for(const a of rows){const k=norm(a.name);if(seen.has(k))continue;seen.add(k);out.push(a);if(out.length>=limit)break}return out;
  }catch(e){
    const seen=new Set(),out=[];
    for(const [name,st] of (DISCOVER_FALLBACK[style]||DISCOVER_FALLBACK.all)){
      const k=norm(name);if(seen.has(k)||followed.has(k))continue;seen.add(k);out.push({id:`fallback-${k.replace(/[^a-z0-9]+/g,'-')}`,name,sortname:name,score:0,disambiguation:'Suggestion métal',style:st,mbid:''});if(out.length>=limit)break;
    }
    if(out.length)return out;
    throw e;
  }
}

function stripHtml(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#x27;/gi,"'").replace(/\s+/g,' ').trim()}
function parseCmDate(s){const m=String(s||'').match(/(20\d{2}-\d{2}-\d{2})/);return m?m[1]:null}
function isMetalText(s){const h=norm(s);return BROAD_METAL_TERMS.some(t=>h.includes(norm(t)))}
function isFestival(title,header,details){const h=norm(`${title} ${header} ${details}`);return /\bfestival\b|\bfest\b|hellfest|muscadeath|westill|kordevez|ragefest|in your face|tattoo fest/.test(h)}
function parseConcertsMetalHtml(html){
  const rows=[];const matches=[...String(html||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for(const m of matches){const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>stripHtml(x[1]));if(cells.length<2)continue;const header=cells[0]||'';const date=parseCmDate(header);if(!date)continue;const locMatch=header.match(/-\s*(.+)$/);const location=locMatch?locMatch[1].trim():'';const bits=location.split(',').map(x=>x.trim()).filter(Boolean);const city=bits.pop()||'';const venue=bits.join(', ')||location;const title=cells[1]||'';const details=cells.slice(2).join(' ');if(!title)continue;const text=`${title} ${details}`;if(!isMetalText(text))continue;rows.push({id:`cm-${date}-${norm(title)}-${norm(city)}`.slice(0,180),title,date,venue,city,country:'France',url:'https://nantes.concerts-metal.com/',provider:'Concerts-Metal.com',metalDetected:true,isFestival:isFestival(title,header,details),details});}
  return rows;
}

const CURATED_CONCERTS=[
 {title:'Incinerator + Lux Mentis',date:'2026-09-19',venue:'K-lumet',city:'Pontchâteau'},
 {title:'Dyside + Caned',date:'2026-09-19',venue:'BBO',city:'Nantes'},
 {title:'Havok + Blood Red Throne + Eradikated + Xonor',date:'2026-09-22',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Xandria + Seven Spires + Tulip',date:'2026-09-23',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Chop Suey + Machine Ed + Propa Roach + Slip-Not',date:'2026-09-24',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Rise Of The Northstar + ten56.',date:'2026-09-25',venue:'Quai M',city:'La Roche-sur-Yon'},
 {title:'Aephanemer + Les Bâtards Du Roi',date:'2026-09-25',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Endless Agony + Nosebleed',date:'2026-09-25',venue:'Les Gros Cailloux - Heavy Taverne',city:'Le Bignon'},
 {title:'Vulture Industries + Queen(Ares)',date:'2026-09-26',venue:'Cold Crash',city:'Rezé'},
 {title:'Grog + Road To Ruin + Trouble',date:'2026-09-26',venue:'Quai M',city:'La Roche-sur-Yon'},
 {title:'Dwell In Torment + Even If The Sky Is Falling Down + Existence + Zero Eight + Tanork',date:'2026-10-02',venue:'FEU BAR',city:'Nantes'},
 {title:'Anvil + Killer Heavy / Speed Metal',date:'2026-10-11',venue:'AK Shelter',city:'Saint-Herblain'},
 {title:'Monolord + Dopelord',date:'2026-10-11',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Myrath + Roses Of Thieves',date:'2026-10-15',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Skelethal + Hexecutor + Tanork',date:'2026-10-16',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Suffocation + Ingested + Undeath',date:'2026-10-19',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Hypno5e + Hippotraktor',date:'2026-10-24',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Kanine + NDKH + Parjure',date:'2026-10-24',venue:'Le Zinor',city:'Montaigu'},
 {title:'Black Bomb A + LocoMuerte + Hipskör + Joël Bats + The Dislockers',date:'2026-10-31',venue:'Salle Equinoxe',city:'Savenay'},
 {title:'Game Over + Death Council + Iceland + Sulfator + Suppose It’s War + Ural + Witches',date:'2026-10-31',venue:'Salle de la boule d’or',city:'Pontchâteau'},
 {title:'In Your Face #6',date:'2026-11-06',venue:'Le Zinor',city:'Montaigu'},
 {title:'Cage Fight + Kabbel + Soul Splitter',date:'2026-11-12',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Shaârghot + Ghost Dance + Solitaris',date:'2026-11-24',venue:'Stereolux',city:'Nantes'},
 {title:'Sunami + Bind. + Chute Libre + Desolated + Extinguish + Missing Link + Moral Law',date:'2026-11-27',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Arkona + Seth + The Great Old Ones',date:'2026-12-19',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Comeback Kid + Haywire + Speedway + Whispers',date:'2027-01-18',venue:'Warehouse',city:'Nantes'},
 {title:'Resolve + SPLEEN + Silent Planet',date:'2027-01-28',venue:'Warehouse',city:'Nantes'},
 {title:'Electric Callboy + Bloodywood',date:'2027-01-31',venue:'Zenith Nantes Métropole',city:'Saint-Herblain'},
 {title:'The Black Dahlia Murder + Fuming Mouth',date:'2027-02-08',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Obscura + Cryptic Shift + Dvrk + Pestilence + Thus',date:'2027-02-13',venue:'Le Chabada',city:'Angers'},
 {title:'Oceans + Kassogtha',date:'2027-03-19',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Uuhai + Acyl',date:'2027-03-25',venue:'Le Ferrailleur',city:'Nantes'},
 {title:'Sabaton',date:'2027-04-12',venue:'Zenith Nantes Métropole',city:'Saint-Herblain'}
];
async function curatedConcertFallback(lat,lon,radiusKm){
 const out=[];for(const e of CURATED_CONCERTS){const p=REGIONAL_CITY_COORDS[Object.keys(REGIONAL_CITY_COORDS).find(k=>norm(k)===norm(e.city))];if(!p)continue;const d=distanceKm(lat,lon,p[0],p[1]);if(d<=radiusKm)out.push({id:`curated-concert-${norm(e.title)}-${e.date}`,title:e.title,date:e.date,venue:e.venue,city:e.city,country:'France',url:'https://nantes.concerts-metal.com/',provider:'Concerts-Metal Nantes',metalDetected:true,distanceKm:Math.round(d*10)/10});}return out;
}

async function discoverConcertsMetal(lat,lon,radiusKm){
  try{
    const html=await fetchText('https://nantes.concerts-metal.com/',{},20000);const parsed=parseConcertsMetalHtml(html);if(!parsed.length){const fallback=await curatedConcertFallback(lat,lon,radiusKm);return {concerts:fallback,festivals:[]};}
    const dated=parsed.filter(x=>new Date(x.date)>=new Date(new Date().toISOString().slice(0,10)));
    const out=await withDistance(dated.map(x=>({...x,_place:{}})),lat,lon,radiusKm);
    const clean=out.map(({_place,details,isFestival,...x})=>({...x,details,isFestival}));
    const concerts=clean.filter(x=>!x.isFestival);
    if(!concerts.length){const fallback=await curatedConcertFallback(lat,lon,radiusKm);return {concerts:fallback,festivals:clean.filter(x=>x.isFestival)}}
    return {concerts,festivals:clean.filter(x=>x.isFestival)};
  }catch{const fallback=await curatedConcertFallback(lat,lon,radiusKm);return {concerts:fallback,festivals:[]}}
}

async function googleLocalFestivalDiscovery(place){const queries=[`festival metal ${place.city||''} ${place.state||''}`,`concert metal festival ${place.city||''} ${place.state||''}`];const found=new Map();for(const q of queries){try{const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`,{},15000);const d=new XMLParser({ignoreAttributes:false}).parse(xml);let items=d?.rss?.channel?.item||[];if(!Array.isArray(items))items=[items];for(const x of items.slice(0,20)){const title=String(x.title||'').trim(),url=String(x.link||'').trim(),desc=stripHtml(x.description||'');const hay=`${title} ${desc}`.toLowerCase();if(!title||!url||!/festival|concert|live|metal/i.test(hay))continue;const key=title.toLowerCase();if(found.has(key))continue;const gp=await geocodeQuery(`${title} ${desc}`);if(!gp)continue;const dkm=distanceKm(latOr(place),lonOr(place),gp.lat,gp.lon);if(dkm>100)continue;const metalDetected=FESTIVAL_METAL_TAGS.some(t=>hay.includes(t));if(!metalDetected)continue;found.set(key,{id:`google-local-${Buffer.from(url).toString('base64url').slice(0,24)}`,title,date:parseRssDate(x.pubDate),venue:'',city:gp.display_name?.split(',')[0]||'',country:'France',url,provider:'google-news-local',metalDetected:true,distanceKm:Math.round(dkm*10)/10});}}catch{}}return [...found.values()]}
function latOr(p){return Number(p?.lat)||0} function lonOr(p){return Number(p?.lon)||0}
function parseRssDate(v){const d=new Date(String(v||''));return Number.isNaN(d.getTime())?null:d.toISOString()}

async function curatedFestivalFallback(lat,lon,radiusKm){const seeds=[{title:'Muscadeath XXIV',date:'2026-09-18',venue:'Le Champilambart',city:'Vallet',country:'France',url:'https://www.muscadeath.fr/',metalDetected:true,lat:47.1627,lon:-1.2667,provider:'Muscadeath officiel'},{title:'Kordevez Festival 2026',date:'2026-09-18',venue:'Hippodrome de la Loire',city:'Cordemais',country:'France',url:'https://nantes.concerts-metal.com/',metalDetected:true,lat:47.2917,lon:-1.8783,provider:'Concerts-Metal Nantes'},{title:'Westill 2026',date:'2026-10-30',venue:'Le Champilambart',city:'Vallet',country:'France',url:'https://nantes.concerts-metal.com/',metalDetected:true,lat:47.1627,lon:-1.2667,provider:'Concerts-Metal Nantes'},{title:'Mauges Pit Fest V',date:'2026-10-02',venue:'Salle Thomas Dupouet',city:'Saint-Macaire-en-Mauges',country:'France',url:'https://nantes.concerts-metal.com/',metalDetected:true,lat:47.1233,lon:-0.994,provider:'Concerts-Metal Nantes'}];const out=[];for(const f of seeds){const d=distanceKm(lat,lon,f.lat,f.lon);if(d<=radiusKm)out.push({id:`curated-${norm(f.title)}`,title:f.title,date:f.date,venue:f.venue,city:f.city,country:f.country,url:f.url,provider:f.provider,metalDetected:true,distanceKm:Math.round(d*10)/10})}return out}

export async function discoverNearbyFestivals(lat,lon,radiusKm=50,placeOverride=null){
  const place=placeOverride?{...await reverseCity(lat,lon),...placeOverride,lat:Number(lat),lon:Number(lon)}:await reverseCity(lat,lon);const all=[];
  try{const cm=await discoverConcertsMetal(lat,lon,radiusKm);all.push(...cm.festivals)}catch{}
  const curated=await curatedFestivalFallback(lat,lon,radiusKm);all.push(...curated);
  const dedup=new Map(all.map(x=>[norm(x.title),x]));
  const today=new Date().toISOString().slice(0,10);
  let items=[...dedup.values()]
    .filter(x=>!x.date || String(x.date).slice(0,10)>=today)
    .sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10))||a.distanceKm-b.distanceKm);
  if(!items.length){try{const local=await googleLocalFestivalDiscovery(place);items=local.filter(x=>x.distanceKm<=radiusKm&&(!x.date||String(x.date).slice(0,10)>=today)).sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10)))}catch{}}
  return {place,radiusKm,items};
}

export async function discoverNearbyConcerts(lat,lon,radiusKm=50,placeOverride=null){
  const place=placeOverride?{...await reverseCity(lat,lon),...placeOverride,lat:Number(lat),lon:Number(lon)}:await reverseCity(lat,lon);let items=[];
  try{const cm=await discoverConcertsMetal(lat,lon,radiusKm);items=cm.concerts}catch{}
  if(!items.length){
    const today=new Date().toISOString().slice(0,10),end=new Date(Date.now()+1000*60*60*24*180).toISOString().slice(0,10),tags=['metal','metalcore','deathcore','hardcore','death metal','black metal','thrash metal','nu metal','progressive metal','alternative metal','post-hardcore','hard rock'];const areas=[...new Set([place.locality,place.city,place.municipality,place.county,place.state].filter(Boolean))];const all=new Map();
    for(const area of areas){try{const q=`area:"${area.replace(/"/g,'')}" AND begin:[${today} TO ${end}] AND (${tags.map(t=>`tag:"${t}"`).join(' OR ')})`;const d=await mb(`${MB_BASE}/event/?query=${encodeURIComponent(q)}&fmt=json&limit=100&inc=place-rels`);for(const e of(d.events||[])){if(all.has(e.id))continue;const p=e.place||{},date=e['life-span']?.begin||e.date||null;if(!date)continue;all.set(e.id,{id:e.id,title:e.name||'Concert',date,time:e.time||null,venue:p.name||'',city:p.area?.name||place.city,country:p.area?.['iso-3166-1-codes']?.[0]||place.country,url:`https://musicbrainz.org/event/${e.id}`,provider:'MusicBrainz',_place:p})}}catch{}}
    const rows=await withDistance([...all.values()],lat,lon,radiusKm);items=rows.map(({_place,...x})=>x).sort((a,b)=>a.distanceKm-b.distanceKm||String(a.date).localeCompare(String(b.date)));
  }
  // Final safety filter: never display a concert whose event date is already past,
  // regardless of which discovery source supplied it (including curated fallback data).
  const today=new Date().toISOString().slice(0,10);
  items=items
    .filter(x=>!x.date || String(x.date).slice(0,10)>=today)
    .sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10))||a.distanceKm-b.distanceKm);
  // Discovery is deliberately isolated from the tracked-artist concert engine.
  // Tracked concerts come only from Bandsintown + InfoConcert.
  return {place,radiusKm,items};
}
