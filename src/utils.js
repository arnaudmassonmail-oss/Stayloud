import {slug} from "./db.js";

export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function normalizeUrl(u){
 try{const x=new URL(u);x.hash="";for(const k of ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid"])x.searchParams.delete(k);return x.toString().replace(/\/$/,"")}catch{return String(u||"")}
}
export function newsKey(x){return normalizeUrl(x.url)?`url:${normalizeUrl(x.url)}`:`title:${slug(x.title)}|${String(x.published_at||"").slice(0,10)}`}
export function eventKey(x){return [slug(x.title),String(x.date||"").slice(0,10),slug(x.venue),slug(x.city),slug(x.country)].join("|")}

const COUNTRY_MAP={
 fr:"France",fra:"France",france:"France",be:"Belgique",bel:"Belgique",belgique:"Belgique",belgium:"Belgique",
 ch:"Suisse",che:"Suisse",suisse:"Suisse",switzerland:"Suisse",gb:"Royaume-Uni",gbr:"Royaume-Uni",uk:"Royaume-Uni","united kingdom":"Royaume-Uni",england:"Royaume-Uni",scotland:"Royaume-Uni",wales:"Royaume-Uni",
 de:"Allemagne",deu:"Allemagne",germany:"Allemagne",allemagne:"Allemagne",es:"Espagne",esp:"Espagne",spain:"Espagne",espagne:"Espagne",
 it:"Italie",ita:"Italie",italy:"Italie",italie:"Italie",nl:"Pays-Bas",nld:"Pays-Bas",netherlands:"Pays-Bas","pays-bas":"Pays-Bas",
 pt:"Portugal",prt:"Portugal",portugal:"Portugal",ca:"Canada",can:"Canada",canada:"Canada",us:"États-Unis",usa:"États-Unis","united states":"États-Unis",
 ie:"Irlande",irl:"Irlande",ireland:"Irlande",irlande:"Irlande",at:"Autriche",aut:"Autriche",austria:"Autriche",autriche:"Autriche",
 se:"Suède",swe:"Suède",sweden:"Suède",suede:"Suède",dk:"Danemark",dnk:"Danemark",denmark:"Danemark",danemark:"Danemark",
 no:"Norvège",nor:"Norvège",norway:"Norvège",norvege:"Norvège",fi:"Finlande",fin:"Finlande",finland:"Finlande",finlande:"Finlande",
 pl:"Pologne",pol:"Pologne",poland:"Pologne",pologne:"Pologne"
};
function canonicalCountry(v){
 const s=String(v||"").trim();
 if(!s)return "";
 // Certaines sources ajoutent des caractères parasites autour du pays
 // (ex: "France]", "[France]", '"France"'). On les retire avant
 // la comparaison afin qu'ils ne créent pas de faux pays dans les filtres.
 const key=s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,"");
 return COUNTRY_MAP[key]||""
}
export function countryGuess(country,city="",venue="",title=""){
 const direct=canonicalCountry(country);
 if(direct)return direct;

 const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const hay=`${norm(city)} ${norm(venue)} ${norm(title)}`;
 const raw=norm(country);

 // Ville -> pays. Le titre est inclus car MusicBrainz fournit parfois
 // "NEW WORLD KILLER Tour 2027 - London" alors que city/country sont vides.
 const cities={
  // France
  paris:"France",lyon:"France",nantes:"France",lille:"France",marseille:"France",
  toulouse:"France",bordeaux:"France",rennes:"France",strasbourg:"France",
  nice:"France",montpellier:"France",grenoble:"France",rouen:"France",
  reims:"France",dijon:"France",nancy:"France",metz:"France",tours:"France",
  amiens:"France",caen:"France",
  // Royaume-Uni
  london:"Royaume-Uni",glasgow:"Royaume-Uni",manchester:"Royaume-Uni",
  leeds:"Royaume-Uni",bristol:"Royaume-Uni",birmingham:"Royaume-Uni",
  liverpool:"Royaume-Uni",edinburgh:"Royaume-Uni",cardiff:"Royaume-Uni",
  belfast:"Royaume-Uni",sheffield:"Royaume-Uni",nottingham:"Royaume-Uni",
  newcastle:"Royaume-Uni","newcastle upon tyne":"Royaume-Uni",
  brighton:"Royaume-Uni",southampton:"Royaume-Uni",oxford:"Royaume-Uni",
  cambridge:"Royaume-Uni",york:"Royaume-Uni",bath:"Royaume-Uni",
  wrexham:"Royaume-Uni",swansea:"Royaume-Uni",aberdeen:"Royaume-Uni",
  dundee:"Royaume-Uni",inverness:"Royaume-Uni",bournemouth:"Royaume-Uni",
  exeter:"Royaume-Uni",plymouth:"Royaume-Uni",
  // Belgique
  brussels:"Belgique",bruxelles:"Belgique",antwerp:"Belgique",anvers:"Belgique",
  ghent:"Belgique",gent:"Belgique",liege:"Belgique",namur:"Belgique",charleroi:"Belgique",
  // Suisse
  zurich:"Suisse",geneva:"Suisse",geneve:"Suisse",lausanne:"Suisse",basel:"Suisse",
  bern:"Suisse",berne:"Suisse",
  // Allemagne
  berlin:"Allemagne",hamburg:"Allemagne",munich:"Allemagne",munchen:"Allemagne",
  cologne:"Allemagne",koln:"Allemagne",frankfurt:"Allemagne",francfort:"Allemagne",
  hannover:"Allemagne",leipzig:"Allemagne",dresden:"Allemagne",stuttgart:"Allemagne",
  dortmund:"Allemagne",dusseldorf:"Allemagne",karlsruhe:"Allemagne",
  // Pays-Bas
  amsterdam:"Pays-Bas",rotterdam:"Pays-Bas",utrecht:"Pays-Bas",tilburg:"Pays-Bas",
  eindhoven:"Pays-Bas",groningen:"Pays-Bas",
  // Espagne
  madrid:"Espagne",barcelona:"Espagne",barcelone:"Espagne",valencia:"Espagne",
  sevilla:"Espagne",bilbao:"Espagne",malaga:"Espagne",
  // Italie
  rome:"Italie",roma:"Italie",milan:"Italie",milano:"Italie",turin:"Italie",
  torino:"Italie",bologna:"Italie",naples:"Italie",napoli:"Italie",florence:"Italie",
  // Portugal
  lisbon:"Portugal",lisbonne:"Portugal",porto:"Portugal",
  // Irlande
  dublin:"Irlande",cork:"Irlande",galway:"Irlande",limerick:"Irlande",
  // Canada
  montreal:"Canada",toronto:"Canada",vancouver:"Canada",ottawa:"Canada",
  calgary:"Canada",edmonton:"Canada",quebec:"Canada",
  // Etats-Unis
  "new york":"États-Unis",chicago:"États-Unis","los angeles":"États-Unis",
  seattle:"États-Unis",denver:"États-Unis",atlanta:"États-Unis",austin:"États-Unis",
  dallas:"États-Unis",philadelphia:"États-Unis",detroit:"États-Unis",
  portland:"États-Unis","san francisco":"États-Unis"
 };

 for(const cityName of Object.keys(cities).sort((a,b)=>b.length-a.length)){
   const re=new RegExp(`(^|[^a-z0-9])${cityName.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?=$|[^a-z0-9])`);
   if(re.test(hay)) return cities[cityName];
 }

 const explicit=[
  ["France",/\bfrance\b/],
  ["Belgique",/\bbelgique\b|\bbelgium\b/],
  ["Suisse",/\bsuisse\b|\bswitzerland\b/],
  ["Royaume-Uni",/\bunited kingdom\b|\bengland\b|\bscotland\b|\bwales\b|\bnorthern ireland\b/],
  ["Allemagne",/\bgermany\b|\ballemagne\b/],
  ["Espagne",/\bspain\b|\bespagne\b/],
  ["Italie",/\bitaly\b|\bitalie\b/],
  ["Pays-Bas",/\bnetherlands\b|\bpays-bas\b/],
  ["Portugal",/\bportugal\b/],
  ["Irlande",/\bireland\b|\birlande\b/],
  ["Autriche",/\baustria\b|\bautriche\b/],
  ["Pologne",/\bpoland\b|\bpologne\b/],
  ["République tchèque",/\bczech republic\b|\bczechia\b/],
  ["Hongrie",/\bhungary\b|\bhongrie\b/],
  ["Canada",/\bcanada\b/],
  ["États-Unis",/\bunited states\b|\busa\b/]
 ];
 for(const [name,re] of explicit) if(re.test(hay)) return name;

 const cleanedRaw=String(country||"").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,"");
 return (cleanedRaw && cleanedRaw.toLowerCase()!=="other" && cleanedRaw.toLowerCase()!=="autre") ? cleanedRaw : "Autre";
}

// Radar news are intentionally restricted to editorial/music-specialist sources.
// This prevents homonyms such as "Banquise" (arctic/municipal news) from
// polluting an artist feed. General newspapers/radio/news portals are not
// accepted here, even when the article title happens to contain a music word.
const TRUSTED_MUSIC_HOSTS=[
 "metalzone.fr","metalorgie.com","metaluniverse.net","radiometal.com","radio-metal.com",
 "hardforce.com","loudtv.net","rockurlife.net","loudwire.com","blabbermouth.net",
 "theprp.com","lambgoat.com","metalinjection.net","revolvermag.com","kerrang.com",
 "metalhammer.com","rocksound.tv","metalsucks.net","metalinsider.net","ghostcultmag.com",
 "metalitalia.com","metalstorm.net","metalstorm.ee","metalmusicarchives.com","metal-archives.com",
 "coreandco.fr","coreandco-web.com","rocknfolk.com","rollingstone.fr","rocknroll-rebels.com",
 "lagrosseradio.com","ouifm.fr","concertandco.com","unitedrocknations.com","auxportesdumetal.com",
 "rockhard.de","rockhard.fr","heavymag.com","metalobs.com","metalreport.fr","metal-addict.com",
 "metal-rules.com","metaltalk.net","ghostcultmag.com","angrymetalguy.com"
];
function escapeRegExp(s){return String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function hostOf(url){try{return new URL(url).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}}
function trustedMusicSource(url,source=""){
 const h=hostOf(url);
 if(TRUSTED_MUSIC_HOSTS.some(x=>h===x||h.endsWith("."+x))) return true;
 // Google News RSS commonly exposes a news.google.com redirect URL while
 // keeping the real publisher in the RSS <source> field. Trust the publisher
 // name as well, otherwise specialist articles such as MetalUniverse are
 // incorrectly discarded by the host-only check.
 const s=String(source||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/^www\./,"").trim();
 if(!s) return false;
 const sourceAliases={
   "metaluniverse":"metaluniverse.net",
   "metaluniverse.net":"metaluniverse.net",
   "metalzone":"metalzone.fr",
   "metalzone.fr":"metalzone.fr",
   "metalorgie":"metalorgie.com",
   "radiometal":"radiometal.com",
   "radio metal":"radio-metal.com",
   "hard force":"hardforce.com",
   "hardforce":"hardforce.com",
   "loudwire":"loudwire.com",
   "blabbermouth":"blabbermouth.net",
   "theprp":"theprp.com",
   "metal injection":"metalinjection.net",
   "metal hammer":"metalhammer.com",
   "kerrang!":"kerrang.com",
   "kerrang":"kerrang.com",
   "rocksound":"rocksound.tv",
   "metalitalia":"metalitalia.com",
   "coreandco":"coreandco.fr",
   "aux portes du metal":"auxportesdumetal.com",
   "rock hard":"rockhard.fr"
 };
 const candidate=sourceAliases[s]||s;
 return TRUSTED_MUSIC_HOSTS.some(x=>candidate===x||candidate.endsWith("."+x));
}
function exactArtist(name,text,flags="iu"){
 const escaped=escapeRegExp(String(name||"").trim()).replace(/\s+/g,"\\s+");if(!escaped)return false;
 return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,flags).test(String(text||""));
}
export function isRelevantArtistNews(artist,title,url="",source="",provider=""){
 const name=String(artist?.name||artist||"").trim(),t=String(title||"");
 if(!name||!t)return false;

 // Known homonym/disambiguation traps: "Korn" is frequently returned by
 // general news search because of the Korn Ferry golf circuit. Those stories
 // are not about the metal band and must never enter the artist radar.
 const normText=String(`${t} ${source||""} ${url||""}`).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const normName=name.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 if(normName==="korn" && /\bkorn\s+ferry\b|\bgolf\b|\bpga\b|\bkft\b|\bgolfeur|\bgolfeuse|\bchampionship\b.*\bgolf\b|\bgolf\b.*\bchampionship\b/.test(normText)) return false;

 // 1) The artist name must be a real token, so "emmure" in "emmure/emmuré"
 //    or another word containing the same letters is not enough.
 if(!exactArtist(name,t))return false;

 // 2) Specialist music/metal sources are considered strong evidence that the
 //    article is about the tracked artist. This preserves important stories
 //    such as a guitarist/member departure even when the title has little
 //    generic "music" vocabulary.
 if(trustedMusicSource(url,source))return true;

 // 3) General newspapers, regional radio stations and generic news portals
 //    are intentionally excluded from Radar.
 return false;
}

export async function fetchText(url,options={},timeout=20000){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{...options,signal:c.signal,headers:{"User-Agent":"MusicRadar/2.1 free-first aggregator",...(options.headers||{})}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}finally{clearTimeout(t)}
}
export async function fetchJson(url,options={},timeout=20000){return JSON.parse(await fetchText(url,options,timeout))}
export function parseDate(v){
 const s=String(v||"").trim();
 if(!s)return null;

 // GDELT seendate/datetime: 20260916T123456Z or 20260916T123456
 let m=s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
 if(m){
   const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]?"Z":""}`;
   const d=new Date(iso);
   if(!Number.isNaN(d.getTime()))return d.toISOString();
 }

 // Compact calendar date: 20260916
 m=s.match(/^(\d{4})(\d{2})(\d{2})$/);
 if(m){
   const d=new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
   if(!Number.isNaN(d.getTime()))return d.toISOString();
 }

 const d=new Date(s);
 return Number.isNaN(d.getTime())?null:d.toISOString();
}
