import {fetchJson,fetchText,sleep,eventKey} from "../utils.js";
import {XMLParser} from "fast-xml-parser";
import {getArtists,putEvent,geoCacheGet,geoCacheSet} from "../db.js";
import {d1LoadGeoCache,d1PutGeoBatch,d1GetBandCache,d1PutBandEvents} from "../d1.js";
import {mb} from "./musicbrainz.js";
import {recordSource} from "../health.js";
import {ticketmasterNearby} from "./tickets.js";
import {cachedJson} from "../apicache.js";

// In-memory map backed by the persistent geo_cache table (see db.js).
const geoMem=new Map();
const geoCache={
  has(k){if(geoMem.has(k))return true;try{const v=geoCacheGet(k);if(v!==undefined){geoMem.set(k,v);return true}}catch{}return false},
  get(k){return this.has(k)?geoMem.get(k):undefined},
  // Misses stay in memory only: they may come from a network error.
  set(k,v){geoMem.set(k,v);if(v!=null){try{geoCacheSet(k,v)}catch{}geoD1Queue.set(k,v);scheduleGeoFlush()}return this}
};
// Located venues/cities are also copied to D1 (Render's disk is wiped on
// restart): loaded once at startup, written in small batches.
const geoD1Queue=new Map();let geoFlushTimer=null;
function scheduleGeoFlush(){if(geoFlushTimer)return;geoFlushTimer=setTimeout(async()=>{geoFlushTimer=null;const batch=[...geoD1Queue.entries()].slice(0,200);for(const [k] of batch)geoD1Queue.delete(k);try{await d1PutGeoBatch(batch)}catch(e){console.error('Geo cache D1:',e?.message||e)}if(geoD1Queue.size)scheduleGeoFlush()},5000);geoFlushTimer.unref?.()}
export async function warmGeoCache(){try{const rows=await d1LoadGeoCache();let n=0;for(const r of rows){if(!geoMem.has(r.key)){try{const v=JSON.parse(r.value);if(v!=null){geoMem.set(r.key,v);try{geoCacheSet(r.key,v)}catch{}n++}}catch{}}}return n}catch(e){console.error('Geo cache warm:',e?.message||e);return 0}}
let geoLast=0;
const MB_BASE="https://musicbrainz.org/ws/2";
// MusicBrainz goes through the shared queue + cache of musicbrainz.js.

const STYLE_TAGS={"Metalcore":["metalcore"],"Deathcore":["deathcore"],"Hardcore":["hardcore"],"Nu Metal":["nu metal","nu-metal"],"Death Metal":["death metal","death-metal"],"Black Metal":["black metal","black-metal"],"Thrash Metal":["thrash metal","thrash-metal"],"Alternative":["alternative metal","alternative-metal","alternative rock"],"Post-Hardcore":["post-hardcore"],"Progressif":["progressive metal","progressive rock"],"Punk":["punk","punk rock","pop punk","skate punk","street punk"],"Grunge":["grunge","post-grunge"],"Rock":["rock","hard rock","alternative rock","stoner rock","rock and roll"],"Hard Rock":["hard rock"],"Metal":["metal"]};
const FESTIVAL_METAL_TAGS=["metal","metalcore","deathcore","hardcore","death metal","black metal","thrash metal","nu metal","progressive metal","alternative metal","post-hardcore","hard rock","doom","stoner","djent","grind","heavy metal","crossover","industrial metal","groove metal","technical death metal","punk hardcore"];
const BROAD_METAL_TERMS=[...FESTIVAL_METAL_TAGS,"punk","post-metal","mathcore","metallic hardcore","electronicore","folk metal","power metal","speed metal","sludge","gothic metal","symphonic metal","avant-garde metal"];

const REGIONAL_CITY_COORDS={
  Nantes:[47.2184,-1.5536],Vallet:[47.1627,-1.2667],Clisson:[47.0875,-1.2826],Cugand:[47.0638,-1.2517],Montaigu:[46.9744,-1.3116],"Montaigu-Vendée":[46.9744,-1.3116],Rezé:[47.1911,-1.5441],Carquefou:[47.2979,-1.4937],"Saint-Herblain":[47.226,-1.6484],"Le Bignon":[47.0997,-1.4924],Pontchâteau:[47.4367,-2.0911],Angers:[47.4784,-0.5632],"La Roche-sur-Yon":[46.6705,-1.426],Savenay:[47.3606,-1.942],"Saint-Macaire-en-Mauges":[47.1233,-0.994],"Saint-Hilaire-de-Riez":[46.7211,-1.9465],"Saint-Nazaire":[47.2738,-2.2137],Cholet:[47.0594,-0.878],Cordemais:[47.2917,-1.8783],"Le Bignon":[47.0997,-1.4924],"Chemillé-en-Anjou":[47.2142,-0.7268],"Saint-Prouant":[46.771,-0.967],"Saint-Macaire-en-Mauges":[47.1233,-0.994],"Saint-Sébastien-sur-Loire":[47.207,-1.503],"Saint-Julien-de-Concelles":[47.253,-1.385],
  // Main French cities (instant, no geocoding needed).
  Paris:[48.8566,2.3522],Lyon:[45.764,4.8357],Marseille:[43.2965,5.3698],Lille:[50.6292,3.0573],Bordeaux:[44.8378,-0.5792],Toulouse:[43.6047,1.4442],
  Rennes:[48.1173,-1.6778],Strasbourg:[48.5734,7.7521],Montpellier:[43.6108,3.8767],Nice:[43.7102,7.262],Rouen:[49.4432,1.0999],Grenoble:[45.1885,5.7245],
  Dijon:[47.322,5.0415],Reims:[49.2583,4.0317],"Le Havre":[49.4944,0.1079],"Saint-Étienne":[45.4397,4.3872],Toulon:[43.1242,5.928],"Clermont-Ferrand":[45.7772,3.087],
  Brest:[48.3904,-4.4861],Tours:[47.3941,0.6848],Limoges:[45.8336,1.2611],Amiens:[49.8941,2.2958],Metz:[49.1193,6.1757],Nancy:[48.6921,6.1844],Besançon:[47.2378,6.0241],
  Orléans:[47.9029,1.9093],Caen:[49.1829,-0.3707],Poitiers:[46.5802,0.3404],Perpignan:[42.6887,2.8948],Nîmes:[43.8367,4.3601],"Aix-en-Provence":[43.5297,5.4474],
  Avignon:[43.9493,4.8055],Pau:[43.2951,-0.3708],Bayonne:[43.4929,-1.4748],"Le Mans":[48.0061,0.1996],"Saint-Nazaire":[47.2735,-2.2138],Lorient:[47.748,-3.3702],Vannes:[47.6582,-2.7608],
  Quimper:[47.996,-4.0969],"La Rochelle":[46.1603,-1.1511],Niort:[46.3237,-0.4588],Mulhouse:[47.7508,7.3359],Colmar:[48.0794,7.3585],Troyes:[48.2973,4.0744],Valence:[44.9334,4.8924],
  Annecy:[45.8992,6.1294],Chambéry:[45.5646,5.9178],"Saint-Brieuc":[48.5136,-2.7603],Laval:[48.0707,-0.7734],Cherbourg:[49.6339,-1.6222],Dunkerque:[51.0344,2.3768],
  Montreuil:[48.8638,2.4485],"Saint-Denis":[48.9362,2.3574],"Boulogne-Billancourt":[48.8397,2.2399],Nanterre:[48.8924,2.2071],Versailles:[48.8049,2.1204],"Saint-Ouen":[48.9119,2.3338],
  "Saint-Ouen-sur-Seine":[48.9119,2.3338],Pantin:[48.8944,2.4092],Bobigny:[48.9077,2.4396],"Issy-les-Moulineaux":[48.8245,2.2734],Argenteuil:[48.9472,2.2467],Créteil:[48.7904,2.4556],
  "Saint-Germain-en-Laye":[48.8989,2.0938],"Cergy":[49.0364,2.0761],Évry:[48.6247,2.4413],Massy:[48.7309,2.2713],"Bagnolet":[48.8695,2.4183],"Vincennes":[48.8475,2.4392],
  "Ris-Orangis":[48.6533,2.4167],"Savigny-le-Temple":[48.5743,2.5827],"Clermont":[49.3792,2.4128],Beauvais:[49.4295,2.0807],Évreux:[49.0241,1.1508]
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
function inferStyle(tags){const t=tags.join(' ');const rules=[['Deathcore',/deathcore/],['Metalcore',/metalcore/],['Post-Hardcore',/post-hardcore/],['Hardcore',/hardcore/],['Nu Metal',/nu metal|nu-metal/],['Death Metal',/death metal/],['Black Metal',/black metal/],['Thrash Metal',/thrash metal/],['Progressif',/progressive metal|progressive rock/],['Alternative',/alternative metal/],['Metal',/metal/],['Grunge',/grunge/],['Punk',/punk/],['Alternative',/alternative rock/],['Rock',/rock/]];return rules.find(([,re])=>re.test(t))?.[0]||null}

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
// City names scraped through r.jina.ai can carry Markdown and extras:
// "**Paris**", "[Paris](https://…)", "Paris 11e", "Paris (75)", "Montreuil 93100".
function cleanPlaceName(value){
  let v=String(value||'');
  v=v.replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/gi,' ').replace(/[*_\[\]]+/g,' ');
  v=v.replace(/\(\s*\d{2,5}\s*\)/g,' ').replace(/\b\d{5}\b/g,' ').replace(/\s+-\s+france$/i,'').replace(/,\s*france$/i,'');
  v=v.replace(/^(paris|lyon|marseille)\s+(?:\d{1,2}|[ivxl]{1,5})\s*(?:e|er|eme|ème|è)?\b.*$/i,'$1');
  return v.replace(/\s{2,}/g,' ').replace(/^[\s,.;:|-]+|[\s,.;:|-]+$/g,'').trim();
}
function knownCityCoords(name){const n=norm(name);const k=Object.keys(REGIONAL_CITY_COORDS).find(x=>norm(x)===n);return k?{lat:REGIONAL_CITY_COORDS[k][0],lon:REGIONAL_CITY_COORDS[k][1]}:null}
async function geocodeCity(city,country=''){
  const c=cleanPlaceName(city);if(!c)return null;
  const direct=knownCityCoords(c);if(direct)return direct;
  const key=norm(`${c}|${country}`);if(geoCache.has(key))return geoCache.get(key);
  const fr=!country||/^(fr|france)$/i.test(String(country).trim());
  // French communes: the national geocoder first (fast, generous limits), then
  // Nominatim. A failed request is NOT remembered as "unknown city", so a
  // temporary refusal (429/403) cannot hide a city for the rest of the day.
  let failed=false;
  if(fr){try{const d=await fetchJson(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(c)}&type=municipality&limit=5`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},10000);const f=(d?.features||[]).find(x=>strictCityMatch(x,c));if(f){const [lon,lat]=f.geometry.coordinates;const out={lat:Number(lat),lon:Number(lon)};if(Number.isFinite(out.lat)&&Number.isFinite(out.lon)){geoCache.set(key,out);return out}}}catch{failed=true}}
  const wait=Math.max(0,1050-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();
  try{const q=encodeURIComponent([c,country].filter(Boolean).join(', '));const d=await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);const hit=d?.[0];const out=hit?{lat:Number(hit.lat),lon:Number(hit.lon)}:null;if(out||!failed)geoCache.set(key,out);return out}catch{return null}
}
function distanceKm(lat1,lon1,lat2,lon2){const toRad=v=>v*Math.PI/180,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}

async function withDistance(rows,lat,lon,radiusKm,diag=null){
  const coordsOf=row=>{const p=row._place||{};return {lat:Number(p.coordinates?.latitude),lon:Number(p.coordinates?.longitude)}};
  const cityOf=row=>row.city||row._place?.area?.name||'';
  // Locate each missing city once, within a time budget (see VENUE_BUDGET_MS);
  // unfinished lookups keep running in the background to fill the cache.
  const missing=new Map(),freq=new Map();
  for(const row of rows){const c=coordsOf(row);if(!Number.isFinite(c.lat)||!Number.isFinite(c.lon)){const city=cityOf(row);if(city){const k=norm(`${city}|${row.country||''}`);missing.set(k,[city,row.country||'']);freq.set(k,(freq.get(k)||0)+1)}}}
  // Most frequent cities first (e.g. Paris for an Ile-de-France agenda), so
  // the time budget is spent where most concerts are.
  const ordered=new Map([...missing.entries()].sort((a,b)=>(freq.get(b[0])||0)-(freq.get(a[0])||0)));
  const found=new Map();
  if(missing.size){
    const run=(async()=>{for(const [k,[city,country]] of ordered){const g=await geocodeCity(city,country);if(g)found.set(k,g)}})().catch(()=>{});
    await withinBudget(run);
  }
  const out=[];
  for(const row of rows){
    let {lat:elat,lon:elon}=coordsOf(row);
    if(!Number.isFinite(elat)||!Number.isFinite(elon)){const g=found.get(norm(`${cityOf(row)}|${row.country||''}`));if(g){elat=g.lat;elon=g.lon}}
    if(Number.isFinite(elat)&&Number.isFinite(elon)){const d=distanceKm(lat,lon,elat,elon);if(d<=radiusKm)out.push({...row,distanceKm:Math.round(d*10)/10})}
    else if(diag){diag.unlocated=(diag.unlocated||0)+1;const c=String(cityOf(row)||'?').slice(0,30);diag.samples=diag.samples||[];if(diag.samples.length<3&&!diag.samples.includes(c))diag.samples.push(c)}
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
  France:[['Landmvrks','Metalcore'],['Rise Of The Northstar','Hardcore'],['Alcest','Black Metal'],['Hypno5e','Progressif'],['Klone','Progressif'],['Novelists','Metalcore'],['Betraying The Martyrs','Deathcore'],['Ultra Vomit','Metal'],['Mass Hysteria','Metal'],['Dagoba','Metal'],['Benighted','Death Metal'],['Svart Crown','Black Metal'],['Regarde Les Hommes Tomber','Black Metal'],['Igorrr','Metal'],['Loudblast','Death Metal'],['Tagada Jones','Hardcore'],['Smash Hit Combo','Nu Metal'],['Gojira','Death Metal']],
  Punk:[['The Offspring','Punk'],['Bad Religion','Punk'],['Rancid','Punk'],['NOFX','Punk'],['Pennywise','Punk'],['Bérurier Noir','Punk'],['Les Sheriff','Punk'],['Ramones','Punk']],
  Grunge:[['Nirvana','Grunge'],['Soundgarden','Grunge'],['Alice In Chains','Grunge'],['Pearl Jam','Grunge'],['Mudhoney','Grunge'],['Screaming Trees','Grunge']],
  Rock:[['Foo Fighters','Rock'],['Queens Of The Stone Age','Rock'],['AC/DC','Rock'],['Royal Blood','Rock'],['Black Stone Cherry','Rock'],['Shaka Ponk','Rock'],['Highly Suspect','Rock']],
  'Post-Hardcore':[['Holding Absence','Post-Hardcore'],['Static Dress','Post-Hardcore'],['Thornhill','Post-Hardcore']],
  Progressif:[['Periphery','Progressif'],['TesseracT','Progressif'],['ERRA','Progressif']]
};
export {discoverManualCityConcerts,splitBandsFromGenres,dedupeAcrossSources,parseSongkickMetalText,parseSueurDeMetalText};
// Concerts of the user's own bands (from "Mes groupes") that fall inside the
// searched radius are added to the city / near-me lists. When the same show is
// already listed (same date and venue), the band is added to its title instead
// of creating a second card ("Thrown" → "Counterparts + Thrown").
export async function mergeFollowedConcerts(items,followed,lat,lon,radiusKm){
  const list=[...(items||[])];if(!followed?.length)return list;
  const venueKey=v=>norm(cleanPlaceName(v)).replace(/^(le|la|les|l)\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();
  const today=new Date().toISOString().slice(0,10);
  const rows=followed.filter(e=>e?.date&&String(e.date).slice(0,10)>=today&&(e.city||e.venue)).map(e=>({...e,city:cleanPlaceName(e.city||''),country:e.country||'France'}));
  const near=await withDistance(rows,lat,lon,radiusKm);
  const seen=new Set();
  for(const f of near){
    const artist=String(f.artist||'').trim();const day=String(f.date).slice(0,10);const k=`${norm(artist)}|${day}`;if(seen.has(k))continue;seen.add(k);
    const same=list.find(x=>String(x.date).slice(0,10)===day&&((f.venue&&x.venue&&venueKey(x.venue)===venueKey(f.venue))||(!f.venue&&norm(x.city)===norm(f.city))));
    if(same){if(artist&&!norm(same.title).includes(norm(artist)))same.title=`${artist} + ${same.title}`;continue}
    if(list.some(x=>String(x.date).slice(0,10)===day&&artist&&norm(x.title).includes(norm(artist))))continue;
    list.push({id:`mine-${f.id||k}`,title:f.title&&norm(f.title).includes(norm(artist))?f.title:(artist||f.title),artist,date:f.date,time:f.time||null,venue:f.venue||'',city:f.city||'',country:'France',url:f.url||'',provider:f.provider||'Mes groupes',distanceKm:f.distanceKm});
  }
  return list.sort((a,b)=>String(a.date||'').slice(0,10).localeCompare(String(b.date||'').slice(0,10))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
}
// Concerts members reported ("Signaler un concert") and the admin approved:
// added to the lists inside the radius (no radius when lat/lon are not
// numbers: city-only list), unless the same show is already listed.
// Rows (with a city) within radiusKm of lat/lon, with their distance (alerts).
export function rowsNear(rows,lat,lon,radiusKm){return withDistance(rows,lat,lon,radiusKm)}
export function mergeCommunityConcerts(items,rows,lat,lon,radiusKm){
  const list=[...(items||[])];if(!rows?.length)return list;
  const venueKey=v=>norm(cleanPlaceName(v)).replace(/^(le|la|les|l)\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();
  const geo=Number.isFinite(lat)&&Number.isFinite(lon);
  for(const c of rows){
    const day=String(c.date).slice(0,10);let dist=null;
    if(geo){if(!Number.isFinite(Number(c.lat))||!Number.isFinite(Number(c.lon)))continue;dist=distanceKm(lat,lon,Number(c.lat),Number(c.lon));if(dist>radiusKm)continue}
    const bands=String(c.bands||'').split(/\s*[,+\/]\s*|\s+-\s+/).map(x=>x.trim()).filter(Boolean);
    const title=String(c.title||'').trim()||bands.join(' + ');
    const dup=list.some(x=>String(x.date||'').slice(0,10)===day&&((c.venue&&x.venue&&venueKey(x.venue)===venueKey(c.venue))||bands.some(b=>norm(x.title).includes(norm(b)))||norm(x.title)===norm(title)));
    if(dup)continue;
    const fullTitle=bands.length&&!bands.every(b=>norm(title).includes(norm(b)))?`${title} : ${bands.join(' + ')}`:title;
    list.push({id:`community-${c.id}`,title:fullTitle,artist:bands[0]||'',date:day,time:c.time||null,venue:c.venue||'',city:c.city||'',country:'France',url:c.url||'',provider:'Signalé par un membre',community:true,...(dist!=null?{distanceKm:Math.round(dist*10)/10}:{})});
  }
  return list.sort((a,b)=>String(a.date||'').slice(0,10).localeCompare(String(b.date||'').slice(0,10))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
}
// A tag counts only when it is one of the artist's main tags on MusicBrainz:
// anyone can add a tag, so "post-hardcore" with 1 vote on Nirvana must not
// make Nirvana a post-hardcore band.
function mainTags(a){
  const tags=(a.tags||[]).map(t=>({name:String(t.name||'').toLowerCase(),count:Number(t.count)||0})).sort((x,y)=>y.count-x.count);
  if(!tags.length)return [];const max=tags[0].count||0;
  return tags.filter((t,i)=>i<3||(max>0&&t.count>=max*0.5)).map(t=>t.name);
}
const ALL_METAL_TAGS=['metal','metalcore','deathcore','hardcore','death metal','black metal','thrash metal','nu metal','progressive metal','alternative metal','post-hardcore','hard rock'];
const discoverCache=new Map();const DISCOVER_TTL=6*60*60*1000;
export async function discoverArtists(style='all',limit=18,page=0){
  const followed=followedNames();
  // "France": French bands of any metal style (MusicBrainz country FR).
  // "France:Metalcore" = French bands of one style (Découvrir › Groupes français).
  const frSub=/^France:/.test(style)&&STYLE_TAGS[style.slice(7)]?style.slice(7):'';
  const french=style==='France'||Boolean(frSub);
  const tags=frSub?STYLE_TAGS[frSub]:style==='all'?ALL_METAL_TAGS:french?[...ALL_METAL_TAGS,'heavy metal','doom metal','post-metal','sludge metal','djent','industrial metal','groove metal','symphonic metal','power metal','progressive metal']:(STYLE_TAGS[style]||['metal']);
  const q=`type:group AND ${french?'country:FR AND ':''}(${tags.map(t=>`tag:"${t}"`).join(' OR ')})`;
  const want=(Number(page)+1)*limit;
  try{
    let c=discoverCache.get(style);if(!c||Date.now()-c.at>DISCOVER_TTL){c={at:Date.now(),rows:[],seen:new Set(),offset:0,done:false};discoverCache.set(style,c)}
    // Fetch MusicBrainz pages (100 artists each) until this page is full.
    // A failed MusicBrainz call keeps what was already found (and "Suivant"
    // stays available to retry) instead of falling back to the short list.
    let calls=0;
    while(!c.done&&c.rows.length<want+1&&calls<4){
      calls++;
      let d;try{d=await mb(`${MB_BASE}/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=100&offset=${c.offset}`)}catch(e){if(c.rows.length)break;throw e}
      const list=d.artists||[];c.offset+=100;if(list.length<100||c.offset>=Number(d.count||0))c.done=true;
      for(const raw of list){
        const main=mainTags(raw);
        const broad=style==='all'||style==='Metal'||(french&&!frSub);if(!main.some(t=>tags.includes(t)||(broad&&/\bmetal\b/.test(t))))continue;
        // Rock is the wide family: only bands whose first tag is rock (Nirvana stays in Grunge).
        if((style==='Rock'||frSub==='Rock')&&!tags.includes(main[0]))continue;
        const a=cleanArtist(raw);a.style=frSub||((style==='all'||french)?(inferStyle(main)||'Metal'):style);if(!a.style)continue;
        const k=norm(a.name);if(c.seen.has(k))continue;c.seen.add(k);c.rows.push(a);
      }
    }
    const visible=c.rows.filter(a=>!followed.has(norm(a.name)));
    const items=visible.slice(page*limit,(page+1)*limit);
    if(!items.length&&page===0)throw new Error('no artists');
    return {items,hasMore:visible.length>(page+1)*limit||!c.done};
  }catch(e){
    if(page>0)return {items:[],hasMore:false};
    const seen=new Set(),out=[];
    const fb=frSub?DISCOVER_FALLBACK.France.filter(([,st])=>st===frSub):(DISCOVER_FALLBACK[style]||DISCOVER_FALLBACK.all);
    for(const [name,st] of fb){
      const k=norm(name);if(seen.has(k)||followed.has(k))continue;seen.add(k);out.push({id:`fallback-${k.replace(/[^a-z0-9]+/g,'-')}`,name,sortname:name,score:0,disambiguation:'Suggestion métal',style:st,mbid:''});if(out.length>=limit)break;
    }
    if(out.length)return {items:out,hasMore:false,fallback:true};
    throw e;
  }
}

function stripHtml(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#x27;/gi,"'").replace(/\s+/g,' ').trim()}
function parseCmDate(s){const m=String(s||'').match(/(20\d{2}-\d{2}-\d{2})/);return m?m[1]:null}
function isMetalText(s){const h=norm(s);return BROAD_METAL_TERMS.some(t=>h.includes(norm(t)))}
function isFestival(title,header,details){const h=norm(`${title} ${header} ${details}`);return /\bfestival\b|\bfest\b|hellfest|muscadeath|westill|kordevez|ragefest|in your face|tattoo fest/.test(h)}
// Concerts-Metal pages read through the relay list each band followed by its
// styles ("Kanine Deathcore NDKH Metal / Djent Parjure Beatdown Hardcore").
// A run of style words is dropped only when it contains a style "head"
// (metal, *core, doom…), so names like "Black Bomb A" or "Death Council" stay.
const GENRE_MODS=new Set('death black thrash heavy doom power speed folk viking pagan symphonic gothic goth melodic melo progressive prog post atmospheric atmo technical tech brutal blackened industrial indus nu alternative alt groove sludge stoner epic avant-garde experimental crossover hard beatdown metallic crust grind noise dark depressive raw old-school modern instrumental extreme war funeral cyber electro celtic medieval neo neoclassical classic traditional trad fusion southern psychedelic psyche space drone atmospherique melodique symphonique progressif'.split(' '));
const GENRE_HEAD=/^(?:metal|rock|punk|djent|doom|grind|grindcore|sludge|stoner|crust|thrash|hardcore|deathcore|metalcore|mathcore|post-rock|post-metal|black-metal|death-metal|[a-z]+core|n'roll|rock'n'roll)$/i;
const GENRE_SEP=/^(?:\/|-|&|,|\+|'n'|n'|and|et)$/i;
function splitBandsFromGenres(title){
  const t=String(title||'').replace(/\s+/g,' ').trim();
  if(!t||/\s\+\s/.test(t))return t;
  const toks=t.replace(/\s*\/\s*/g,' / ').split(' ');
  const isG=w=>{const x=norm(w).replace(/[(),.]/g,'');return GENRE_HEAD.test(x)||GENRE_MODS.has(x)||GENRE_SEP.test(x)};
  const isHead=w=>GENRE_HEAD.test(norm(w).replace(/[(),.]/g,''));
  const chunks=[];let cur=[];
  for(let i=0;i<toks.length;){
    if(isG(toks[i])){let j=i;while(j<toks.length&&isG(toks[j]))j++;const run=toks.slice(i,j);
      // A style run with a head word, or a trailing one ("… Crossover"), is a style.
      if(run.some(isHead)||(j>=toks.length&&cur.length)){if(cur.length){chunks.push(cur.join(' '));cur=[]}}else cur.push(...run);
      i=j;continue}
    cur.push(toks[i]);i++;
  }
  if(cur.length)chunks.push(cur.join(' '));
  const out=chunks.map(x=>x.replace(/^[\s\/&,+-]+|[\s\/&,+-]+$/g,'').trim()).filter(Boolean);
  return out.length?out.join(' + '):t;
}
// Full band list of a Concerts-Metal entry. Cutting at the first style word
// lost every band after it ("Thrown Metalcore Counterparts …" → "Thrown").
function concertsMetalTitle(details){
  const d=String(details||'').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,' ').replace(/[*_]+/g,' ')
    .replace(/\(([^)]*)\)/g,(m,x)=>isMetalText(x)?' ':m).replace(/\s+/g,' ').trim();
  if(d&&d.length<=220){const t=splitBandsFromGenres(d);if(t&&t!==d||!isMetalText(d))return t;}
  return extractConcertTitle(details)||d.slice(0,160);
}
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
    const city=cleanPlaceName(bits.pop()||''); const venue=cleanPlaceName(bits.join(', ')||location);
    const details=cells.slice(1).join(' ').replace(/\s+/g,' ').trim();
    if(!details||!isMetalText(details))continue;
    const title=concertsMetalTitle(details);
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
    const date=m[1], location=m[2].replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').trim();
    const bits=location.split(',').map(x=>x.trim()).filter(Boolean);
    const city=cleanPlaceName(bits.pop()||''); const venue=cleanPlaceName(bits.join(', ')||location);
    const detailParts=[];
    for(let j=i+1;j<Math.min(lines.length,i+5);j++){
      const next=lines[j].replace(/^\|+|\|+$/g,'').replace(/\s*\|\s*/g,' ').replace(/^[-*]\s*/,'').replace(/\s+/g,' ').trim();
      if(!next||dateLine.test(next)||/^#{1,4}\s/.test(next))break;
      if(/^(Liens|Tickets|Concerts \/ Festivals|Prochains concerts)/i.test(next))continue;
      detailParts.push(next);
    }
    const details=detailParts.join(' ').replace(/\s+/g,' ').trim();
    if(!details||!isMetalText(details))continue;
    const title=concertsMetalTitle(details);
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
  // "strasbourg" is not a Concerts-Metal region (it returned south-west shows).
  // Grand Est: lorraine.concerts-metal.com and the Alsace regional page.
  {slug:'lorraine',name:'Nancy / Metz / Lorraine',lat:48.6921,lon:6.1844},
  {slug:'alsace',url:'https://en.concerts-metal.com/FR-A__Alsace',name:'Strasbourg / Alsace',lat:48.5734,lon:7.7521},
  // Other regions use the site's region letters (old French region codes):
  // FR-A Alsace, FR-C Auvergne, FR-D Bourgogne, FR-G Champagne-Ardenne,
  // FR-S Picardie, FR-T Poitou-Charentes (links checked by the owner), and by
  // the same code list FR-F Centre, FR-H Corse, FR-I Franche-Comté,
  // FR-L Limousin, FR-P Basse-Normandie, FR-Q Haute-Normandie.
  {slug:'auvergne',url:'https://en.concerts-metal.com/FR-C__Auvergne',name:'Clermont-Ferrand / Auvergne',lat:45.7772,lon:3.0870},
  {slug:'bourgogne',url:'https://en.concerts-metal.com/FR-D__Bourgogne',name:'Dijon / Bourgogne',lat:47.3220,lon:5.0415},
  {slug:'champagne',url:'https://en.concerts-metal.com/next_FR-G_p1.html',name:'Reims / Champagne-Ardenne',lat:49.2583,lon:4.0317},
  {slug:'picardie',url:'https://en.concerts-metal.com/next_FR-S_p1.html',name:'Amiens / Picardie',lat:49.8941,lon:2.2958},
  {slug:'poitou',url:'https://en.concerts-metal.com/next_FR-T_p1.html',name:'Poitiers / Poitou-Charentes',lat:46.5802,lon:0.3404},
  {slug:'centre',url:'https://en.concerts-metal.com/next_FR-F_p1.html',name:'Tours / Orléans / Centre',lat:47.5861,lon:1.3359},
  {slug:'corse',url:'https://en.concerts-metal.com/next_FR-H_p1.html',name:'Corse',lat:42.0396,lon:9.0129},
  {slug:'franche-comte',url:'https://en.concerts-metal.com/next_FR-I_p1.html',name:'Besançon / Franche-Comté',lat:47.2378,lon:6.0241},
  {slug:'limousin',url:'https://en.concerts-metal.com/next_FR-L_p1.html',name:'Limoges / Limousin',lat:45.8336,lon:1.2611},
  {slug:'basse-normandie',url:'https://en.concerts-metal.com/next_FR-P_p1.html',name:'Caen / Basse-Normandie',lat:49.1829,lon:-0.3707},
  {slug:'haute-normandie',url:'https://en.concerts-metal.com/next_FR-Q_p1.html',name:'Rouen / Haute-Normandie',lat:49.4432,lon:1.0993},
  {slug:'grenoble',name:'Grenoble / Alpes',lat:45.1885,lon:5.7245}
];

function eventHasMetal(row){
 const hay=norm(`${row?.title||''} ${row?.details||''}`);
 const terms=['metal','metalcore','deathcore','hardcore','death metal','black metal','thrash metal','nu metal','progressive metal','alternative metal','post-hardcore','hard rock','doom','stoner','djent','grind','heavy metal','crossover','industrial metal','groove metal','technical death metal','punk hardcore','post-metal','mathcore','metallic hardcore','electronicore','folk metal','power metal','speed metal','sludge','gothic metal','symphonic metal',
  // Punk / Oi! / grunge / rock shows are listed on the metal agendas too (and are
  // styles of the app): keep them (e.g. Syndrome 81, Oi! punk).
  'punk','oi!',' oi ','street punk','crust','grunge','rock','screamo','emo'];
 return terms.some(t=>hay.includes(t));
}

// Run alternative ways of reading the same page (proxy / direct / URL
// variants) at the same time and keep the first one that yields rows,
// instead of waiting for each one to time out in turn.
// Short, user-readable reason for a failed source fetch (shown in the
// "aucun concert" diagnostic so a blocked or slow source is visible).
function fetchErrorLabel(e){const m=String(e?.message||e||'');if(/abort/i.test(m))return 'délai dépassé';const h=m.match(/HTTP \d{3}/);if(h)return h[0];if(m==='empty')return 'page sans concert';return m.slice(0,40)||'erreur'}
// Source agenda pages (Concerts-Metal region, Songkick metro, Bandsintown
// city) are kept 12 h in memory and in D1 (agendas change slowly, and every
// page read through the relay costs Jina tokens). When a source refuses us (429/403)
// the last good copy is used instead of showing nothing.
const SOURCE_TTL=12*60*60*1000;const sourceMem=new Map();const sourceInflight=new Map();
async function cachedSourceRows(key,fetcher,ttl=SOURCE_TTL){
  const k='src:'+key;let hit=sourceMem.get(k);
  if(!hit){try{const r=(await d1GetBandCache([k])).get(k);if(r?.events_json){hit={rows:JSON.parse(r.events_json)||[],at:Date.parse(r.events_at)||0};sourceMem.set(k,hit)}}catch{}}
  if(hit&&hit.rows.length&&Date.now()-hit.at<ttl)return {...hit.fresh,rows:hit.rows,cached:true};
  if(sourceInflight.has(k))return sourceInflight.get(k);
  const job=(async()=>{
    let res=null,thrown='';try{res=await fetcher()}catch(e){thrown=e?.message||String(e)}
    recordSource(key,Boolean(res?.rows?.length),thrown||res?.error||(Array.isArray(res?.errors)?res.errors.join(' · '):'')||'aucun concert lu').catch(()=>{});
    if(res?.rows?.length){const {rows,...meta}=res;sourceMem.set(k,{rows,at:Date.now(),fresh:meta});d1PutBandEvents(k,rows).catch(()=>{});return res}
    if(hit?.rows?.length)return {...(res||{}),rows:hit.rows,stale:true};
    return res||{rows:[]};
  })().finally(()=>sourceInflight.delete(k));
  sourceInflight.set(k,job);return job;
}
// Attempts alternate relay (r.jina.ai) / direct fetch, which labels the errors.
// When every attempt fails, the answer is {rows:[],errors:[...]}: the reasons
// ("relais HTTP 402", "direct HTTP 403"…) are kept for the source monitoring.
// Attempts come in pairs (relay, direct): the free direct fetches are tried
// first, the relay (paid in Jina tokens) only when they all fail.
async function firstWithRows(attempts,errs=null){
  const log=[];
  const run=list=>Promise.any(list.map(async([f,i])=>{try{const r=await f();if(!r?.rows?.length)throw new Error('empty');return r}catch(e){const m=`${i%2?'direct':'relais'} ${fetchErrorLabel(e)}`;log.push(m);if(errs)errs.push(m);throw e}}));
  const indexed=attempts.map((f,i)=>[f,i]);
  try{return await run(indexed.filter(([,i])=>i%2))}catch{}
  try{return await run(indexed.filter(([,i])=>!(i%2)))}catch{return {rows:[],errors:log}}
}
// Direct page fetches present themselves like a regular browser (Songkick answers
// HTTP 406 to unknown clients).
const BROWSER_HEADERS={Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'};
// Jina bills by the size of the answer: no images, no menus or footers.
const JINA_HEADERS=()=>({...(process.env.JINA_API_KEY?{Authorization:`Bearer ${process.env.JINA_API_KEY}`}:{}),'X-Retain-Images':'none','X-Remove-Selector':'nav, footer, script, style, noscript, iframe'});
// Relay used for the agenda pages that block the server: ScraperAPI when
// SCRAPERAPI_KEY is set (free plan, returns the page HTML), otherwise Jina
// Reader (r.jina.ai, returns Markdown, paid in tokens).
// render:true asks ScraperAPI to run the page's JavaScript (pages that load
// their list afterwards, e.g. Sueur de Metal); it costs more credits.
export function relayRequest(url,{render=false}={}){
  const sk=String(process.env.SCRAPERAPI_KEY||'').trim();
  if(sk){const p=new URLSearchParams({api_key:sk,url,country_code:'fr'});if(process.env.SCRAPERAPI_PREMIUM==='1')p.set('premium','true');if(render)p.set('render','true');
    return {name:'ScraperAPI',target:`https://api.scraperapi.com/?${p}`,headers:{Accept:'text/html'},timeout:60000}}
  return {name:'Jina',target:`https://r.jina.ai/${url}`,headers:{Accept:'text/plain, text/markdown, text/html','User-Agent':'Mozilla/5.0 STAYLOUD/1.0',...JINA_HEADERS()},timeout:0};
}
async function fetchDiscoveryProxy(url,timeout=18000,opts={}){
  const r=relayRequest(url,opts);
  const go=()=>fetchText(r.target,{headers:r.headers},Math.max(timeout,r.timeout));
  // The relay allows a few requests per minute: on "too many requests" wait
  // a moment and try once more. The same page asked twice within 12 h (city
  // searches, several regions sharing a page) is read once.
  return cachedJson(`relay:${r.name}:${opts.render?'js:':''}${url}`,SOURCE_TTL,async()=>{try{return await go()}catch(e){if(!/HTTP 429/.test(String(e?.message)))throw e;await sleep(4000);return go()}},{persist:false});
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
      let near=null;try{near=await geocodeQuery(requested)}catch{}
      const correctedRows=await correctManualEventCities(r.rows,requested,near);
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
    const skUrls=found.songkick.filter(u=>/genre\/metal/i.test(u));
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

// Regional page: a subdomain (nantes.concerts-metal.com) or an explicit URL.
function metalSourceUrl(source){return source.url||`https://${source.slug}.concerts-metal.com/`}
function fetchMetalRegionalSource(source,errs=null){return cachedSourceRows('cm:'+source.slug,()=>fetchMetalRegionalSourceLive(source,errs)).then(r=>({...r,source}))}
async function fetchMetalRegionalSourceLive(source,errs=null){
 const url=metalSourceUrl(source);
 // Render/free hosts can receive a different response from the public site
 // than a normal browser, so the clean proxy and a direct fetch race.
 const r=await firstWithRows([
  async()=>{const text=await fetchDiscoveryProxy(url,15000);let rows=parseConcertsMetalHtml(text,url);if(!rows.length)rows=parseConcertsMetalText(text,url);return {source,rows,error:null,transport:'jina'}},
  async()=>{const html=await fetchText(url,{headers:BROWSER_HEADERS},15000);return {source,rows:parseConcertsMetalHtml(html,url),error:null,transport:'direct'}}
 ],errs);
 return r.rows.length?r:{source,rows:[],errors:r.errors};
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
async function correctManualEventCities(rows,targetCity,near=null){
  const list=Array.isArray(rows)?rows:[];
  const venues=[...new Set(list.map(x=>String(x?.venue||'').trim()).filter(Boolean))].slice(0,80);
  const corrected=new Map();
  const places=await geocodeVenuesWithin(venues,targetCity,near);
  for(const venue of venues)corrected.set(norm(venue),places.get(norm(venue))?.city||'');
  // Bandsintown rows carry the searched city only because the parser assigned
  // it; replace it with the venue's real commune, or leave it blank when the
  // venue could not be located rather than claiming the searched city.
  return list.map(row=>{
    const sourceCity=String(row?.city||'').trim();
    if(sourceCity&&norm(sourceCity)!==norm(targetCity||''))return row;
    return {...row,city:corrected.get(norm(row?.venue||''))||''};
  });
}

function fetchBandsintownCity(city,lat=null,lon=null,errs=null){return cachedSourceRows('bi:'+bandsintownSlug(city),()=>fetchBandsintownCityLive(city,lat,lon,errs))}
async function fetchBandsintownCityLive(city,lat=null,lon=null,errs=null){
  const slug=bandsintownSlug(city); if(!slug)return {rows:[]};
  const suffix=(Number.isFinite(Number(lat))&&Number.isFinite(Number(lon)))?`?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`:'';
  const url=`https://www.bandsintown.com/fr/c/${slug}-france/all-dates/genre/metal${suffix}`;
  const r=await firstWithRows([
    // Bandsintown refuses ScraperAPI's normal mode ("Protected", after ~30 s):
    // skip it there instead of making every search wait.
    async()=>{if(relayRequest(url).name==='ScraperAPI'&&process.env.SCRAPERAPI_PREMIUM!=='1')throw new Error('non tenté (Bandsintown refuse ce relais)');return {rows:parseBandsintownMetalText(await fetchDiscoveryProxy(url,15000),city,url),url,transport:'jina'}},
    async()=>({rows:parseBandsintownMetalText(await fetchText(url,{headers:BROWSER_HEADERS},15000),city,url),url,transport:'direct'})
  ],errs);
  return r.rows.length?r:{rows:[],url,errors:r.errors};
}
// Resolve a concert venue (e.g. "Le Trabendo") to coordinates and its real
// commune. Bandsintown city pages list every show in the surrounding area
// with the venue name only, so the searched city must NOT be used as a hint:
// "Le Trabendo, Versailles" made the address API return a random street in
// Versailles. Nominatim knows venues as named places; we search the venue
// name alone and keep the hit closest to the searched city.
async function nominatimVenue(q,near){
  const wait=Math.max(0,1100-(Date.now()-geoLast));if(wait)await sleep(wait);geoLast=Date.now();
  const d=await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&countrycodes=fr&addressdetails=1&q=${encodeURIComponent(q)}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD-Music-Radar/3.0 (local app)'}},12000);
  const hits=(Array.isArray(d)?d:[]).map(h=>{const a=h.address||{};return {lat:Number(h.lat),lon:Number(h.lon),city:String(a.city||a.town||a.village||a.municipality||'').trim()}}).filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lon));
  if(!hits.length)return null;
  if(near&&Number.isFinite(near.lat)&&Number.isFinite(near.lon))hits.sort((x,y)=>distanceKm(near.lat,near.lon,x.lat,x.lon)-distanceKm(near.lat,near.lon,y.lat,y.lon));
  return hits[0];
}
// Unknown venues cost ~1 s each (Nominatim rate limit). Cached ones are
// instant; only wait VENUE_BUDGET_MS for new ones and let the lookup finish
// in the background so the next search has them.
const VENUE_BUDGET_MS=8000;
// Wait for a lookup loop at most VENUE_BUDGET_MS. If it had to be cut short,
// cached scans are partial: drop them once the loop completes so the next
// search is rebuilt from the now-complete geocoding cache.
async function withinBudget(run){
  let finished=false; run.then(()=>{finished=true});
  await Promise.race([run,sleep(VENUE_BUDGET_MS)]);
  if(!finished)run.then(()=>scanCache.clear());
}
async function geocodeVenuesWithin(venues,targetCity,near){
  const out=new Map();
  const run=(async()=>{for(const venue of venues){const p=await geocodeEventVenue(venue,targetCity,near);if(p)out.set(norm(venue),p)}})().catch(()=>{});
  await withinBudget(run);
  return new Map(out);
}
async function geocodeEventVenue(venue,targetCity,near=null){
  const v=String(venue||'').trim(); if(!v)return null;
  const zone=near&&Number.isFinite(near.lat)&&Number.isFinite(near.lon)?`${near.lat.toFixed(1)},${near.lon.toFixed(1)}`:'';
  const key='venue|'+norm(v)+'|'+zone+'|'+norm(targetCity); if(geoCache.has(key))return geoCache.get(key);
  let out=null;
  try{out=await nominatimVenue(v,near)}catch{}
  // Only when the venue name alone is unknown, try it inside the searched
  // city; Nominatim matches names strictly, so this cannot invent a street.
  if(!out&&targetCity){try{out=await nominatimVenue(`${v}, ${targetCity}`,near)}catch{}}
  if(out&&!out.city){try{const r=await reverseCity(out.lat,out.lon);out.city=String(r?.city||'').trim()}catch{}}
  geoCache.set(key,out); return out;
}
async function discoverBandsintownMetal(city,lat,lon,radiusKm,diag={}){
  const errs=[];const r=await fetchBandsintownCity(city,lat,lon,errs);diag.raw=r.rows.length;diag.errors=errs;if(!r.rows.length)return [];
  const venueFreq=new Map();for(const x of r.rows)if(x.venue)venueFreq.set(x.venue,(venueFreq.get(x.venue)||0)+1);
  const uniqueVenues=[...venueFreq.keys()].sort((a,b)=>venueFreq.get(b)-venueFreq.get(a)).slice(0,80);
  const venueCoords=await geocodeVenuesWithin(uniqueVenues,city,{lat:Number(lat),lon:Number(lon)});
  // Never assume that an event belongs to the requested city when its venue
  // could not be geocoded. That assumption was the exact mechanism that could
  // make a stale/wrong Bandsintown page (for example Cugand) leak into a
  // Versailles search. A venue must have real coordinates before it can pass
  // the target-city radius filter.
  const located=[];
  for(const row of r.rows){const p=venueCoords.get(norm(row.venue)); if(!p)continue; located.push({...row,city:p.city||'',_place:{coordinates:{latitude:p.lat,longitude:p.lon}}});}
  diag.located=located.length;
  const filtered=await withDistance(located,lat,lon,radiusKm);
  return filtered;
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
  const unlink=v=>String(v||'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
  title=unlink(title).replace(/\s+/g,' ').trim(); venue=unlink(venue).replace(/\s+/g,' ').trim(); city=String(city||'').replace(/\s+/g,' ').trim()||metro.name.split(' / ')[0];
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
// Show title above a venue line: the linked show name, not a support act listed
// between them ("Tribulation et Soen" / "Vulkan" / venue).
function skTitleAbove(lines,j){for(let k=j-1;k>=Math.max(0,j-3);k--){const m=String(lines[k]||'').match(/^[-*•]?\s*\[([^\]]+)\]\([^)]*\/concerts\//i);if(m)return m[1].trim()}return j-1>=0?String(lines[j-1]).replace(/^[-*•]\s*/,'').replace(/^\[[^]]+\]\([^)]*\)$/,'').trim():''}
function parseSongkickMetalText(text,metro){
  const src=String(text||''); const rows=[]; const seen=new Set();
  const lines=src.split(/\r?\n/).map(x=>stripHtml(x).replace(/\s+/g,' ').trim()).filter(Boolean);
  const unlink=v=>String(v||'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\]\([^)]*\)/g,'').replace(/^\[/,'').trim();
  const add=(date,title,venue,city)=>{const row=songkickRow(metro,date,unlink(title),unlink(venue),unlink(city));if(!row)return;const key=`${row.date}|${norm(row.title)}|${norm(row.venue)}|${norm(row.city)}`;if(seen.has(key))return;seen.add(key);rows.push(row)};
  // Layout detection: date headings first (date, then its shows) or each show
  // followed by its date. Reading one layout with the other's rule shifts
  // every show onto a neighbouring date.
  const rawLines=src.split(/\r?\n/);
  // The first lines are not enough (a "popular concerts" block can put a show
  // link before the first date heading): vote on every show. Date headings
  // first = a date appears between the previous show and this one.
  const isEv=l=>/^[-*]?\s*\[[^\]]+\]\([^)]+\/concerts\//i.test(l);
  const evIdx=[];for(let i=0;i<rawLines.length;i++)if(isEv(String(rawLines[i]||'')))evIdx.push(i);
  let above=0,below=0;
  for(let k=0;k<evIdx.length;k++){
    const from=k?evIdx[k-1]+1:0,to=k<evIdx.length-1?evIdx[k+1]:lines.length;
    let a=false,b=false;
    for(let j=from;j<evIdx[k];j++)if(parseSongkickDate(lines[j]||'')){a=true;break}
    for(let j=evIdx[k]+1;j<to;j++)if(parseSongkickDate(lines[j]||'')){b=true;break}
    if(a&&!b)above++;else if(b&&!a)below++;
  }
  const firstDateIdx=lines.findIndex(l=>parseSongkickDate(l));
  const firstEventIdx=evIdx.length?evIdx[0]:-1;
  const dateFirst=above||below?above>=below:(firstDateIdx>=0&&firstEventIdx>=0&&firstDateIdx<firstEventIdx);
  // Layout "title / venue, city, France / date".
  if(!dateFirst)for(let i=0;i<lines.length;i++){
    const date=parseSongkickDate(lines[i]); if(!date)continue;
    let venue='',city='',title='';
    for(let j=i-1;j>=Math.max(0,i-3);j--){
      const line=lines[j].replace(/^[-*•]\s*/,'').trim();
      const vm=line.match(/^(?:\[)?(.+?)(?:\])?\s*,\s*([^,]+?)\s*,\s*France$/i);
      if(vm){venue=vm[1].replace(/^\[[^]]+\]\([^)]*\)$/,'').trim();city=vm[2].trim();title=skTitleAbove(lines,j);break;}
      const vm2=line.match(/^(.+?)\s*,\s*([^,]+?)\s*,\s*France$/i);
      if(vm2){venue=vm2[1].trim();city=vm2[2].trim();title=skTitleAbove(lines,j);break;}
    }
    if(title&&venue&&city)add(date,title,venue,city);
  }
  // Markdown link layout fallback. Songkick groups shows under date headings:
  // when the page starts with a date, an event belongs to the LAST date above
  // it (taking the next one shifted shows by a few days, e.g. 31 Jan → 2 Feb).
  let lastDate=null;
  for(let i=0;i<lines.length;i++){
    const hd=parseSongkickDate(lines[i]);if(hd)lastDate=hd;
    const tm=String(rawLines[i]||'').match(/^[-*]?\s*\[([^\]]+)\]\(([^)]+\/concerts\/[^)]*)\)/i);if(!tm)continue;
    const title=tm[1].trim();let date=dateFirst?lastDate:null,venue='',city='';
    for(let j=i+1;j<Math.min(lines.length,i+8);j++){
      const d=dateFirst?null:parseSongkickDate(lines[j]);if(d)date=d;
      if(dateFirst&&parseSongkickDate(lines[j]))break;
      const vm=lines[j].match(/^[-*]?\s*(?:\[([^\]]+)\]\([^)]*\/venues\/[^)]*\)|(.+?))\s*,\s*([^,]+)\s*,\s*France$/i);
      if(vm){venue=(vm[1]||vm[2]||'').trim();city=(vm[3]||'').trim();}
      if(date&&venue&&city)break;
    }
    if(date&&venue) add(date,title,venue,city||metro.name.split(' / ')[0]);
  }
  return rows;
}

// Songkick agendas are per calendar year: the current one, plus next year
// from July on (the app shows the next 6 months).
function songkickYears(){const d=new Date(),y=d.getFullYear();return d.getMonth()>=6?[y,y+1]:[y]}
function fetchSongkickMetro(metro,errs=null){const years=songkickYears();return cachedSourceRows(`sk2:${metro.slug}:${years.join('-')}`,async()=>{
  const parts=await Promise.all(years.map(y=>fetchSongkickMetroLive(metro,y,errs)));
  return {metro,rows:parts.flatMap(r=>r.rows),errors:parts.flatMap(r=>r.errors||[])};
}).then(r=>({...r,metro}))}
async function fetchSongkickMetroLive(metro,year,errs=null){
  const urls=[`https://www.songkick.com/fr/metro-areas/${metro.slug}/${year}/genre/metal`,`https://songkick.com/metro-areas/${metro.slug}/${year}/genre/metal`];
  const r=await firstWithRows(urls.flatMap(url=>[
    async()=>{const text=await fetchDiscoveryProxy(url,15000);let rows=parseSongkickMetalText(text,metro);if(!rows.length)rows=parseSongkickMetalHtml(text,metro);return {metro,rows,transport:'jina'}},
    async()=>{const html=await fetchText(url,{headers:BROWSER_HEADERS},12000);return {metro,rows:parseSongkickMetalHtml(html,metro),transport:'direct'}}
  ]),errs);
  return r.rows.length?r:{metro,rows:[],errors:r.errors};
}
async function discoverSongkickMetal(lat,lon,radiusKm,diag={}){
  const ranked=SONGKICK_METAL_METROS.map(m=>({...m,distance:distanceKm(lat,lon,m.lat,m.lon)})).sort((a,b)=>a.distance-b.distance);
  // Always keep the nearest metro; add a second nearby metro when the user radius reaches it.
  const selected=ranked.filter(m=>m.distance<=Math.max(radiusKm+120,180)).slice(0,3);
  const errs=[];const results=await Promise.all(selected.map(m=>fetchSongkickMetro(m,errs)));
  diag.raw=results.reduce((n,r)=>n+r.rows.length,0);diag.errors=errs;
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


// ---- Sueur de Metal (sueurdemetal.com/timeline/<Région>) ----
// Each concert card: date block ("24 OCTOBRE 2026", sometimes on 3 lines),
// headliner + "[GENRE]", support acts on lines starting with "- ", the time,
// then the city with its département: "FRÉJUS (83)". No venue on the card.
const SDM_REGIONS=[
  ['Alsace',48.5734,7.7521],['Aquitaine',44.8378,-0.5792],['Auvergne',45.7772,3.0870],['Basse-Normandie',49.1829,-0.3707],
  ['Bourgogne',47.3220,5.0415],['Bretagne',48.1173,-1.6778],['Centre',47.5861,1.3359],['Champagne-Ardenne',49.2583,4.0317],
  ['Corse',42.0396,9.0129],['Franche-Comte',47.2378,6.0241],['Haute-Normandie',49.4432,1.0993],['Ile-de-France',48.8566,2.3522],
  ['Languedoc-Roussillon',43.6108,3.8767],['Limousin',45.8336,1.2611],['Lorraine',48.6921,6.1844],['Midi-Pyrenees',43.6047,1.4442],
  ['Nord-Pas-de-Calais',50.6292,3.0573],['Pays-de-la-Loire',47.2184,-1.5536],['Picardie',49.8941,2.2958],['Poitou-Charentes',46.5802,0.3404],
  ['Provence-Alpes-Cote-d-Azur',43.2965,5.3698],['Rhone-Alpes',45.7640,4.8357]
].map(([slug,lat,lon])=>({slug,name:slug.replace(/-/g,' '),lat,lon,url:`https://www.sueurdemetal.com/timeline/${slug}`}));
function sdmCity(c){return String(c||'').toLowerCase().replace(/(^|[\s\-'’])([a-zà-ÿ])/g,(m,a,b)=>a+b.toUpperCase()).replace(/(?<=.)\b(En|De|Du|Des|La|Le|Les|Sur|Sous|Et|Aux|Lès)\b(?=[\s\-])/g,w=>w.toLowerCase()).trim()}
// Band names: all-capitals or all-lower-case → "Title Case"; mixed case kept.
function sdmName(n){n=String(n||'').trim();n=(n===n.toUpperCase()||n===n.toLowerCase())?sdmCity(n).replace(/\b(Ii|Iii|Iv|Vi|Xx)\b/g,x=>x.toUpperCase()):n;return n.charAt(0).toUpperCase()+n.slice(1)}
function parseSueurDeMetalText(text,region){
  const rows=[],seen=new Set();const MONTH=Object.keys(FR_MONTHS).join('|');
  // The relay can put several parts of a card on one line ("20:30 FNAC
  // MARSEILLE (13)", "22 OCTOBRE 2026 ![affiche]…", "TITLE [GENRE] - SUPPORT"):
  // split them back into one part per line before reading.
  const splitRe=new RegExp(`(\\b\\d{1,2}(?:er)?\\s+(?:${MONTH})\\s+20\\d{2}\\b|\\b\\d{1,2}[:h]\\d{2}\\b|\\b(?:FNAC|PARTENAIRE)\\b|[A-ZÀ-Ý][A-ZÀ-Ý'’\\-\\. ]{1,58}\\s*\\((?:\\d{2}|2A|2B)\\))`,'gi');
  const lines=String(text||'').split(/\r?\n/).map(l=>stripHtml(l).replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]*)\]\(([^)]*)\)/g,(m,t,u)=>t?`${t}⟦${u}⟧`:' ').replace(/[*#>_`|]+/g,' ').replace(/\s+/g,' ').trim())
   .flatMap(l=>l.replace(/\[[^\]⟦⟧]*\]/g,m=>m.replace(/\s[-–]\s/g,' / ')).replace(splitRe,'\n$1\n').replace(/\s+[-–•]\s+(?=[A-ZÀ-Ý0-9+])/g,'\n- ').split('\n')).map(l=>l.trim()).filter(Boolean);
  const one=new RegExp(`^(?:(?:lun|mar|mer|jeu|ven|sam|dim)[a-z.]*\\s+)?(\\d{1,2})(?:er)?\\s+(${MONTH})\\s+(20\\d{2})$`,'i');
  let date=null,cur=null;
  const flush=()=>{if(cur&&date&&cur.title&&cur.city){const title=[cur.title,...cur.support].join(' + ');const key=`${date}|${norm(cur.title)}|${norm(cur.city)}`;if(!seen.has(key)){seen.add(key);rows.push({id:`sdm-${date}-${norm(cur.title)}-${norm(cur.city)}`.slice(0,190),title,artist:cur.title,date,time:cur.time||'',venue:'',city:cur.city,dept:cur.dept||'',country:'France',url:cur.url||region.url,provider:'Sueur de Metal',metalDetected:true,isFestival:/festival|fest\b/i.test(title),details:`${cur.genre||''} · Source : Sueur de Metal`.replace(/^ · /,'')})}}cur=null};
  for(let i=0;i<lines.length;i++){
    let l=lines[i];
    // Date: one line, or day / month / year on three lines.
    let m=l.replace(/⟦[^⟧]*⟧/g,'').match(one);
    if(!m&&/^\d{1,2}$/.test(l)&&i+2<lines.length&&FR_MONTHS[lines[i+1].toLowerCase()]&&/^20\d{2}$/.test(lines[i+2])){m=[null,l,lines[i+1],lines[i+2]];i+=2}
    if(m){flush();const mo=FR_MONTHS[String(m[2]).toLowerCase()];date=`${m[3]}-${String(mo).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;continue}
    if(!date)continue;
    const url=(l.match(/⟦(https?:\/\/[^⟧]*sueurdemetal[^⟧]*(?:concert|event)[^⟧]*)⟧/i)||[])[1];l=l.replace(/⟦[^⟧]*⟧/g,'').trim();if(!l)continue;
    const city=l.match(/^([A-Za-zÀ-ÿ'’\-\. ]{2,60})\s*\((\d{2}|2A|2B|\d{3})\)$/i);
    if(city){if(cur){cur.city=sdmCity(city[1]);cur.dept=city[2];flush()}continue}
    if(/^\d{1,2}[:h]\d{2}$/.test(l)){if(cur)cur.time=l.replace('h',':');continue}
    if(/^(fnac|partenaire|billetterie|ticket|complet|annul|report)/i.test(l))continue;
    const sup=l.match(/^[-–•]\s*(.+)$/);
    if(sup){if(cur&&!/guest/i.test(sup[1]))cur.support.push(sdmName(sup[1].replace(/\s*\[[^\]]*\]\s*$/,'').trim()));continue}
    // Headliner line: "GORGON [BLACK METAL]".
    const hd=l.match(/^(.{1,80}?)\s*(?:\[([^\]]{2,60})\])?$/);
    // (the site may send names in lower case and only display them in capitals)
    if(hd&&(!cur||cur.city)&&/[A-Za-zÀ-ÿ]/.test(hd[1])){flush();cur={title:sdmName(hd[1].trim()),genre:hd[2]||'',support:[],url}}
    else if(hd&&cur&&!cur.title){cur.title=hd[1]}
  }
  flush();return rows;
}
async function fetchSueurDeMetalLive(region,errs=null){
  const r=await firstWithRows([
    async()=>({region,rows:parseSueurDeMetalText(String(await fetchDiscoveryProxy(region.url,15000,{render:true})).replace(/<\/(div|p|li|h\d|span|a|td|tr|section|article)>|<br\s*\/?>/gi,'\n'),region),transport:'relay'}),
    async()=>({region,rows:parseSueurDeMetalText(String(await fetchText(region.url,{headers:BROWSER_HEADERS},15000)).replace(/<\/(div|p|li|h\d|span|a|td|tr|section|article)>|<br\s*\/?>/gi,'\n'),region),transport:'direct'})
  ],errs);
  return r.rows.length?r:{region,rows:[],errors:r.errors};
}
// Its timeline is built by JavaScript: read with rendering (10 ScraperAPI
// credits instead of 1), so it is kept 24 h.
function fetchSueurDeMetal(region,errs=null){return cachedSourceRows('sdm:'+region.slug,()=>fetchSueurDeMetalLive(region,errs),24*60*60*1000).then(r=>({...r,region}))}
async function discoverSueurDeMetal(lat,lon,radiusKm,diag={}){
  const selected=SDM_REGIONS.map(r=>({...r,distance:distanceKm(lat,lon,r.lat,r.lon)})).sort((a,b)=>a.distance-b.distance).filter((r,i)=>i===0||r.distance<=Math.max(radiusKm+150,200)).slice(0,2);
  const errs=[];const results=await Promise.all(selected.map(r=>fetchSueurDeMetal(r,errs)));
  diag.raw=results.reduce((n,r)=>n+r.rows.length,0);diag.errors=errs;
  const today=new Date().toISOString().slice(0,10);const all=results.flatMap(r=>r.rows).filter(x=>x.date>=today);
  const cityCoords=new Map();
  for(const c of [...new Set(all.map(x=>norm(x.city)).filter(Boolean))]){
    const direct=REGIONAL_CITY_COORDS[Object.keys(REGIONAL_CITY_COORDS).find(k=>norm(k)===c)];
    if(direct)cityCoords.set(c,{lat:direct[0],lon:direct[1]});else{const g=await geocodeCity(c,'France');if(g)cityCoords.set(c,g)}
  }
  const located=[];for(const row of all){const p=cityCoords.get(norm(row.city));if(p)located.push({...row,_place:{coordinates:{latitude:p.lat,longitude:p.lon}}})}
  return withDistance(located,lat,lon,radiusKm);
}

// Concerts and festivals come from the same scan; the browser asks for both at
// once, so share one in-flight run and keep its result for a few minutes.
const scanCache=new Map(); const SCAN_TTL=20*60*1000;
// One scan at the widest radius per place, then each request keeps the
// concerts within its own radius: switching 10/20/50/100 km is instant and
// consistent, and the shared scan cache is reused.
const SCAN_RADIUS_KM=100;
async function discoverConcertsMetal(lat,lon,radiusKm,targetCityOverride=''){
  const r=Number(radiusKm)||50;const res=await discoverConcertsMetalScan(lat,lon,SCAN_RADIUS_KM,targetCityOverride);
  const keep=x=>!Number.isFinite(Number(x?.distanceKm))||Number(x.distanceKm)<=r;
  const concerts=(res.concerts||[]).filter(keep);
  // Around Nantes, the built-in agenda of known local shows (Montaigu, Vallet,
  // Clisson…) is always merged in: the online sources often miss small venues.
  if(distanceKm(lat,lon,47.2184,-1.5536)<=150){
    const k=x=>`${String(x.date).slice(0,10)}|${norm(x.city)}|${norm(x.venue).replace(/^(le|la|les|l)\s+/,'')}`;const have=new Set(concerts.map(k));
    for(const x of await curatedConcertFallback(lat,lon,r))if(!have.has(k(x))){have.add(k(x));concerts.push(x)}
    concerts.sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
  }
  const merged=dedupeAcrossSources(concerts);concerts.length=0;concerts.push(...merged);
  return {concerts,festivals:(res.festivals||[]).filter(keep),sources:res.sources||null};
}
// The same show often comes from two sources with a slightly different venue
// name ("Zenith Nantes Métropole" / "Zénith de Nantes Métropole") and, for
// Songkick, sometimes a shifted date. Same band + same venue within 10 days
// from DIFFERENT sources = one concert: keep the most reliable source.
const VENUE_STOP=new Set('le la les l de du des d salle grande petite maxi club the a au aux et metropole'.split(' '));
function venueTokens(v){return new Set(norm(v).replace(/[^a-z0-9]+/g,' ').split(' ').filter(w=>w&&!VENUE_STOP.has(w)))}
function sameVenue(a,b){const A=venueTokens(a),B=venueTokens(b);if(!A.size||!B.size)return false;let n=0;for(const w of A)if(B.has(w))n++;return n/Math.min(A.size,B.size)>=0.8}
function headliner(t){return norm(String(t||'').split(/\s\+\s|,|\s\/\s|\s-\s/)[0]).replace(/[^a-z0-9]+/g,' ').trim()}
function sourceRank(x){const p=String(x?.provider||'').toLowerCase();return /concerts-metal/.test(p)?3:/bandsintown/.test(p)?3:/songkick/.test(p)?1:2}
function sourceFamily(x){const p=String(x?.provider||'').toLowerCase();return /songkick/.test(p)?'sk':/bandsintown/.test(p)?'bi':/concerts-metal/.test(p)?'cm':/sueur/.test(p)?'sdm':p}
function placeKey(c){return norm(cleanPlaceName(c)).replace(/[^a-z0-9]+/g,' ').trim()}
function billBands(t){return String(t||'').split(/\s\+\s|,|\s\/\s|\s-\s|\set\s/i).map(b=>norm(b).replace(/[^a-z0-9]+/g,' ').trim()).filter(b=>b.length>2)}
function editDist(a,b){if(Math.abs(a.length-b.length)>2)return 9;const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
// Same band name, allowing extra words ("Michael Schenker" / "… Group") and
// small typos ("Scheneker" / "Schenker").
function sameBand(x,y){return x===y||` ${x} `.startsWith(` ${y} `)||` ${y} `.startsWith(` ${x} `)||(Math.min(x.length,y.length)>=8&&editDist(x,y)<=2)}
function bandsOverlap(a,b){const A=billBands(a),B=billBands(b);return A.some(x=>B.some(y=>sameBand(x,y)))}
function dedupeAcrossSources(rows){
  const out=[];
  for(const x of rows){
    const h=headliner(x.title),t=Date.parse(String(x.date).slice(0,10));
    // Same show from two sources: same headliner (one name may carry extra words,
    // "Syndrome 81 Oi!" / "syndrome 81"), close dates, and the same venue — or,
    // when a source gives no venue (Sueur de Metal), the same date and city.
    const i=out.findIndex(y=>{if(sourceFamily(y)===sourceFamily(x)||!h)return false;const dy=Date.parse(String(y.date).slice(0,10));
      const hy=headliner(y.title),sameHead=hy===h||(hy&&(` ${h} `.startsWith(` ${hy} `)||` ${hy} `.startsWith(` ${h} `)));
      if(sameHead&&sameVenue(y.venue,x.venue))return Math.abs(dy-t)<=10*864e5;
      // Same day, same place (venue, or city when one source has no venue) and
      // at least one band in common (bills are not always listed in the same order).
      const samePlace=sameVenue(y.venue,x.venue)||((!x.venue||!y.venue)&&placeKey(x.city)===placeKey(y.city))||(placeKey(x.city)&&placeKey(x.city)===placeKey(y.city)&&bandsOverlap(x.title,y.title));
      // Songkick dates can be shifted onto a neighbouring show: within 10 days,
      // the other source's date wins (Songkick has the lowest rank).
      const sk=sourceFamily(x)==='sk'||sourceFamily(y)==='sk';
      return (dy===t||(sk&&Math.abs(dy-t)<=10*864e5))&&samePlace&&(sameHead||bandsOverlap(x.title,y.title))});
    if(i<0){out.push(x);continue}
    const y=out[i];const keep=sourceRank(x)>sourceRank(y)?x:y;const other=keep===x?y:x;
    out[i]={...keep,venue:keep.venue||other.venue,time:keep.time||other.time,title:billBands(other.title).length>billBands(keep.title).length?other.title:keep.title};
  }
  // Songkick's agenda pages cannot be read reliably (dates shifted onto the
  // next show): when another source covers the search, its own shows are not
  // shown; Songkick stays as a fallback for places no other source covers.
  if(out.some(x=>sourceFamily(x)!=='sk'))return out.filter(x=>sourceFamily(x)!=='sk');
  return out;
}
function discoverConcertsMetalScan(lat,lon,radiusKm,targetCityOverride=''){
  const key=[Number(lat).toFixed(3),Number(lon).toFixed(3),radiusKm,norm(targetCityOverride)].join('|');
  const hit=scanCache.get(key); if(hit&&Date.now()-hit.at<SCAN_TTL)return hit.job;
  // An empty scan usually means a source was slow or refused us: share it with
  // concurrent callers, but do not keep it, so the next search tries again.
  const job=scanConcertsMetal(lat,lon,radiusKm,targetCityOverride).then(res=>{if(!(res?.concerts?.length||res?.festivals?.length)&&scanCache.get(key)?.job===job)scanCache.delete(key);return res},e=>{scanCache.delete(key);throw e});
  scanCache.set(key,{at:Date.now(),job});
  for(const [k,v] of scanCache)if(Date.now()-v.at>=SCAN_TTL)scanCache.delete(k);
  return job;
}
async function scanConcertsMetal(lat,lon,radiusKm,targetCityOverride=''){
  // Manual searches are authoritative: when the user typed a city, never
  // infer the search city again from the browser/GPS coordinates.
  const targetCity=String(targetCityOverride||'').trim();
  const resolvedPlace=targetCity?{city:targetCity,lat,lon}:await reverseCity(lat,lon);
  const effectiveCity=String(resolvedPlace?.city||targetCity||'').trim();
  const all=[];
  // The three sources are independent: query them in parallel.
  // 1) Bandsintown city Metal agenda: broad coverage and a public city/genre page.
  const biDiag={raw:0,errors:[]},skDiag={raw:0,errors:[]},sdmDiag={raw:0,errors:[]},cmErrs=[];let cmRaw=0,cmRegions=[];
  const bandsintownJob=effectiveCity?discoverBandsintownMetal(effectiveCity,lat,lon,radiusKm,biDiag).catch(e=>{biDiag.errors.push(fetchErrorLabel(e));return []}):Promise.resolve([]);
  // 2) Songkick city/metro Metal agenda: second independent nationwide source.
  const songkickJob=discoverSongkickMetal(lat,lon,radiusKm,skDiag).catch(e=>{skDiag.errors.push(fetchErrorLabel(e));return []});
  const sdmJob=discoverSueurDeMetal(lat,lon,radiusKm,sdmDiag).catch(e=>{sdmDiag.errors.push(fetchErrorLabel(e));return []});
  // 2b) Ticketmaster (official API): metal concerts around the point.
  const tmDiag={raw:0,errors:[]};
  const tmJob=ticketmasterNearby(lat,lon,radiusKm).then(r=>{tmDiag.raw=r.rows.length;if(r.configured)recordSource('tm:'+Number(lat).toFixed(1)+','+Number(lon).toFixed(1),true).catch(()=>{});return r.rows}).catch(e=>{tmDiag.errors.push(fetchErrorLabel(e));recordSource('tm:'+Number(lat).toFixed(1)+','+Number(lon).toFixed(1),false,fetchErrorLabel(e)).catch(()=>{});return []});

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
    const results=await Promise.all(uniqueSelected.map(s=>fetchMetalRegionalSource(s,cmErrs)));
    cmRaw=results.reduce((n,r)=>n+r.rows.length,0);
    // Per regional page: row count, most frequent cities, and whether its list
    // is identical to another region's (i.e. the site ignores the region).
    const sig=r=>r.rows.map(x=>`${x.date}|${norm(x.title)}`).sort().join('~');const seen=new Map();
    cmRegions=results.map(r=>{const f=new Map();for(const x of r.rows){const c=cleanPlaceName(x.city);if(c)f.set(c,(f.get(c)||0)+1)}const g=r.rows.length?sig(r):'';const same=g&&seen.get(g)||null;if(g&&!seen.has(g))seen.set(g,r.source.slug);return {slug:r.source.slug,rows:r.rows.length,cities:[...f.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]),same}});
    for(const rr of results){for(const row of rr.rows){
      if(!row?.date)continue;
      if(new Date(String(row.date).slice(0,10))<new Date(new Date().toISOString().slice(0,10)))continue;
      if(!eventHasMetal(row))continue;
      all.push({...row,sourceRegion:rr.source.name,sourceUrl:metalSourceUrl(rr.source)});
    }}
  }catch{}

  const cmCount=all.length;const biRows=await bandsintownJob,skRows=await songkickJob,sdmRows=await sdmJob,tmRows=await tmJob;
  // Rows each source returned before the distance filter (shown when nothing is found).
  // Raw rows per source (before the distance filter) and why a source failed.
  const uniq=a=>[...new Set(a)].slice(0,3);
  const sources={
    bandsintown:{raw:biDiag.raw,kept:biRows.length,located:biDiag.located??null,errors:biDiag.raw?[]:uniq(biDiag.errors)},
    songkick:{raw:skDiag.raw,kept:skRows.length,errors:skDiag.raw?[]:uniq(skDiag.errors)},
    sueurDeMetal:{raw:sdmDiag.raw,kept:sdmRows.length,errors:sdmDiag.raw?[]:uniq(sdmDiag.errors)},
    concertsMetal:{raw:cmRaw,kept:cmCount,errors:cmRaw?[]:uniq(cmErrs),regions:cmRegions},
    ticketmaster:{raw:tmDiag.raw,kept:tmRows.length,errors:uniq(tmDiag.errors)}
  };
  all.push(...biRows,...skRows,...sdmRows,...tmRows);
  const dated=all.filter(x=>x?.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const placeDiag={};
  const filtered=await withDistance(dated,lat,lon,radiusKm,placeDiag);
  if(placeDiag.unlocated)sources.unlocated={count:placeDiag.unlocated,samples:placeDiag.samples||[]};
  const unique=new Map();
  for(const x of filtered){
    const k=`${String(x.date).slice(0,10)}|${norm(x.city)}|${norm(x.venue)}|${norm(x.title)}`;
    if(!unique.has(k))unique.set(k,x);
  }
  // Pages read through r.jina.ai come back as Markdown: drop the emphasis
  // marks ("**Title**", "*Venue*") that would otherwise show in the cards.
  const clean=v=>typeof v==='string'?v.replace(/\*+/g,' ').replace(/(^|\s)_+|_+(?=\s|$)/g,'$1').replace(/\s{2,}/g,' ').trim():v;
  for(const [k,x] of unique){const title=clean(x.title);unique.set(k,{...x,title:/concerts-metal/i.test(String(x.provider||''))?splitBandsFromGenres(title):title,venue:clean(x.venue),city:clean(x.city)})}
  let final=[...unique.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
  return {concerts:final.filter(x=>!x.isFestival),festivals:final.filter(x=>x.isFestival),sources};
}

async function googleLocalFestivalDiscovery(place){const deadline=Date.now()+10000;const queries=[`festival metal ${place.city||''} ${place.state||''}`,`concert metal festival ${place.city||''} ${place.state||''}`];const found=new Map();for(const q of queries){try{const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`,{},15000);const d=new XMLParser({ignoreAttributes:false}).parse(xml);let items=d?.rss?.channel?.item||[];if(!Array.isArray(items))items=[items];for(const x of items.slice(0,20)){if(Date.now()>deadline)break;const title=String(x.title||'').trim(),url=String(x.link||'').trim(),desc=stripHtml(x.description||'');const hay=`${title} ${desc}`.toLowerCase();if(!title||!url||!/festival|concert|live|metal/i.test(hay))continue;const key=title.toLowerCase();if(found.has(key))continue;const gp=await geocodeQuery(`${title} ${desc}`);if(!gp)continue;const dkm=distanceKm(latOr(place),lonOr(place),gp.lat,gp.lon);if(dkm>100)continue;const metalDetected=FESTIVAL_METAL_TAGS.some(t=>hay.includes(t));if(!metalDetected)continue;found.set(key,{id:`google-local-${Buffer.from(url).toString('base64url').slice(0,24)}`,title,date:parseRssDate(x.pubDate),venue:'',city:gp.display_name?.split(',')[0]||'',country:'France',url,provider:'google-news-local',metalDetected:true,distanceKm:Math.round(dkm*10)/10});}}catch{}}return [...found.values()]}
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
  let sources=null;
  try{const cm=await discoverConcertsMetal(lat,lon,radiusKm,place?.city||'');items=cm.concerts;sources=cm.sources}catch{}
  // A manual city search must NEVER fall back to the browser/current-location
  // or to the historical Nantes/Cugand curated data. If the city-targeted
  // sources fail, return an empty result rather than showing concerts from
  // another place.
  if(manualTarget){
    const today=new Date().toISOString().slice(0,10);
    items=items.filter(x=>!x.date || String(x.date).slice(0,10)>=today)
      .sort((a,b)=>String(a.date||'9999-12-31').slice(0,10).localeCompare(String(b.date||'9999-12-31').slice(0,10))||Number(a.distanceKm||9999)-Number(b.distanceKm||9999));
    return {place,radiusKm,items,sources};
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
  return {place,radiusKm,items,sources};
}

// Administration › État des sources › « Tester maintenant »: reads one page
// of each source right now, through the relay (r.jina.ai) and directly, and
// tells what came back (HTTP status, size, page title, concerts read). It
// shows why a source is down: relay without credit (402), site blocking the
// server (403, Cloudflare page), or a page whose layout changed (0 concert).
export async function testSources(){
  const y=new Date().getFullYear();
  const sk=SONGKICK_METAL_METROS.find(m=>m.slug==='28901-france-nantes');
  const sdm=SDM_REGIONS.find(r=>r.slug==='Pays-de-la-Loire');
  const cases=[
    {id:'cm',name:'Concerts-Metal',url:'https://nantes.concerts-metal.com/',parse:(t,url)=>{const r=parseConcertsMetalHtml(t,url);return r.length?r:parseConcertsMetalText(t,url)}},
    {id:'sdm',name:'Sueur de Metal',url:sdm.url,render:true,parse:t=>parseSueurDeMetalText(String(t).replace(/<\/(div|p|li|h\d|span|a|td|tr|section|article)>|<br\s*\/?>/gi,'\n'),sdm)},
    {id:'sk2',name:'Songkick',url:`https://www.songkick.com/fr/metro-areas/${sk.slug}/${y}/genre/metal`,parse:t=>{const r=parseSongkickMetalText(t,sk);return r.length?r:parseSongkickMetalHtml(t,sk)}},
    {id:'bi',name:'Bandsintown',url:'https://www.bandsintown.com/fr/c/nantes-france/all-dates/genre/metal',parse:(t,url)=>parseBandsintownMetalText(t,'Nantes',url)}
  ];
  const probe=async(c,via)=>{
    const rr=relayRequest(c.url,{render:!!c.render});
    const target=via==='relais'?rr.target:c.url;
    const headers=via==='relais'?rr.headers:BROWSER_HEADERS;
    const t0=Date.now(),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),via==='relais'&&rr.timeout?rr.timeout:20000);
    try{
      const r=await fetch(target,{headers,signal:ctl.signal});const text=await r.text();
      let rows=0;try{rows=r.ok?c.parse(text,c.url).length:0}catch{}
      const title=(String(text).match(/<title[^>]*>([^<]{0,120})/i)?.[1]||String(text).match(/^Title:\s*(.{0,120})$/m)?.[1]||stripHtml(String(text)).replace(/\s+/g,' ').trim().slice(0,120)).trim();
      return {via,status:r.status,ms:Date.now()-t0,size:text.length,rows,title};
    }catch(e){return {via,status:0,ms:Date.now()-t0,size:0,rows:0,title:fetchErrorLabel(e)}}
    finally{clearTimeout(timer)}
  };
  const tm=(async()=>{const t0=Date.now();if(!process.env.TICKETMASTER_API_KEY)return {id:'tm',name:'Ticketmaster',attempts:[{via:'api',status:0,ms:0,size:0,rows:0,title:'clé TICKETMASTER_API_KEY absente'}]};
    try{const r=await ticketmasterNearby(47.2184,-1.5536,50);return {id:'tm',name:'Ticketmaster',attempts:[{via:'api',status:200,ms:Date.now()-t0,size:0,rows:r.rows.length,title:r.rows.slice(0,3).map(x=>x.title).join(' · ')}]}}
    catch(e){return {id:'tm',name:'Ticketmaster',attempts:[{via:'api',status:0,ms:Date.now()-t0,size:0,rows:0,title:fetchErrorLabel(e)}]}}})();
  return Promise.all([...cases.map(async c=>({id:c.id,name:c.name,url:c.url,relayKey:Boolean(process.env.SCRAPERAPI_KEY||process.env.JINA_API_KEY),relay:relayRequest(c.url).name,attempts:await Promise.all([probe(c,'relais'),probe(c,'direct')])})),tm]);
}
export {firstWithRows as _firstWithRows};
