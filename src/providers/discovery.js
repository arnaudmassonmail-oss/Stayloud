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
function cleanArtist(a){return {id:a.id,name:a.name,sortname:a.sortname||a.name,score:a.score||0,disambiguation:a.disambiguation||'',style:inferStyle((a.tags||[]).map(t=>String(t.name||'').toLowerCase())),mbid:a.id,source:'MusicBrainz'}}
function inferStyle(tags){const t=tags.join(' ');const rules=[['Deathcore',/deathcore/],['Metalcore',/metalcore/],['Post-Hardcore',/post-hardcore/],['Hardcore',/hardcore/],['Nu Metal',/nu metal|nu-metal/],['Death Metal',/death metal/],['Black Metal',/black metal/],['Thrash Metal',/thrash metal/],['Progressif',/progressive metal|progressive rock/],['Alternative',/alternative metal|alternative rock/],['Hard Rock',/hard rock/],['Metal',/metal/]];return rules.find(([,re])=>re.test(t))?.[0]||null}

export async function reverseCity(lat,lon){
  for(const zoom of [14,12,10]){try{const u=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=${zoom}&addressdetails=1`;const d=await fetchJson(u,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0'}},12000);const a=d?.address||{};const locality=a.village||a.hamlet||a.suburb||a.locality||'';const city=a.city||a.town||a.municipality||a.city_district||locality||'';const county=a.county||'';const state=a.state||'';const country=a.country||'';if(city||country)return {city,locality,municipality:a.municipality||'',county,state,country,lat:Number(lat),lon:Number(lon),display_name:String(d?.display_name||'')}}catch{}}
  return {city:'',locality:'',municipality:'',county:'',state:'',country:'',lat:Number(lat),lon:Number(lon),display_name:''};
}

function cityQueryName(value){
  return norm(String(value||'').replace(/\s*,\s*(?:france|fr)$/i,'').trim());
}
function candidateCityName(properties){
  const p=properties||{};
  const label=String(p.label||'').split(',')[0].trim();
  return String(p.city||p.name||label||'').trim();
}
function strictCityMatch(candidate,query){
  const nq=cityQueryName(query);
  if(!nq)return false;
  const p=candidate?.properties||candidate?.address||candidate||{};
  const names=[p.city,p.name,p.town,p.municipality,p.village,p.city_district,String(p.label||'').split(',')[0]].filter(Boolean).map(cityQueryName);
  return names.includes(nq);
}
function buildGeocodedCity(candidate,requested){
  const c=candidate?.geometry?.coordinates;
  if(!Array.isArray(c)||c.length<2)return null;
  const lat=Number(c[1]),lon=Number(c[0]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
  const p=candidate?.properties||{};
  // Never replace the user's requested city with an unrelated provider result.
  // The requested spelling is the canonical UI/search identity; provider data
  // is used only to obtain coordinates and a display label.
  return {lat,lon,display_name:String(p.label||`${requested}, France`),city:String(requested).trim(),resolved_city:candidateCityName(p),country:'France'};
}

export async function geocodeQuery(query){
  const q=String(query||'').trim();
  if(!q)return null;
  const key='query|'+norm(q);
  if(geoCache.has(key))return geoCache.get(key);
  const directKey=Object.keys(REGIONAL_CITY_COORDS).find(k=>norm(k)===norm(q));
  if(directKey){const p=REGIONAL_CITY_COORDS[directKey];const out={lat:p[0],lon:p[1],display_name:`${directKey}, France`,city:directKey,resolved_city:directKey,country:'France'};geoCache.set(key,out);return out}
  const queries=[`${q}, France`,q];

  // 1) Base Adresse Nationale / Géoplateforme. We only accept a result when
  // the returned commune name actually matches what the user typed. The old
  // implementation accepted the first "municipality" result, which could
  // silently turn "Versailles" into an unrelated commune such as Cugand.
  for(const searchQ of queries){
    const wait=Math.max(0,650-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();
    try{
      const u=`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(searchQ)}&type=municipality&limit=10`;
      const d=await fetchJson(u,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);
      const features=Array.isArray(d?.features)?d.features:[];
      const hit=features.find(f=>strictCityMatch(f,q));
      const out=hit?buildGeocodedCity(hit,q):null;
      if(out){geoCache.set(key,out);return out}
    }catch{}
  }

  // 2) API Adresse. Same strict matching rule.
  for(const searchQ of queries){
    const wait=Math.max(0,650-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();
    try{
      const d=await fetchJson(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(searchQ)}&type=municipality&limit=10`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);
      const features=Array.isArray(d?.features)?d.features:[];
      const hit=features.find(f=>strictCityMatch(f,q));
      const out=hit?buildGeocodedCity(hit,q):null;
      if(out){geoCache.set(key,out);return out}
    }catch{}
  }

  // 3) Nominatim fallback. Again, never accept the first fuzzy result if its
  // city name is different from the requested city.
  for(const searchQ of queries){
    const wait=Math.max(0,800-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();
    try{
      const d=await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&countrycodes=fr&addressdetails=1&q=${encodeURIComponent(searchQ)}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);
      const hits=Array.isArray(d)?d:[];
      const hit=hits.find(x=>strictCityMatch(x,q));
      if(hit){
        const out={lat:Number(hit.lat),lon:Number(hit.lon),display_name:String(hit.display_name||`${q}, France`),city:q,resolved_city:String(hit.address?.city||hit.address?.town||hit.address?.municipality||hit.address?.village||hit.name||q),country:String(hit.address?.country||'France')};
        if(Number.isFinite(out.lat)&&Number.isFinite(out.lon)){geoCache.set(key,out);return out}
      }
    }catch{}
  }
  geoCache.set(key,null);return null;
}
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
export {discoverManualCityConcerts};
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
function extractConcertTitle(details){
  const raw=String(details||'').replace(/\s+/g,' ').trim();
  if(!raw)return '';
  const stylePattern=new RegExp('\\b(?:'+BROAD_METAL_TERMS.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')\\b','i');
  const parts=raw.split(/\s{2,}|\s+\|\s+/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>1){
    const kept=[];
    for(const part of parts){if(stylePattern.test(part)&&kept.length)break;kept.push(part)}
    if(kept.length)return kept.join(' ');
  }
  const m=raw.search(stylePattern);
  return (m>0?raw.slice(0,m):raw).trim();
}
function parseConcertsMetalHtml(html,sourceUrl=''){
  const rows=[];
  const matches=[...String(html||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for(const m of matches){
    const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>stripHtml(x[1]));
    if(cells.length<2)continue;
    const whole=cells.join(' | ');
    const date=parseCmDate(whole); if(!date)continue;
    const header=cells.find(x=>parseCmDate(x))||whole;
    const locMatch=header.match(/(?:20\d{2}-\d{2}-\d{2})(?:\s*\([^)]*\))?\s*-\s*(.+)$/i);
    const location=locMatch?locMatch[1].trim():'';
    const bits=location.split(',').map(x=>x.trim()).filter(Boolean);
    const city=bits.pop()||''; const venue=bits.join(', ')||location;
    const details=cells.slice(1).join(' ').replace(/\s+/g,' ').trim();
    if(!details||!isMetalText(details))continue;
    const title=extractConcertTitle(details)||details.slice(0,160);
    rows.push({id:`cm-${date}-${norm(title)}-${norm(city)}`.slice(0,180),title,date,venue,city,country:'France',url:sourceUrl,provider:'Concerts-Metal.com',metalDetected:true,isFestival:isFestival(title,location,details),details});
  }
  return rows;
}

// r.jina.ai normally returns a Markdown rendering of Concerts-Metal.  The
// public page is currently a table whose event location is written as
// "Je 2026-10-01 - Elysée Montmartre, Paris" followed by the artists/styles.
// Accept the date anywhere in a rendered table row so leading Markdown pipes
// or columns cannot make the event disappear.
function parseConcertsMetalText(text,sourceUrl=''){
  const rows=[]; const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const dateLine=/(20\d{2}-\d{2}-\d{2})(?:\s*\([^)]*\))?\s*-\s*(.+)$/i;
  for(let i=0;i<lines.length;i++){
    const cleanLine=lines[i].replace(/^\|+|\|+$/g,'').replace(/\s*\|\s*/g,' ').replace(/^[-*]\s*/,'').replace(/\s+/g,' ').trim();
    const m=cleanLine.match(dateLine); if(!m)continue;
    const date=m[1], location=m[2].trim();
    const bits=location.split(',').map(x=>x.trim()).filter(Boolean);
    const city=bits.pop()||''; const venue=bits.join(', ')||location;
    const detailParts=[];
    for(let j=i+1;j<Math.min(lines.length,i+5);j++){
      const next=lines[j].replace(/^\|+|\|+$/g,'').replace(/\s*\|\s*/g,' ').replace(/^[-*]\s*/,'').replace(/\s+/g,' ').trim();
      if(!next||dateLine.test(next)||/^#{1,4}\s/.test(next))break;
      if(/^(Liens|Tickets|Concerts \/ Festivals|Prochains concerts)/i.test(next))continue;
      detailParts.push(next);
    }
    const details=detailParts.join(' ').replace(/\s+/g,' ').trim();
    if(!details||!isMetalText(details))continue;
    const title=extractConcertTitle(details)||details.slice(0,160);
    const key=`${date}|${norm(title)}|${norm(venue)}|${norm(city)}`;
    if(rows.some(x=>`${x.date}|${norm(x.title)}|${norm(x.venue)}|${norm(x.city)}`===key))continue;
    rows.push({id:`cm-${date}-${norm(title)}-${norm(city)}`.slice(0,180),title,date,venue,city,country:'France',url:sourceUrl,provider:'Concerts-Metal.com',metalDetected:true,isFestival:isFestival(title,location,details),details});
  }
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

const METAL_DISCOVERY_SOURCES=[
  {slug:'nantes',name:'Nantes / Pays de la Loire',lat:47.2184,lon:-1.5536},
  {slug:'bretagne',name:'Bretagne',lat:48.1173,lon:-1.6778},
  {slug:'paris',name:'Paris / Île-de-France',lat:48.8566,lon:2.3522},
  {slug:'lille',name:'Lille / Nord-Pas-de-Calais',lat:50.6292,lon:3.0573},
  {slug:'lyon',name:'Lyon / Rhône-Alpes',lat:45.7640,lon:4.8357},
  {slug:'bordeaux',name:'Bordeaux / Aquitaine',lat:44.8378,lon:-0.5792},
  {slug:'toulouse',name:'Toulouse / Midi-Pyrénées',lat:43.6047,lon:1.4442},
  {slug:'marseille',name:'Marseille / PACA',lat:43.2965,lon:5.3698},
  {slug:'montpellier',name:'Montpellier / Languedoc-Roussillon',lat:43.6108,lon:3.8767},
  {slug:'strasbourg',name:'Strasbourg / Alsace',lat:48.5734,lon:7.7521},
  {slug:'grenoble',name:'Grenoble / Alpes',lat:45.1885,lon:5.7245},
  {slug:'rennes',name:'Rennes / Bretagne',lat:48.1173,lon:-1.6778}
];

function eventHasMetal(row){
 const hay=norm(`${row?.title||''} ${row?.details||''}`);
 const terms=['metal','metalcore','deathcore','hardcore','death metal','black metal','thrash metal','nu metal','progressive metal','alternative metal','post-hardcore','hard rock','doom','stoner','djent','grind','heavy metal','crossover','industrial metal','groove metal','technical death metal','punk hardcore','post-metal','mathcore','metallic hardcore','electronicore','folk metal','power metal','speed metal','sludge','gothic metal','symphonic metal'];
 return terms.some(t=>hay.includes(t));
}

async function fetchDiscoveryProxy(url,timeout=18000){
  const proxy=`https://r.jina.ai/${url}`;
  return fetchText(proxy,{headers:{Accept:'text/plain, text/markdown, text/html','User-Agent':'Mozilla/5.0 STAYLOUD/1.0'}},timeout);
}

async function cityWebSearch(query){
  const q=encodeURIComponent(String(query||''));
  const urls=[
    `https://www.bing.com/search?q=${q}`,
    `https://r.jina.ai/https://www.bing.com/search?q=${q}`,
    `https://www.google.com/search?q=${q}`,
    `https://r.jina.ai/https://www.google.com/search?q=${q}`
  ];
  for(const u of urls){
    try{
      const t=await fetchText(u,{headers:{Accept:'text/html,text/plain', 'Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8','User-Agent':'Mozilla/5.0 STAYLOUD/1.0'}},18000);
      if(t&&t.length>300)return t;
    }catch{}
  }
  return '';
}
function extractCitySourceUrls(text){
  const raw=String(text||'').replace(/&amp;/gi,'&').replace(/\\/g,'');
  const out={concertsMetal:[],songkick:[]};
  const add=(kind,u)=>{
    try{const x=new URL(u);
      if(kind==='concertsMetal' && /(?:^|\.)concerts-metal\.com$/i.test(x.hostname))out.concertsMetal.push(x.origin+'/');
      if(kind==='songkick' && /(?:^|\.)songkick\.com$/i.test(x.hostname) && /\/metro-areas\//i.test(x.pathname))out.songkick.push(x.href.split('?')[0]);
    }catch{}
  };
  const urls=[...raw.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map(m=>m[0].replace(/[),.;]+$/,''));
  for(const u of urls){if(/concerts-metal\.com/i.test(u))add('concertsMetal',u);if(/songkick\.com/i.test(u))add('songkick',u);}
  const hrefs=[...raw.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);
  for(const h of hrefs){let u=h;try{if(/^\//.test(u))u='https://www.google.com'+u;const dec=decodeURIComponent(u);if(/concerts-metal\.com/i.test(dec))add('concertsMetal',dec);if(/songkick\.com/i.test(dec))add('songkick',dec);}catch{}}
  return {concertsMetal:[...new Set(out.concertsMetal)],songkick:[...new Set(out.songkick)]};
}
function songkickMetroFromUrl(url){
  const m=String(url||'').match(/\/metro-areas\/([^/?#]+)(?:\/|$)/i);
  if(!m)return null;
  const slug=m[1];
  const known=SONGKICK_METAL_METROS.find(x=>x.slug===slug);
  if(known)return known;
  const city=(slug.match(/(?:^|-)france-(.+)$/i)||[])[1]?.replace(/-/g,' ')||slug.replace(/-/g,' ');
  return {slug,name:city.replace(/\b\w/g,c=>c.toUpperCase()),lat:0,lon:0};
}
async function discoverManualCityConcerts(city){
  const requested=String(city||'').trim();
  if(!requested)return {city:'',items:[],sources:[]};
  const all=[]; const sources=[];
  // Step 1: Bandsintown is addressed directly with the exact city string.
  try{
    const r=await fetchBandsintownCity(requested);
    if(r.rows.length){
      const correctedRows=await correctManualEventCities(r.rows,requested);
      all.push(...correctedRows);
      sources.push({provider:'Bandsintown',url:r.url,mode:'city'});
    }
  }catch{}
  // Step 1b: discover the source pages from the city name itself. No GPS or
  // coordinates participate in selecting these pages.
  try{
    const [cmSearch,skSearch]=await Promise.all([
      cityWebSearch(`site:concerts-metal.com ${requested} metal concerts`),
      cityWebSearch(`site:songkick.com/fr/metro-areas ${requested} metal`)
    ]);
    const found=extractCitySourceUrls(cmSearch+'\n'+skSearch);
    const cmUrls=found.concertsMetal.slice(0,3);
    for(const url of cmUrls){
      try{const source={slug:new URL(url).hostname.split('.')[0],name:`Concerts-Metal · ${requested}`};const text=await fetchDiscoveryProxy(url,18000);let rows=parseConcertsMetalHtml(text,url);if(!rows.length)rows=parseConcertsMetalText(text,url);if(rows.length){all.push(...rows);sources.push({provider:'Concerts-Metal.com',url,mode:'city-search'});break;}}catch{}
    }
    const skUrls=found.songkick.filter(u=>/genre\/metal|2026\/genre\/metal/i.test(u));
    for(const url of skUrls.slice(0,3)){
      try{const metro=songkickMetroFromUrl(url);if(!metro)continue;const text=await fetchDiscoveryProxy(url,18000);let rows=parseSongkickMetalText(text,metro);if(!rows.length)rows=parseSongkickMetalHtml(text,metro);if(rows.length){all.push(...rows);sources.push({provider:'Songkick',url,mode:'city-search'});break;}}catch{}
    }
  }catch{}
  const today=new Date().toISOString().slice(0,10);
  const unique=new Map();
  for(const row of all){if(!row?.date||String(row.date).slice(0,10)<today)continue;const k=`${row.date}|${norm(row.title)}|${norm(row.venue)}|${norm(row.city)}`;if(!unique.has(k))unique.set(k,row);}
  // IMPORTANT: This step intentionally does NOT calculate distance. The only
  // question for this version is whether the typed city controls the source
  // selection. Radius/geolocation will be reintroduced as the next isolated step.
  const items=[...unique.values()].filter(x=>eventHasMetal(x)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  return {city:requested,items,sources};
}

async function fetchMetalRegionalSource(source){
 const url=`https://${source.slug}.concerts-metal.com/`;
 // Try the clean proxy first because Render/free hosts can receive a different
 // response from the public site than a normal browser. Direct fetch remains
 // the fallback so existing feeds keep working if the proxy is unavailable.
 try{
  const text=await fetchDiscoveryProxy(url,18000);
  let parsed=parseConcertsMetalHtml(text,url);
  if(!parsed.length)parsed=parseConcertsMetalText(text,url);
  if(parsed.length)return {source,rows:parsed,error:null,transport:'jina'};
 }catch{}
 try{
  const html=await fetchText(url,{headers:{Accept:'text/html'}},15000);
  const parsed=parseConcertsMetalHtml(html,url);
  return {source,rows:parsed,error:null,transport:'direct'};
 }catch(e){return {source,rows:[],error:e};}
}



// Secondary nationwide source: Songkick's city-level Metal agendas.
// This supplements (never replaces) the proven Concerts-Metal feeds.
const SONGKICK_METAL_METROS=[
  {slug:'28909-france-paris',name:'Paris / Île-de-France',lat:48.8566,lon:2.3522},
  {slug:'28901-france-nantes',name:'Nantes / Pays de la Loire',lat:47.2184,lon:-1.5536},
  {slug:'28889-france-lyon',name:'Lyon / Rhône-Alpes',lat:45.7640,lon:4.8357},
  {slug:'28886-france-lille',name:'Lille / Nord',lat:50.6292,lon:3.0573},
  {slug:'28851-france-bordeaux',name:'Bordeaux / Gironde',lat:44.8378,lon:-0.5792},
  {slug:'28930-france-toulouse',name:'Toulouse / Occitanie',lat:43.6047,lon:1.4442},
  {slug:'156979-france-marseille',name:'Marseille / PACA',lat:43.2965,lon:5.3698},
  {slug:'28928-france-strasbourg',name:'Strasbourg / Alsace',lat:48.5734,lon:7.7521},
  {slug:'28916-france-rennes',name:'Rennes / Bretagne',lat:48.1173,lon:-1.6778},
  {slug:'28896-france-montpellier',name:'Montpellier / Occitanie',lat:43.6108,lon:3.8767},
  {slug:'28876-france-grenoble',name:'Grenoble / Alpes',lat:45.1885,lon:5.7245},
  {slug:'28918-france-rouen',name:'Rouen / Normandie',lat:49.4432,lon:1.0993},
  {slug:'28863-france-clermont-ferrand',name:'Clermont-Ferrand / Auvergne',lat:45.7772,lon:3.0870},
  {slug:'28899-france-nancy',name:'Nancy / Lorraine',lat:48.6921,lon:6.1844},
  {slug:'28869-france-dijon',name:'Dijon / Bourgogne',lat:47.3220,lon:5.0415}
];


const BI_MONTHS={jan:1,january:1,janvier:1,feb:2,february:2,fevrier:2,'février':2,mar:3,march:3,mars:3,apr:4,april:4,avril:4,may:5,mai:5,jun:6,june:6,juin:6,jul:7,july:7,juillet:7,aug:8,august:8,aout:8,'août':8,sep:9,sept:9,september:9,septembre:9,oct:10,october:10,octobre:10,nov:11,november:11,novembre:11,dec:12,december:12,decembre:12,'décembre':12};
const BI_WEEKDAYS='lun|lundi|mar|mardi|mer|mercredi|jeu|jeudi|ven|vendredi|sam|samedi|dim|dimanche|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday';
function parseBandsintownDate(text){
  const h=stripHtml(text).replace(/\s+/g,' ').trim().toLowerCase();
  const m=h.match(new RegExp(`(?:${BI_WEEKDAYS})\\.?\\s+(\\d{1,2})\\s+([a-zéûôîà]+)\\.?\\s+(20\\d{2})`,'i'))
    ||h.match(new RegExp(`(?:${BI_WEEKDAYS})\\.?\\s+(\\d{1,2})\\s+([a-zéûôîà]+)\\.?`,'i'))
    ||h.match(/\b(\d{1,2})\s+([a-zéûôîà]+)\.?\s+(20\d{2})\b/i)
    ||h.match(/\b(\d{1,2})\s+([a-zéûôîà]+)\.?\b/i);
  if(!m)return null;
  const month=BI_MONTHS[m[2]]||BI_MONTHS[norm(m[2])]; if(!month)return null;
  let year=Number(m[3]||new Date().getFullYear());
  if(!m[3]){const now=new Date(); if(year===now.getFullYear()&&month<now.getMonth()+1)year++;}
  return `${year}-${String(month).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
}
function bandsintownSlug(city){return norm(city).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function parseBandsintownMetalText(text,targetCity,sourceUrl){
  const rows=[]; const seen=new Set();
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const eventRe=new RegExp(`^(.+?)\\s+(?:${BI_WEEKDAYS})\\.?\\s+\\d{1,2}\\s+[a-zéûôîà]+\\.?\\s+•\\s+\\d{1,2}(?::\\d{2})?\\s+(.+)$`,'i');
  for(const raw of lines){
    const line=raw.replace(/^[-*]\s*/,'').replace(/\s+/g,' ').trim();
    const m=line.match(eventRe); if(!m)continue;
    const date=parseBandsintownDate(line); if(!date)continue;
    const title=m[1].trim(),venue=m[2].trim();
    if(!title||!venue||/^(toutes les dates|tous les artistes|tout afficher|explorer par genres)$/i.test(title))continue;
    const key=`${date}|${norm(title)}|${norm(venue)}`; if(seen.has(key))continue;seen.add(key);
    rows.push({id:`bandsintown-${date}-${norm(title)}-${norm(venue)}`.slice(0,190),title,date,venue,city:targetCity,country:'France',url:sourceUrl,provider:'Bandsintown Metal',metalDetected:true,isFestival:/festival|fest\b/i.test(title)||/festival|fest\b/i.test(venue),details:'Source: Bandsintown, agenda Metal',_bandsintownVenueOnly:true});
  }
  // Fallback parser for the current Bandsintown city page rendering:
  // "Artist Mar. 22 sept. • 19 h Venue" (without a weekday in some responses).
  if(!rows.length){
    for(const raw of lines){
      const line=raw.replace(/^[-*]\s*/,'').replace(/\s+/g,' ').trim();
      const m=line.match(/^(.+?)\s+(?:(?:lun|mar|mer|jeu|ven|sam|dim|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\.?\s+)?(\d{1,2})\s+([a-zéûôîà]+)\.?\s*(?:20(\d{2}))?\s*(?:•\s*(\d{1,2}(?::\d{2})?)\s*(?:h)?\s*)?(.+)$/i);
      if(!m)continue;
      const date=parseBandsintownDate(line); if(!date)continue;
      const title=m[1].trim(),venue=m[5].trim();
      if(!title||!venue||title.length<2||/^(toutes les dates|tous les artistes|tout afficher|explorer par genres)$/i.test(title))continue;
      if(!isMetalText(`${title} ${venue}`))continue;
      const key=`${date}|${norm(title)}|${norm(venue)}`; if(seen.has(key))continue;seen.add(key);
      rows.push({id:`bandsintown-${date}-${norm(title)}-${norm(venue)}`.slice(0,190),title,date,venue,city:targetCity,country:'France',url:sourceUrl,provider:'Bandsintown Metal',metalDetected:true,isFestival:/festival|fest\b/i.test(title)||/festival|fest\b/i.test(venue),details:'Source: Bandsintown, agenda Metal',_bandsintownVenueOnly:true});
    }
  }
  return rows;
}
async function correctManualEventCities(rows,targetCity){
  const list=Array.isArray(rows)?rows:[];
  const venues=[...new Set(list.map(x=>String(x?.venue||'').trim()).filter(Boolean))];
  const corrected=new Map();
  for(const venue of venues){
    // For manual city searches, the source page can assign every event the
    // searched city even when the venue is actually in a neighbouring commune.
    // Resolve the venue itself, then reverse-geocode its coordinates to get the
    // real commune. This is deliberately limited to rows whose source city is
    // the requested city, so we do not overwrite a provider's more precise city.
    let place=await geocodeEventVenue(venue,'');
    if(!place && targetCity)place=await geocodeEventVenue(venue,targetCity);
    if(!place)continue;
    try{
      const key='venue-city|'+norm(venue);
      let cityInfo=geoCache.get(key);
      if(!cityInfo){
        // Keep reverse geocoding polite; one venue is enough to establish its commune.
        await sleep(650);
        cityInfo=await reverseCity(place.lat,place.lon);
        if(cityInfo?.city)geoCache.set(key,cityInfo);
      }
      const city=String(cityInfo?.city||'').trim();
      if(city)corrected.set(norm(venue),city);
    }catch{}
  }
  return list.map(row=>{
    const sourceCity=String(row?.city||'').trim();
    const venueCity=corrected.get(norm(row?.venue||''));
    if(venueCity && (!sourceCity || norm(sourceCity)===norm(targetCity||'')))return {...row,city:venueCity};
    return row;
  });
}

async function fetchBandsintownCity(city,lat=null,lon=null){
  const slug=bandsintownSlug(city); if(!slug)return {rows:[]};
  const suffix=(Number.isFinite(Number(lat))&&Number.isFinite(Number(lon)))?`?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`:'';
  const url=`https://www.bandsintown.com/fr/c/${slug}-france/all-dates/genre/metal${suffix}`;
  try{
    const text=await fetchDiscoveryProxy(url,18000); const rows=parseBandsintownMetalText(text,city,url); if(rows.length)return {rows,url,transport:'jina'};
  }catch{}
  try{
    const html=await fetchText(url,{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 STAYLOUD/1.0'}},18000); const rows=parseBandsintownMetalText(html,city,url); if(rows.length)return {rows,url,transport:'direct'};
  }catch{}
  return {rows:[],url};
}
async function geocodeEventVenue(venue,targetCity){
  const q=String([venue,targetCity,'France'].filter(Boolean).join(', ')).trim(); if(!q)return null;
  const key='eventplace|'+norm(q); if(geoCache.has(key))return geoCache.get(key);
  try{
    const d=await fetchJson(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);
    const c=d?.features?.[0]?.geometry?.coordinates; if(Array.isArray(c)&&c.length>=2){const out={lat:Number(c[1]),lon:Number(c[0])};if(Number.isFinite(out.lat)&&Number.isFinite(out.lon)){geoCache.set(key,out);return out}}
  }catch{}
  try{
    const d=await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);
    const hit=d?.[0]; const out=hit?{lat:Number(hit.lat),lon:Number(hit.lon)}:null; if(out&&Number.isFinite(out.lat)&&Number.isFinite(out.lon)){geoCache.set(key,out);return out}
  }catch{}
  geoCache.set(key,null); return null;
}
async function discoverBandsintownMetal(city,lat,lon,radiusKm){
  const r=await fetchBandsintownCity(city,lat,lon); if(!r.rows.length)return [];
  const uniqueVenues=[...new Set(r.rows.map(x=>x.venue).filter(Boolean))].slice(0,80); const venueCoords=new Map();
  for(const venue of uniqueVenues){const p=await geocodeEventVenue(venue,city); if(p)venueCoords.set(norm(venue),p);}
  // Never assume that an event belongs to the requested city when its venue
  // could not be geocoded. That assumption was the exact mechanism that could
  // make a stale/wrong Bandsintown page (for example Cugand) leak into a
  // Versailles search. A venue must have real coordinates before it can pass
  // the target-city radius filter.
  const located=[];
  for(const row of r.rows){const p=venueCoords.get(norm(row.venue)); if(!p)continue; row._place={coordinates:{latitude:p.lat,longitude:p.lon}}; located.push(row);}
  const filtered=await withDistance(located,lat,lon,radiusKm);
  return filtered.map(x=>({...x,city:x.city||city}));
}

const FR_MONTHS={janvier:1,fevrier:2,février:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,août:8,septembre:9,octobre:10,novembre:11,decembre:12,décembre:12};
function parseSongkickDate(text){
  const h=stripHtml(text).replace(/\s+/g,' ').trim().toLowerCase();
  const m=h.match(/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+([a-zéûôîà]+)\s+(20\d{2})/i)
    ||h.match(/\b(\d{1,2})\s+([a-zéûôîà]+)\s+(20\d{2})\b/i);
  if(!m)return null;
  const month=FR_MONTHS[m[2]]||FR_MONTHS[norm(m[2])]; if(!month)return null;
  return `${m[3]}-${String(month).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
}
function songkickRow(metro,date,title,venue,city){
  title=String(title||'').replace(/\s+/g,' ').trim(); venue=String(venue||'').replace(/\s+/g,' ').trim(); city=String(city||'').replace(/\s+/g,' ').trim()||metro.name.split(' / ')[0];
  if(!date||!title||!venue)return null;
  return {id:`songkick-${metro.slug}-${date}-${norm(title)}-${norm(city)}`.slice(0,190),title,date,venue,city,country:'France',url:`https://www.songkick.com/fr/metro-areas/${metro.slug}/genre/metal`,provider:'Songkick Metal',metalDetected:true,isFestival:/festival|fest\b/i.test(title),details:'Source: Songkick, agenda Metal'};
}
function parseSongkickMetalHtml(html,metro){
  const src=String(html||''); const rows=[]; const seen=new Set();
  const re=/<a\b[^>]*href=["']([^"']*\/concerts\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(src))){
    const title=stripHtml(m[2]); if(!title||title.length<2)continue;
    const window=src.slice(m.index,Math.min(src.length,m.index+5000));
    const date=parseSongkickDate(window); if(!date)continue;
    const venueMatch=window.match(/<a\b[^>]*href=["'][^"']*\/venues\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const venue=venueMatch?stripHtml(venueMatch[1]):'';
    const plain=stripHtml(window).replace(/\s+/g,' ');
    let city=metro.name.split(' / ')[0];
    const cityMatch=plain.match(/,\s*([^,<>]{2,60})\s*,\s*France\b/i); if(cityMatch)city=cityMatch[1].trim();
    const row=songkickRow(metro,date,title,venue,city); if(!row)continue;
    const key=`${date}|${norm(title)}|${norm(venue)}|${norm(city)}`; if(seen.has(key))continue; seen.add(key); rows.push(row);
  }
  return rows;
}
function parseSongkickMetalText(text,metro){
  const src=String(text||''); const rows=[]; const seen=new Set();
  const lines=src.split(/\r?\n/).map(x=>stripHtml(x).replace(/\s+/g,' ').trim()).filter(Boolean);
  const add=(date,title,venue,city)=>{const row=songkickRow(metro,date,title,venue,city);if(!row)return;const key=`${date}|${norm(title)}|${norm(venue)}|${norm(city)}`;if(seen.has(key))return;seen.add(key);rows.push(row)};
  // Current Songkick server-rendered page layout is: title / venue, city, France / date.
  for(let i=0;i<lines.length;i++){
    const date=parseSongkickDate(lines[i]); if(!date)continue;
    let venue='',city='',title='';
    for(let j=i-1;j>=Math.max(0,i-3);j--){
      const line=lines[j].replace(/^[-*•]\s*/,'').trim();
      const vm=line.match(/^(?:\[)?(.+?)(?:\])?\s*,\s*([^,]+?)\s*,\s*France$/i);
      if(vm){venue=vm[1].replace(/^\[[^]]+\]\([^)]*\)$/,'').trim();city=vm[2].trim();if(j-1>=0)title=lines[j-1].replace(/^[-*•]\s*/,'').replace(/^\[[^]]+\]\([^)]*\)$/,'').trim();break;}
      const vm2=line.match(/^(.+?)\s*,\s*([^,]+?)\s*,\s*France$/i);
      if(vm2){venue=vm2[1].trim();city=vm2[2].trim();if(j-1>=0)title=lines[j-1].replace(/^[-*•]\s*/,'').trim();break;}
    }
    if(title&&venue&&city)add(date,title,venue,city);
  }
  // Markdown link layout fallback.
  for(let i=0;i<lines.length;i++){
    const tm=String(src.split(/\r?\n/)[i]||'').match(/^[-*]?\s*\[([^\]]+)\]\(([^)]+\/concerts\/[^)]*)\)/i);if(!tm)continue;
    const title=tm[1].trim();let date=null,venue='',city='';
    for(let j=i+1;j<Math.min(lines.length,i+8);j++){
      const d=parseSongkickDate(lines[j]);if(d)date=d;
      const vm=lines[j].match(/^[-*]?\s*(?:\[([^\]]+)\]\([^)]*\/venues\/[^)]*\)|([^,]+))\s*,\s*([^,]+)\s*,\s*France$/i);
      if(vm){venue=(vm[1]||vm[2]||'').trim();city=(vm[3]||'').trim();}
      if(date&&venue&&city)break;
    }
    if(date&&venue) add(date,title,venue,city||metro.name.split(' / ')[0]);
  }
  return rows;
}

async function fetchSongkickMetro(metro){
  const urls=[`https://www.songkick.com/fr/metro-areas/${metro.slug}/2026/genre/metal`,`https://songkick.com/metro-areas/${metro.slug}/2026/genre/metal`];
  for(const url of urls){
    try{
      const text=await fetchDiscoveryProxy(url,18000);
      let rows=parseSongkickMetalText(text,metro);
      if(!rows.length)rows=parseSongkickMetalHtml(text,metro);
      if(rows.length)return {metro,rows,transport:'jina'};
    }catch{}
    try{
      const html=await fetchText(url,{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 STAYLOUD/1.0'}},12000);
      const rows=parseSongkickMetalHtml(html,metro);
      if(rows.length)return {metro,rows,transport:'direct'};
    }catch{}
  }
  return {metro,rows:[]};
}
async function discoverSongkickMetal(lat,lon,radiusKm){
  const ranked=SONGKICK_METAL_METROS.map(m=>({...m,distance:distanceKm(lat,lon,m.lat,m.lon)})).sort((a,b)=>a.distance-b.distance);
  // Always keep the nearest metro; add a second nearby metro when the user radius reaches it.
  const selected=ranked.filter(m=>m.distance<=Math.max(radiusKm+120,180)).slice(0,3);
  const results=await Promise.all(selected.map(fetchSongkickMetro));
  const all=[];
  for(const r of results){for(const row of r.rows){
    if(row.date && row.date < new Date().toISOString().slice(0,10))continue;
    row._place={coordinates:{latitude:r.metro.lat,longitude:r.metro.lon},area:{name:row.city}};
    // Metro coordinates are a fast first-pass; known outlying cities are geocoded below.
    all.push(row);
  }}
  const cities=[...new Set(all.map(x=>norm(x.city)).filter(Boolean))];
  const cityCoords=new Map();
  for(const city of cities){
    const direct=REGIONAL_CITY_COORDS[Object.keys(REGIONAL_CITY_COORDS).find(k=>norm(k)===city)];
    if(direct)cityCoords.set(city,{lat:direct[0],lon:direct[1]});
    else {const g=await geocodeCity(city,'France');if(g)cityCoords.set(city,g)}
  }
  for(const row of all){const p=cityCoords.get(norm(row.city));if(p)row._place={coordinates:{latitude:p.lat,longitude:p.lon}};}
  const filtered=await withDistance(all,lat,lon,radiusKm);
  const unique=new Map(); for(const x of filtered){const k=`${x.date}|${norm(x.city)}|${norm(x.venue)}|${norm(x.title)}`;if(!unique.has(k))unique.set(k,x)}
  return [...unique.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
}

async function discoverConcertsMetal(lat,lon,radiusKm,targetCityOverride=''){
  // Manual searches are authoritative: when the user typed a city, never
  // infer the search city again from the browser/GPS coordinates.
  const targetCity=String(targetCityOverride||'').trim();
  const resolvedPlace=targetCity?{city:targetCity,lat,lon}:await reverseCity(lat,lon);
  const effectiveCity=String(resolvedPlace?.city||targetCity||'').trim();
  const all=[];
  // 1) Bandsintown city Metal agenda: broad coverage and a public city/genre page.
  if(effectiveCity){try{all.push(...await discoverBandsintownMetal(effectiveCity,lat,lon,radiusKm));}catch{}}

  // 2) Songkick city/metro Metal agenda: second independent nationwide source.
  try{all.push(...await discoverSongkickMetal(lat,lon,radiusKm));}catch{}

  // 3) Specialist Concerts-Metal regional feed: keep it because it is especially
  // rich for local French metal shows. Force the region containing the target city.
  const ranked=METAL_DISCOVERY_SOURCES.map(s=>({...s,distance:distanceKm(lat,lon,s.lat,s.lon)})).sort((a,b)=>a.distance-b.distance);
  const sourceLimit=radiusKm<=20?2:3;
  const selected=ranked.slice(0,sourceLimit);
  const paris=METAL_DISCOVERY_SOURCES.find(s=>s.slug==='paris');
  const nearParis=distanceKm(lat,lon,48.8566,2.3522)<=Math.max(radiusKm+60,80);
  if(nearParis&&paris&&!selected.some(s=>s.slug==='paris'))selected[selected.length-1]=paris;
  const uniqueSelected=[...new Map(selected.map(s=>[s.slug,s])).values()];
  try{
    const results=await Promise.all(uniqueSelected.map(fetchMetalRegionalSource));
    for(const rr of results){for(const row of rr.rows){
      if(!row?.date)continue;
      if(new Date(String(row.date).slice(0,10))<new Date(new Date().toISOString().slice(0,10)))continue;
      if(!eventHasMetal(row))continue;
      all.push({...row,sourceRegion:rr.source.name,sourceUrl:`https://${rr.source.slug}.concerts-metal.com/`});
    }}
  }catch{}

  const dated=all.filter(x=>x?.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const filtered=await withDistance(dated,lat,lon,radiusKm);
  const unique=new Map();
  for(const x of filtered){
    const k=`${String(x.date).slice(0,10)}|${norm(x.city)}|${norm(x.venue)}|${norm(x.title)}`;
    if(!unique.has(k))unique.set(k,x);
  }
  let final=[...unique.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
  if(final.length)return {concerts:final.filter(x=>!x.isFestival),festivals:final.filter(x=>x.isFestival)};
  const nearNantes=distanceKm(lat,lon,47.2184,-1.5536)<=150;
  const fallback=nearNantes?await curatedConcertFallback(lat,lon,radiusKm):[];
  return {concerts:fallback,festivals:[]};
}

async function googleLocalFestivalDiscovery(place){const queries=[`festival metal ${place.city||''} ${place.state||''}`,`concert metal festival ${place.city||''} ${place.state||''}`];const found=new Map();for(const q of queries){try{const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`,{},15000);const d=new XMLParser({ignoreAttributes:false}).parse(xml);let items=d?.rss?.channel?.item||[];if(!Array.isArray(items))items=[items];for(const x of items.slice(0,20)){const title=String(x.title||'').trim(),url=String(x.link||'').trim(),desc=stripHtml(x.description||'');const hay=`${title} ${desc}`.toLowerCase();if(!title||!url||!/festival|concert|live|metal/i.test(hay))continue;const key=title.toLowerCase();if(found.has(key))continue;const gp=await geocodeQuery(`${title} ${desc}`);if(!gp)continue;const dkm=distanceKm(latOr(place),lonOr(place),gp.lat,gp.lon);if(dkm>100)continue;const metalDetected=FESTIVAL_METAL_TAGS.some(t=>hay.includes(t));if(!metalDetected)continue;found.set(key,{id:`google-local-${Buffer.from(url).toString('base64url').slice(0,24)}`,title,date:parseRssDate(x.pubDate),venue:'',city:gp.display_name?.split(',')[0]||'',country:'France',url,provider:'google-news-local',metalDetected:true,distanceKm:Math.round(dkm*10)/10});}}catch{}}return [...found.values()]}
function latOr(p){return Number(p?.lat)||0} function lonOr(p){return Number(p?.lon)||0}
function parseRssDate(v){const d=new Date(String(v||''));return Number.isNaN(d.getTime())?null:d.toISOString()}

async function curatedFestivalFallback(lat,lon,radiusKm){const seeds=[{title:'Muscadeath XXIV',date:'2026-09-18',venue:'Le Champilambart',city:'Vallet',country:'France',url:'https://www.muscadeath.fr/',metalDetected:true,lat:47.1627,lon:-1.2667,provider:'Muscadeath officiel'},{title:'Kordevez Festival 2026',date:'2026-09-18',venue:'Hippodrome de la Loire',city:'Cordemais',country:'France',url:'https://nantes.concerts-metal.com/',metalDetected:true,lat:47.2917,lon:-1.8783,provider:'Concerts-Metal Nantes'},{title:'Westill 2026',date:'2026-10-30',venue:'Le Champilambart',city:'Vallet',country:'France',url:'https://nantes.concerts-metal.com/',metalDetected:true,lat:47.1627,lon:-1.2667,provider:'Concerts-Metal Nantes'},{title:'Mauges Pit Fest V',date:'2026-10-02',venue:'Salle Thomas Dupouet',city:'Saint-Macaire-en-Mauges',country:'France',url:'https://nantes.concerts-metal.com/',metalDetected:true,lat:47.1233,lon:-0.994,provider:'Concerts-Metal Nantes'}];const out=[];for(const f of seeds){const d=distanceKm(lat,lon,f.lat,f.lon);if(d<=radiusKm)out.push({id:`curated-${norm(f.title)}`,title:f.title,date:f.date,venue:f.venue,city:f.city,country:f.country,url:f.url,provider:f.provider,metalDetected:true,distanceKm:Math.round(d*10)/10})}return out}

async function resolveTargetCoordinates(lat,lon,placeOverride){
  const typedCity=String(placeOverride?.city||placeOverride?.targetCity||'').trim();
  // Manual search: the browser GPS is irrelevant. If the client already
  // resolved the typed city, keep those exact coordinates and never geocode
  // the city a second time (a second fuzzy lookup was the source of the
  // Versailles -> Cugand leakage). Otherwise resolve the city strictly.
  if(typedCity){
    const suppliedLat=Number(placeOverride?.targetLat ?? placeOverride?.lat);
    const suppliedLon=Number(placeOverride?.targetLon ?? placeOverride?.lon);
    if(Number.isFinite(suppliedLat)&&Number.isFinite(suppliedLon)&&placeOverride?.resolvedCityVerified){
      const place={...placeOverride,city:typedCity,lat:suppliedLat,lon:suppliedLon,country:placeOverride?.country||'France',manualTarget:true};
      return {lat:suppliedLat,lon:suppliedLon,place};
    }
    const g=await geocodeQuery(typedCity);
    if(!g||!Number.isFinite(g.lat)||!Number.isFinite(g.lon)) throw new Error(`Ville introuvable : ${typedCity}`);
    const place={...placeOverride,city:typedCity,lat:g.lat,lon:g.lon,country:g.country||'France',resolvedCityVerified:true};
    return {lat:g.lat,lon:g.lon,place};
  }
  let targetLat=Number(lat), targetLon=Number(lon);
  const place=placeOverride?{...await reverseCity(lat,lon),...placeOverride,lat:targetLat,lon:targetLon}:await reverseCity(lat,lon);
  return {lat:targetLat,lon:targetLon,place};
}

export async function discoverNearbyFestivals(lat,lon,radiusKm=50,placeOverride=null){
  const resolved=await resolveTargetCoordinates(lat,lon,placeOverride);lat=resolved.lat;lon=resolved.lon;const place=resolved.place;const all=[];
  try{const cm=await discoverConcertsMetal(lat,lon,radiusKm,place?.city||'');all.push(...cm.festivals)}catch{}
  if(!all.length){const curated=await curatedFestivalFallback(lat,lon,radiusKm);all.push(...curated)}
  const dedup=new Map(all.map(x=>[norm(x.title),x]));
  const today=new Date().toISOString().slice(0,10);
  let items=[...dedup.values()]
    .filter(x=>!x.date || String(x.date).slice(0,10)>=today)
    .sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10))||a.distanceKm-b.distanceKm);
  if(!items.length){try{const local=await googleLocalFestivalDiscovery(place);items=local.filter(x=>x.distanceKm<=radiusKm&&(!x.date||String(x.date).slice(0,10)>=today)).sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10)))}catch{}}
  return {place,radiusKm,items};
}

export async function discoverNearbyConcerts(lat,lon,radiusKm=50,placeOverride=null){
  const resolved=await resolveTargetCoordinates(lat,lon,placeOverride);lat=resolved.lat;lon=resolved.lon;const place=resolved.place;let items=[];
  const manualTarget=Boolean(placeOverride?.manualTarget);
  try{const cm=await discoverConcertsMetal(lat,lon,radiusKm,place?.city||'');items=cm.concerts}catch{}
  // A manual city search must NEVER fall back to the browser/current-location
  // or to the historical Nantes/Cugand curated data. If the city-targeted
  // sources fail, return an empty result rather than showing concerts from
  // another place.
  if(manualTarget){
    const today=new Date().toISOString().slice(0,10);
    items=items.filter(x=>!x.date || String(x.date).slice(0,10)>=today)
      .sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
    return {place,radiusKm,items};
  }
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
