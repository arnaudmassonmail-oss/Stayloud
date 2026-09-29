import {fetchJson,fetchText,sleep,eventKey,countryGuess} from "../utils.js";
import {providerRun,updateArtist} from "../db.js";
import {resolveBandsintown} from "./concert-web.js";
const BASE="https://musicbrainz.org/ws/2";let last=0;
async function mb(url){
 const wait=Math.max(0,1050-(Date.now()-last));if(wait)await sleep(wait);last=Date.now();
 let err;for(let i=0;i<4;i++){try{return await fetchJson(url,{headers:{Accept:"application/json"}},20000)}catch(e){err=e;await sleep(1500*2**i)}}throw err;
}
const ARTIST_ALIASES={
  "landmarks":"LANDMVRKS",
  "landmvrks":"LANDMVRKS"
};
function canonicalInputName(name){
 const raw=String(name||"").trim();
 const key=raw.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 return ARTIST_ALIASES[key]||raw;
}

function normArtistName(s){return String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function levenshtein(a,b){const m=a.length,n=b.length;const dp=Array.from({length:m+1},(_,i)=>{const r=new Array(n+1);r[0]=i;return r});for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n];}
function candidateScore(input,a){
 const n=normArtistName(a?.name), q=normArtistName(input); if(!n)return -999;
 let score=0;
 if(n===q)score+=1000;
 const max=Math.max(n.length,q.length,1), sim=1-(levenshtein(n,q)/max); score+=sim*100;
 if(n.includes(q)||q.includes(n))score+=25;
 const tags=(a?.tags||[]).map(t=>String(t?.name||"").toLowerCase()).join(" ");
 if(/metal|rock|hardcore|punk|alternative|core|music|musical/.test(tags))score+=12;
 return score;
}
async function bandsintownIdentity(name){
 const app=String(process.env.BANDSINTOWN_APP_ID||"js_www.sorti-ka.com").trim();
 const n=String(name||'').trim();
 if(!app||!n)return null;
 try{
  const r=await fetch(`https://rest.bandsintown.com/artists/${encodeURIComponent(n)}?app_id=${encodeURIComponent(app)}`,{headers:{Accept:'application/json','User-Agent':'STAYLOUD/5.32'}});
  if(!r.ok)return null;
  const d=await r.json();
  if(!d?.id||!d?.name)return null;
  return {
   source:'Bandsintown', bandsintownUrl:String(d.url||`https://www.bandsintown.com/a/${d.id}`).trim(),
   bandsintownId:String(d.id), name:String(d.name), imageUrl:String(d.image_url||d.thumb_url||''),
   genre:String(d.genre||''), hometown:String(d.hometown||d.city||''), country:String(d.country||''),
   description:String(d.description||''), upcomingCount:Number(d.upcoming_event_count||0)||0,
   website:String(d.website||''), facebook:String(d.facebook_page_url||'')
  };
 }catch{return null}
}

async function metalArchivesCandidates(input,limit=10){
 const q=String(input||'').trim(); if(!q)return [];
 const urls=[
  `https://www.metal-archives.com/search?searchString=${encodeURIComponent(q)}&type=band_name`,
  `https://www.metal-archives.com/search/advanced/searching/bands?bandName=${encodeURIComponent(q)}&exactBandName=1`
 ];
 const out=[];const seen=new Set();
 for(const u of urls){
  try{
   const html=await fetchText(u,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.0 (metal band search)'}},20000);
   for(const row of String(html||'').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const block=row[1];
    const m=block.match(/href=["'](https?:\/\/www\.metal-archives\.com)?(\/bands\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if(!m)continue;
    const href='https://www.metal-archives.com'+m[2];
    if(seen.has(href))continue;
    const cells=[...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>stripHtmlText(x[1]));
    const name=stripHtmlText(m[3]); if(!name)continue;
    const genre=cells.find(x=>/metal|rock|core|grind|doom|black|death|thrash|power|progressive|gothic|industrial|sludge|stoner|folk|speed|symphonic|groove/i.test(x))||'';
    const loc=cells.find(x=>x!==name && /[,/]/.test(x))||'';
    const score=candidateScore(input,{name,tags:[{name:genre}]})+120;
    seen.add(href);out.push({source:'The Metal Archives',metalArchiveUrl:href,name,style:genre,genre,area:loc,country:'',disambiguation:'The Metal Archives',type:'Group',tags:genre?[genre.toLowerCase()]:[],score:Math.round(score)});
   }
   if(out.length>=limit)break;
  }catch{}
 }
 return out.sort((a,b)=>b.score-a.score).slice(0,limit);
}

async function metalArchivesSearchEngineCandidates(input,limit=10){
 const q=String(input||'').trim(); if(!q)return [];
 const queries=[`site:metal-archives.com/bands/ "${q.replace(/"/g,'')}"`,`site:metal-archives.com/bands/ ${q.replace(/"/g,'')} metal`];
 const out=[];const seen=new Set();
 for(const query of queries){
  try{
   const html=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}`,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.1'}},20000);
   for(const m of String(html||'').matchAll(/<li[^>]*class=["'][^"']*b_algo[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href=m[1].replace(/&amp;/g,'&');
    if(!/^https?:\/\/www\.metal-archives\.com\/bands\//i.test(href)||seen.has(href))continue;
    const title=stripHtmlText(m[2]);
    if(normArtistName(title).indexOf(normArtistName(q))<0)continue;
    seen.add(href);
    let detail='';try{detail=await fetchText(href,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.1'}},15000)}catch{}
    const pick=(label)=>{const re=new RegExp(label+'\\s*:?\\s*<[^>]*>\\s*([^<]+)','i');return stripHtmlText(detail.match(re)?.[1]||'')};
    const text=stripHtmlText(detail);
    const country=(text.match(/Country of origin:\s*([^\n]+?)(?:\s+Location:|$)/i)||[])[1]?.trim()||'';
    const location=(text.match(/Location:\s*([^\n]+?)(?:\s+Status:|$)/i)||[])[1]?.trim()||'';
    const genre=(text.match(/Genre:\s*([^\n]+?)(?:\s+Themes:|$)/i)||[])[1]?.trim()||'';
    const formed=(text.match(/Formed in:\s*(\d{4})/i)||[])[1]||'';
    const status=(text.match(/Status:\s*([^\n]+?)(?:\s+Formed in:|$)/i)||[])[1]?.trim()||'';
    out.push({source:'The Metal Archives',metalArchiveUrl:href,name:q,style:genre,genre,country,area:location,beginDate:formed,disambiguation:[location,country,status].filter(Boolean).join(' · '),type:'Group',tags:genre?[genre.toLowerCase()]:[],score:Math.round(candidateScore(input,{name:q,tags:[{name:genre}]})+150)});
    if(out.length>=limit)break;
   }
  }catch{}
  if(out.length>=limit)break;
 }
 return out;
}

async function spiritOfMetalCandidates(input,limit=10){
 const q=String(input||'').trim(); if(!q)return [];
 const queries=[
  `site:spirit-of-metal.com/en/bands/ "${q.replace(/"/g,'')}"`,
  `site:spirit-of-metal.com "${q.replace(/"/g,'')}" metal band`
 ];
 const out=[];const seen=new Set();
 for(const query of queries){
  try{
   const html=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}`,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.0'}},20000);
   for(const m of String(html||'').matchAll(/<li[^>]*class=["'][^"']*b_algo[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi)){
    let href=m[1].replace(/&amp;/g,'&'); if(!/^https?:\/\/www\.spirit-of-metal\.com\//i.test(href))continue;
    if(seen.has(href))continue;
    const title=stripHtmlText(m[2]),desc=stripHtmlText(m[3]);
    const text=`${title} ${desc}`;
    if(!new RegExp(normArtistName(q).split(' ').filter(Boolean).join('.*'),'i').test(normArtistName(text)))continue;
    const country=(text.match(/-\s*([^|·]+)$/)||[])[1]?.trim()||'';
    const style=(text.match(/\b(Black|Death|Doom|Heavy|Thrash|Power|Progressive|Speed|Symphonic|Gothic|Industrial|Metalcore|Deathcore|Grind|Groove|Sludge|Stoner|Folk|Nu Metal|Alternative)\b[^|·]*/i)||[])[0]?.trim()||'';
    seen.add(href);out.push({source:'Spirit of Metal',spiritUrl:href,name:title.replace(/\s*[-|·].*$/,'').trim()||q,style,genre:style,country,disambiguation:'Spirit of Metal',type:'Group',tags:style?[style.toLowerCase()]:[],score:Math.round(candidateScore(input,{name:q,tags:[{name:style}]})+90),description:desc});
   }
  }catch{}
 }
 return out.slice(0,limit);
}

export async function searchArtistCandidates(name,limit=8){
 const raw=String(name||'').trim();
 const input=canonicalInputName(raw);
 if(!input)return [];
 const max=Math.max(1,Math.min(Number(limit)||8,12));
 let metal=await metalArchivesCandidates(input,max);
 if(metal.length===0)metal=await metalArchivesSearchEngineCandidates(input,max);
 const spirit=await spiritOfMetalCandidates(input,max);
 const queries=[`artist:"${String(input).replace(/"/g,'')}"`,`artist:${String(input).replace(/"/g,'')}`,String(input)];
 const all=[];const seen=new Set();
 for(const query of queries){
  try{const d=await mb(`${BASE}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=25&inc=tags`);for(const a of(d.artists||[])){if(a?.id&&!seen.has(a.id)){seen.add(a.id);all.push(a)}}}catch{}
 }
 const mbItems=all.map(a=>{
  const tags=(a.tags||[]).map(t=>String(t?.name||'').toLowerCase());
  return {source:'MusicBrainz',mbid:a.id,name:a.name||input,disambiguation:a.disambiguation||'',country:a.area?.name||a.country||'',beginDate:a['life-span']?.begin||'',endDate:a['life-span']?.end||'',type:a.type||'',tags,style:inferStyle(tags),score:Math.round(candidateScore(input,a)),area:a.area?.name||'',sortName:a['sort-name']||''};
 }).filter(x=>x.score>=35 && String(x.type||'').toLowerCase()==='group');
 const bi=await bandsintownIdentity(input);
 if(bi)mbItems.push({...bi,mbid:null,disambiguation:'Bandsintown',beginDate:'',endDate:'',type:'Group',country:bi.country||'',area:bi.hometown||'',style:bi.genre||'',tags:bi.genre?[bi.genre.toLowerCase()]:[],score:Math.round(candidateScore(input,{name:bi.name,tags:bi.genre?[{name:bi.genre}]:[]})+15)});
 const merged=[...metal,...spirit,...mbItems].filter(x=>String(x.type||'Group').toLowerCase()==='group' && normArtistName(x.name)===normArtistName(input));
 // Every exact-name group candidate gets the same canonical Bandsintown identity
 // when available.  This prevents the selected Metal Archives card from losing
 // the Bandsintown photo source simply because its country/style metadata differs.
 if(bi){
   for(const x of merged){
     if(!x.bandsintownUrl)x.bandsintownUrl=bi.bandsintownUrl;
     if(!x.bandsintownId)x.bandsintownId=bi.bandsintownId;
     if(!x.imageUrl)x.imageUrl=bi.imageUrl;
     if(!x.bandsintownName)x.bandsintownName=bi.name;
   }
 }
 // Never show near-matches or people such as "Dan Korn" when the user typed "Korn".
 if(!merged.length)return [];
 const rankSource=x=>x.source==='The Metal Archives'?40:x.source==='Spirit of Metal'?30:x.source==='MusicBrainz'?20:x.source==='Bandsintown'?10:0;
 const richness=x=>{
  let n=0;
  if(x.country||x.area)n+=4;
  if(x.style||x.genre)n+=4;
  if(x.beginDate)n+=3;
  if(x.endDate)n+=1;
  if(x.mbid)n+=3;
  if(x.metalArchiveUrl||x.spiritUrl)n+=2;
  if(x.disambiguation && !/^Bandsintown$/i.test(String(x.disambiguation)))n+=1;
  if(x.description)n+=1;
  return n;
 };
 // First merge exact duplicates from different providers. A sparse Bandsintown
 // identity (name + Group, but no country/style/date/MBID) must not create a
 // second card when a richer exact-name identity already exists.
 const byName=new Map();
 for(const x of merged){
  const key=normArtistName(x.name);
  if(!byName.has(key))byName.set(key,[]);
  byName.get(key).push({...x});
 }
 const compact=[];
 for(const [nameKey, list] of byName){
  const rich=list.filter(x=>richness(x)>0);
  const sparse=list.filter(x=>richness(x)===0);
  // Keep all genuinely distinct, information-rich homonyms (different country/style),
  // but discard sparse provider-only cards when a real identity is already known.
  if(rich.length){
   const groups=new Map();
   for(const x of rich){
    const idKey=x.mbid ? `mbid:${x.mbid}` : `${normArtistName(x.country||x.area||'')}|${normArtistName(x.style||x.genre||'')}|${x.beginDate||''}`;
    if(!groups.has(idKey))groups.set(idKey,[]);
    groups.get(idKey).push(x);
   }
   for(const group of groups.values()){
    group.sort((a,b)=>(richness(b)*10+Number(b.score||0)+rankSource(b))-(richness(a)*10+Number(a.score||0)+rankSource(a)));
    const best=group[0];
    for(const other of group.slice(1)){
     if(!best.mbid&&other.mbid)best.mbid=other.mbid;
     if(!best.bandsintownUrl&&other.bandsintownUrl)best.bandsintownUrl=other.bandsintownUrl;
     if(!best.bandsintownId&&other.bandsintownId)best.bandsintownId=other.bandsintownId;
     if(!best.imageUrl&&other.imageUrl)best.imageUrl=other.imageUrl;
     if(!best.description&&other.description)best.description=other.description;
    }
    compact.push(best);
   }
  }else if(sparse.length){
   // No metadata exists: retain one provider result only.
   sparse.sort((a,b)=>(Number(b.score||0)+rankSource(b))-(Number(a.score||0)+rankSource(a)));
   compact.push(sparse[0]);
  }
 }
 return compact.sort((a,b)=>{
  const sa=rankSource(a),sb=rankSource(b);
  return (Number(b.score)+sb)-(Number(a.score)+sa);
 }).slice(0,max);
}

export async function resolveByMbid(mbid){
 const id=String(mbid||'').trim(); if(!id)throw new Error('MusicBrainz : MBID manquant');
 const a=await mb(`${BASE}/artist/${encodeURIComponent(id)}?inc=tags&fmt=json`);
 if(!a?.id)throw new Error('MusicBrainz : artiste introuvable');
 const tags=(a.tags||[]).map(t=>String(t?.name||'').toLowerCase());
 return {name:a.name||'',mbid:a.id,style:inferStyle(tags),disambiguation:a.disambiguation||'',country:a.area?.name||a.country||'',beginDate:a['life-span']?.begin||''};
}

export async function resolve(name){
 const raw=String(name||"").trim();
 const input=canonicalInputName(raw);
 const queries=[
  `artist:"${String(input).replace(/"/g,"")}"`,
  `artist:${String(input).replace(/"/g,"")}`,
  String(input)
 ];
 const all=[];const seen=new Set();
 for(const query of queries){
  try{
   const q=encodeURIComponent(query); const d=await mb(`${BASE}/artist/?query=${q}&fmt=json&limit=25`);
   for(const a of (d.artists||[])){if(a?.id&&!seen.has(a.id)){seen.add(a.id);all.push(a)}}
  }catch{}
  const exact=all.find(a=>normArtistName(a.name)===normArtistName(input));
  if(exact)return {name:exact.name,mbid:exact.id,style:inferStyle((exact.tags||[]).map(t=>String(t.name||"").toLowerCase()))};
 }
 const best=all.map(a=>({a,score:candidateScore(input,a)})).sort((x,y)=>y.score-x.score)[0];
 if(!best || best.score<70)throw new Error("MusicBrainz : artiste introuvable");
 const tags=(best.a.tags||[]).map(t=>String(t.name||"").toLowerCase());
 return {name:best.a.name,mbid:best.a.id,style:inferStyle(tags)};
}
export async function fetchMusicBrainz(artist){
 let mbid=artist.mbid,canonical=artist.name;
 if(!mbid){const r=await resolve(artist.name);mbid=r.mbid;canonical=r.name;updateArtist(artist.id,{name:canonical,mbid})}
 const profile=await mb(`${BASE}/artist/${mbid}?inc=tags+url-rels&fmt=json`);
 const style=inferStyle((profile.tags||[]).map(t=>String(t.name||"").toLowerCase()));
 if(style)updateArtist(artist.id,{style});
 const events=await mb(`${BASE}/event?artist=${mbid}&fmt=json&limit=100`);
 const releases=await mb(`${BASE}/release-group?artist=${mbid}&fmt=json&limit=100`);
 providerRun("musicbrainz");
 const rels=Array.isArray(profile.relations)?profile.relations:[];
 const bandsintownUrl=rels.map(r=>String(r?.url?.resource||'')).find(u=>/bandsintown\.com\/a\//i.test(u))||'';
 const songkickUrl=rels.map(r=>String(r?.url?.resource||'')).find(u=>/songkick\.com\/artists\//i.test(u))||'';
 const officialUrl=rels.map(r=>String(r?.url?.resource||'')).find(u=>{const t=String(r?.type||'').toLowerCase();return t==='official homepage'||/official.*website|homepage|official site/.test(t)})||'';
 return {
  bandsintownUrl,
  songkickUrl,
  officialUrl,
  releases:releases["release-groups"]||[],
  events:(events.events||[]).filter(e=>String(e["life-span"]?.begin||e.date||"")>=new Date().toISOString().slice(0,10))
   .map(e=>{
    const place=e.place||{};
    const countryArea=findCountryArea(place.area);
    const x={title:e.name||"Concert",date:e["life-span"]?.begin||e.date||null,time:e.time||null,venue:place.name||"",city:place.area?.name||place.address||"",country:countryArea?.name||countryArea?.["iso-3166-1-codes"]?.[0]||"",url:"",provider:"musicbrainz"};
    return {...x,country:countryGuess(x.country,x.city,x.venue,x.title),dedupe_key:eventKey(x)}
   })
 };
}

function findCountryArea(area){
 if(!area||typeof area!=="object")return null;
 if(String(area.type||"").toLowerCase()==="country")return area;
 if(Array.isArray(area.area)){for(const a of area.area){const found=findCountryArea(a);if(found)return found}}
 if(area.area&&typeof area.area==="object"){const found=findCountryArea(area.area);if(found)return found}
 return null;
}


async function wikipediaProfile(name){
 const wanted=String(name||'').trim();
 const wantedNorm=wanted.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const musicSignals=/\b(groupe musical|groupe de musique|groupe de (?:metal|rock|hardcore|punk)|formation musicale|band|musician|musical group|metal band|rock band|hardcore band|artist|artiste musical)\b/i;
 for(const lang of ['fr','en']){
  try{
   const search=await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('intitle:"'+wanted+'" (groupe OR band OR musique OR metal OR rock)')}&srnamespace=0&srlimit=10&format=json&origin=*`,{headers:{Accept:'application/json'}},20000);
   const hits=search?.query?.search||[];
   for(const hit of hits){
    const title=String(hit.title||''); if(!title)continue;
    const d=await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=extracts|pageimages|categories&exintro=1&explaintext=1&exchars=1800&pithumbsize=1400&cllimit=20&format=json&origin=*`,{headers:{Accept:'application/json'}},20000);
    const page=Object.values(d?.query?.pages||{})[0]; if(!page)continue;
    const text=String(page.extract||'').trim();
    const cats=(page.categories||[]).map(c=>String(c.title||'').toLowerCase()).join(' ');
    const hay=(title+' '+text+' '+cats).normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
    const titleNorm=title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    // Ne jamais prendre une biographie/personnage ou une homonymie simplement parce que le nom correspond.
    const exactName=titleNorm===wantedNorm || titleNorm.startsWith(wantedNorm+' ' ) || titleNorm.includes(wantedNorm);
    const isMusic=musicSignals.test(hay)||/musique|metal|rock|hardcore|discograph|album|single|groupe/.test(cats);
    if(exactName && isMusic && text) return {title,description:text,photoUrl:String(page.thumbnail?.source||'')};
   }
  }catch{}
 }
 return {title:'',description:'',photoUrl:''};
}

const discoverPhotoCache=new Map();

function stripHtmlText(v){return String(v||'').replace(/<[^>]+>/g,' ').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function cleanImageUrl(v){let u=String(v||'').replace(/\\u002f/g,'/').replace(/\\u0026/g,'&').trim();if(!u)return '';try{u=decodeURIComponent(u)}catch{};return /^https?:\/\//i.test(u)?u:''}
function imageYear(s){const m=String(s||'').match(/(?:19|20)\d{2}/g);if(!m)return 0;return Math.max(...m.map(Number))}
function scoreImage(row,wanted,nowYear){
 const text=`${row.title} ${row.description} ${row.sourceTitle} ${row.pageTitle} ${row.sourceUrl}`.toLowerCase();
 const n=normArtistName(wanted); const tn=normArtistName(text);
 let score=0;
 if(tn.includes(n))score+=45;
 if(/\b(live|concert|festival|tour|stage|on stage|perform|performance|show|gig|scene|concerts)\b/i.test(text))score+=35;
 if(/\b(band|groupe|members|musician|artist|press photo|promo photo|official photo)\b/i.test(text))score+=16;
 if(/\b(20\d{2})\b/.test(text)){
   const y=imageYear(text); if(y)score+=Math.max(0,20-Math.min(20,nowYear-y)*4);
 }
 if(/logo|wordmark|icon|symbol|poster|flyer|wallpaper|merch|shirt|t-shirt|vinyl|cd cover|bing logo|microsoft/i.test(text))score-=90;
 if(/album cover|album art|pochette|single cover|artwork/i.test(text))score+=6;
 if(/article|news|review|interview|thumbnail|screenshot|banner/i.test(text))score-=22;
 if(row.width && row.height){const ar=row.width/Math.max(1,row.height);if(ar>=1.15&&ar<=2.2)score+=10;else if(ar<.65)score-=10;}
 if(row.thumbUrl&&row.url&&row.thumbUrl===row.url)score-=3;
 return score;
}

async function imageSearchBrave(query,limit=40){
 const key=String(process.env.BRAVE_SEARCH_API_KEY||'').trim();
 if(!key)return [];
 try{
  const u=`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${Math.max(1,Math.min(Number(limit)||40,200))}&country=ALL&search_lang=en&safesearch=strict`;
  const r=await fetch(u,{headers:{Accept:'application/json','X-Subscription-Token':key,'User-Agent':'STAYLOUD/7.0'} });
  if(!r.ok)return [];
  const d=await r.json(); const out=[];
  for(const x of Array.isArray(d?.results)?d.results:[]){
   const url=cleanImageUrl(x?.properties?.url||x?.url||x?.thumbnail?.src);
   const thumb=cleanImageUrl(x?.thumbnail?.src||x?.properties?.placeholder||url);
   if(!url||!thumb)continue;
   out.push({url,thumbUrl:thumb,title:String(x?.title||''),description:'',sourceTitle:String(x?.source||x?.meta_url?.hostname||''),pageTitle:String(x?.title||''),sourceUrl:cleanImageUrl(x?.url||''),width:Number(x?.properties?.width||x?.thumbnail?.width||0),height:Number(x?.properties?.height||x?.thumbnail?.height||0),_imageSearch:'Brave'});
  }
  return out;
 }catch{return []}
}

function decodeHtmlEntities(s){return String(s||'').replace(/&quot;/g,'"').replace(/&#34;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/gi,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function parseBingImageTag(tag,query){
 const attrs={};
 for(const m of String(tag||'').matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/gi))attrs[String(m[1]).toLowerCase()]=decodeHtmlEntities(m[3]);
 let obj=null;
 for(const k of ['m','data-m']){
  if(attrs[k]){try{obj=JSON.parse(attrs[k])}catch{try{obj=JSON.parse(attrs[k].replace(/\\"/g,'"'))}catch{}}}
  if(obj)break;
 }
 if(!obj){
  const murl=cleanImageUrl(attrs.murl||attrs['data-murl']||'');
  const turl=cleanImageUrl(attrs.turl||attrs['data-turl']||murl);
  if(!murl&&!turl)return null;
  obj={murl,turl,t:attrs.title||attrs.alt||query,purl:attrs.href||attrs.url||''};
 }
 const url=cleanImageUrl(obj.murl||obj.url||obj.contentUrl||obj.imgurl||obj.src||'');
 const thumbUrl=cleanImageUrl(obj.turl||obj.thumbnailUrl||obj.thumb||url);
 if(!url&&!thumbUrl)return null;
 return {url:url||thumbUrl,thumbUrl:thumbUrl||url,title:stripHtmlText(obj.t||obj.title||query),description:stripHtmlText(obj.desc||obj.description||''),sourceTitle:stripHtmlText(obj.p||obj.source||''),pageTitle:stripHtmlText(obj.t||obj.title||query),sourceUrl:cleanImageUrl(obj.purl||obj.pageUrl||obj.url||''),width:Number(obj.w||obj.width||0),height:Number(obj.h||obj.height||0),_imageSearch:'Bing'};
}

async function bingImageSearch(query,limit=40,first=1){
 const q=encodeURIComponent(query); const offset=Math.max(1,Number(first)||1);
 const urls=[
  `https://www.bing.com/images/search?q=${q}&form=HDRSC2&first=${offset}`,
  `https://r.jina.ai/https://www.bing.com/images/search?q=${q}&form=HDRSC2&first=${offset}`
 ];
 for(const u of urls){
  try{
   const html=await fetchText(u,{headers:{Accept:'text/html,text/plain','Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'}},20000);
   if(!html||html.length<500)continue;
   const out=[]; const seen=new Set();
   // Bing changes the order of attributes regularly. Capture the complete iusc tag first,
   // then parse its m/data-m payload instead of assuming class comes before m.
   for(const m of String(html).matchAll(/<a\b[^>]*class=["'][^"']*\biusc\b[^"']*["'][^>]*>/gi)){
    const row=parseBingImageTag(m[0],query); if(!row)continue;
    const key=cleanImageUrl(row.url)||cleanImageUrl(row.thumbUrl); if(!key||seen.has(key))continue; seen.add(key); out.push(row);
    if(out.length>=limit)break;
   }
   // Some Bing variants expose the payload on div/li elements instead of the anchor.
   if(out.length<Math.min(limit,10)){
    for(const m of String(html).matchAll(/<(?:div|li)\b[^>]*(?:data-m|m)=["'][\s\S]*?["'][^>]*>/gi)){
     const row=parseBingImageTag(m[0],query); if(!row)continue;
     const key=cleanImageUrl(row.url)||cleanImageUrl(row.thumbUrl); if(!key||seen.has(key))continue; seen.add(key); out.push(row);
     if(out.length>=limit)break;
    }
   }
   if(out.length)return out;
  }catch{}
 }
 return [];
}

async function duckDuckGoImageSearch(query,limit=40){
 try{
  const home=await fetchText(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'}},15000);
  const token=(String(home||'').match(/vqd=['"]([^'"]+)['"]/i)||String(home||'').match(/vqd=([0-9-]+)/i)||[])[1];
  if(!token)return [];
  const u=`https://duckduckgo.com/i.js?l=fr-fr&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(token)}&f=,,,,,`;
  const d=await fetchJson(u,{headers:{Accept:'application/json','Referer':'https://duckduckgo.com/','User-Agent':'Mozilla/5.0'}},15000);
  const out=[];
  for(const x of Array.isArray(d?.results)?d.results:[]){
   const url=cleanImageUrl(x?.image||x?.thumbnail); const thumb=cleanImageUrl(x?.thumbnail||url); if(!url||!thumb)continue;
   out.push({url,thumbUrl:thumb,title:String(x?.title||''),description:String(x?.title||''),sourceTitle:String(x?.source||''),pageTitle:String(x?.title||''),sourceUrl:cleanImageUrl(x?.url||''),width:Number(x?.width||0),height:Number(x?.height||0),_imageSearch:'DuckDuckGo'});
   if(out.length>=limit)break;
  }
  return out;
 }catch{return []}
}

async function imageSearch(query,limit=40,first=1){
 const brave=await imageSearchBrave(query,limit);
 if(brave.length)return brave;
 const ddg=await duckDuckGoImageSearch(query,limit);
 if(ddg.length)return ddg;
 return bingImageSearch(query,limit,first);
}

function bandsintownDateFromText(text=''){
 const raw=String(text||'');
 const iso=raw.match(/\b((?:19|20)\d{2}-\d{1,2}-\d{1,2})\b/); if(iso)return iso[1];
 const m=raw.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Z][a-z]{2,8})\s+(\d{1,2}),\s+((?:19|20)\d{2})\b/i);
 if(m){const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};const mo=months[m[1].slice(0,3).toLowerCase()];if(mo)return `${m[3]}-${String(mo).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;}
 return '';
}
function extractBandsintownImages(html,baseUrl,artistName,defaultDate=''){
 const raw=String(html||''), out=[], seen=new Set(), wanted=normArtistName(artistName);
 const add=(url,meta={})=>{
   const u=cleanImageUrl(absUrl(url,baseUrl)); if(!u||seen.has(u))return;
   const hay=normArtistName(`${meta.title||''} ${meta.description||''} ${meta.alt||''} ${meta.pageTitle||''} ${baseUrl}`);
   if(hay && !hay.includes(wanted) && !normArtistName(baseUrl).includes(wanted))return;
   seen.add(u); out.push({url:u,thumbUrl:u,title:meta.title||artistName,description:meta.description||'',sourceTitle:'Bandsintown',pageTitle:meta.pageTitle||meta.title||artistName,sourceUrl:baseUrl,width:Number(meta.width||0),height:Number(meta.height||0),date:meta.date||defaultDate,_bandsintown:true});
 };
 for(const re of [
   /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
   /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
   /<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["']/gi
 ]) for(const m of raw.matchAll(re)) add(m[1],{title:artistName,pageTitle:artistName,date:defaultDate});
 for(const m of raw.matchAll(/<img\b[^>]*>/gi)){
   const tag=m[0]; const src=(tag.match(/\b(?:src|data-src|data-original)=["']([^"']+)["']/i)||[])[1]; if(!src)continue;
   const alt=(tag.match(/\balt=["']([^"']*)["']/i)||[])[1]||'';
   const title=(tag.match(/\btitle=["']([^"']*)["']/i)||[])[1]||'';
   const date=bandsintownDateFromText(`${alt} ${title} ${raw.slice(Math.max(0,m.index-1200),m.index+1200)}`)||defaultDate;
   const metaText=stripHtmlText(`${alt} ${title}`);
   if(/artist|photo|live|concert|stage|band/i.test(`${alt} ${title}`)||/bandsintown/i.test(baseUrl)) add(src,{title:metaText||artistName,alt,description:metaText,pageTitle:metaText||artistName,date});
 }
 for(const m of raw.matchAll(/(?:"image"|"contentUrl"|"thumbnailUrl")\s*:\s*"(https?:\\?\/\\?\/[^"\\]+)"/gi)){
   const u=m[1].replace(/\\\//g,'/'); const near=raw.slice(Math.max(0,m.index-1200),m.index+1200); const date=bandsintownDateFromText(near)||defaultDate; add(u,{title:artistName,pageTitle:artistName,date});
 }
 return out;
}
async function bandsintownPhotoCandidates(artistName,explicitUrl=''){
 const artist={name:String(artistName||'').trim(),bandsintownUrl:String(explicitUrl||'').trim()};
 if(!artist.name)return [];
 let artistUrl=artist.bandsintownUrl;
 // Resolve the canonical Bandsintown identity independently from the concert engine.
 let identity=null;
 try{identity=await bandsintownIdentity(artist.name);}catch{}
 if(!artistUrl && identity?.bandsintownUrl)artistUrl=identity.bandsintownUrl;
 try{if(!artistUrl)artistUrl=await resolveBandsintown(artist);}catch{}
 if(!artistUrl||!/bandsintown\.com\/(?:fr\/)?a\/\d+/i.test(artistUrl))return [];
 const out=[],seenPages=new Set(),seenImages=new Set();
 // Bandsintown's official artist endpoint exposes the canonical artist image.
 // Keep it as a valid fallback even when the public page is JS-rendered.
 if(identity?.imageUrl){
   out.push({
     url:identity.imageUrl,thumbUrl:identity.imageUrl,title:identity.name||artist.name,
     description:identity.description||'',sourceTitle:'Bandsintown',
     pageTitle:identity.name||artist.name,sourceUrl:artistUrl,width:0,height:0,
     date:'',_bandsintown:true,_bandsintownProfile:true
   });
 }
 const addPage=async(url,defaultDate='')=>{
   if(!url||seenPages.has(url))return; seenPages.add(url);
   try{const html=await fetchText(url,{headers:{Accept:'text/html','Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8','User-Agent':'STAYLOUD/6.5'},},15000);if(!html)return;
     const found=extractBandsintownImages(html,url,artist.name,defaultDate);
     for(const x of found){const u=cleanImageUrl(x.url);if(u&&!seenImages.has(u)){seenImages.add(u);out.push(x)}}
     for(const m of html.matchAll(/https?:\/\/www\.bandsintown\.com\/e\/\d+[^\s"'<>]*/gi)){if(out.length>120)break;const u=m[0].replace(/[),.;]+$/g,''); if(!seenPages.has(u)){let d=bandsintownDateFromText(u); await addPage(u,d)}}
     for(const m of html.matchAll(/href=["'](\/e\/\d+[^"']*)["']/gi)){if(out.length>120)break;const u=absUrl(m[1],url); if(!seenPages.has(u)){let d=bandsintownDateFromText(u); await addPage(u,d)}}
   }catch{}
 };
 await addPage(artistUrl,'');

 // Bandsintown renders many live-photo galleries client-side. When those images are
 // absent from the server HTML, discover the public Bandsintown event pages through
 // Bing and fetch those pages directly. This does not touch the concert engine.
 const webQueries=[
   `site:bandsintown.com/e/ "${artist.name}" "Live Photos"`,
   `site:bandsintown.com/e/ "${artist.name}" "Live Photos" 2026`,
   `site:bandsintown.com/a/ "${artist.name}" "Live Photos"`
 ];
 for(const q of webQueries){
   try{
     const html=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(q)}`,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.5'},},15000);
     for(const m of String(html||'').matchAll(/https?:\/\/(?:www\.)?bandsintown\.com\/(?:fr\/)?e\/\d+[^\s"'<>]*/gi)){
       if(seenPages.size>=30)break;
       const u=m[0].replace(/[),.;]+$/g,'');
       if(!seenPages.has(u)) await addPage(u,bandsintownDateFromText(u));
     }
   }catch{}
 }

 // Bing Images can expose the actual Bandsintown live-photo CDN URLs even when the
 // Bandsintown page itself is JavaScript-rendered. Only accept image results whose
 // source page is Bandsintown, never generic image results from other sites.
 const imageQueries=[
   `site:bandsintown.com/e/ "${artist.name}" "Live Photos"`,
   `site:bandsintown.com/a/ "${artist.name}" "Live Photos"`,
   `site:bandsintown.com "${artist.name}" "at" "2026" "Live Photos"`
 ];
 for(const q of imageQueries){
   try{
     const hits=await bingImageSearch(q,30,1);
     for(const h of hits){
       if(!/bandsintown\.com/i.test(String(h.sourceUrl||'')))continue;
       const hay=normArtistName(`${h.title} ${h.description} ${h.sourceTitle} ${h.pageTitle}`);
       if(!hay.includes(normArtistName(artist.name)))continue;
       const date=bandsintownDateFromText(`${h.title} ${h.description} ${h.sourceTitle} ${h.pageTitle}`)||imageYear(`${h.title} ${h.description} ${h.sourceTitle} ${h.pageTitle}`)?String(imageYear(`${h.title} ${h.description} ${h.sourceTitle} ${h.pageTitle}`)):'';
       const x={...h,date,sourceTitle:'Bandsintown',_bandsintown:true,_bandsintownLive:true};
       const u=cleanImageUrl(x.url);if(u&&!seenImages.has(u)){seenImages.add(u);out.push(x)}
     }
   }catch{}
 }
 const unique=[];const seen=new Set();
 for(const x of out){const u=cleanImageUrl(x.url);if(!u||seen.has(u))continue;seen.add(u);unique.push(x)}
 return unique.slice(0,120);
}

async function sourcePageDate(url){
 const u=String(url||'').trim(); if(!/^https?:\/\//i.test(u))return '';
 try{
  const html=await fetchText(u,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.0'}},10000);
  const patterns=[
   /(?:datePublished|dateCreated|uploadDate)["'\s:]+["'](\d{4}-\d{2}-\d{2})/i,
   /(?:article:published_time|og:published_time)["'\s]+content=["']([^"']+)["']/i,
   /(?:published|publication|date)[^\d]{0,40}((?:19|20)\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})/i,
   /\b((?:19|20)\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/
  ];
  for(const re of patterns){const m=String(html).match(re);if(m?.[1]){const d=String(m[1]).replace(/\//g,'-');const y=imageYear(d);if(y>=1990&&y<=new Date().getFullYear()+1)return d}}
 }catch{}
 return '';
}


async function specializedMetalPageImages(wanted, context=''){
 const q=String(wanted||'').trim(); if(!q)return [];
 const domains=[
  'metal-archives.com/bands',
  'spirit-of-metal.com',
  'metalstorm.net',
  'metalinjection.net',
  'blabbermouth.net'
 ];
 const out=[]; const seen=new Set();
 const queries=domains.map(d=>`site:${d} "${q.replace(/"/g,'')}"`);
 for(const query of queries){
  try{
   const html=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}`,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.2 (metal photo search)'}},15000);
   for(const m of String(html||'').matchAll(/<li[^>]*class=["'][^"']*b_algo[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi)){
    const href=String(m[1]||'').replace(/&amp;/g,'&');
    if(!/^https?:\/\//i.test(href)||seen.has(href))continue;
    const title=stripHtmlText(m[2]||''); const desc=stripHtmlText(m[3]||'');
    const host=new URL(href).hostname.toLowerCase();
    if(!domains.some(d=>host.includes(d.split('/')[0])))continue;
    const hay=normArtistName(`${title} ${desc} ${href}`), wn=normArtistName(q);
    if(!hay.includes(wn))continue;
    seen.add(href);
    let page=''; try{page=await fetchText(href,{headers:{Accept:'text/html','User-Agent':'STAYLOUD/6.2'}},12000)}catch{}
    if(!page)continue;
    const imgs=[];
    const add=(u,kind='page')=>{u=cleanImageUrl(u);if(u&&!imgs.includes(u))imgs.push(u)};
    for(const re of [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
      /<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["']/gi
    ]) for(const x of page.matchAll(re)) add(x[1]);
    for(const x of page.matchAll(/(?:"image"|"contentUrl"|"thumbnailUrl")\s*:\s*"(https?:\\?\/\\?\/[^"\\]+)"/gi)) add(x[1].replace(/\\\//g,'/'));
    for(const u of imgs.slice(0,4)){
      out.push({url:u,thumbUrl:u,title,description:desc,sourceTitle:host,pageTitle:title,sourceUrl:href,width:0,height:0,date:''});
    }
   }
  }catch{}
 }
 return out;
}

async function enrichImageDates(rows){
 const top=rows.slice(0,45), results=[];
 for(let i=0;i<top.length;i+=8){
  const batch=top.slice(i,i+8);
  const part=await Promise.all(batch.map(async x=>({...x,date:String(x.date||'')||await sourcePageDate(x.sourceUrl)})));
  results.push(...part);
 }
 return results.concat(rows.slice(45));
}

export async function discoverArtistPhotos(name,limit=5,context='',options={}){
 const wanted=String(name||'').trim();
 const ctx=String(context||'').trim();
 const max=Math.max(1,Math.min(Number(limit)||5,5));
 const force=Boolean(options?.force);
 const page=Math.max(0,Number(options?.page)||0);
 const excluded=new Set((Array.isArray(options?.exclude)?options.exclude:[]).map(cleanImageUrl).filter(Boolean));
 const cacheKey=`${wanted}|${ctx}|${String(options?.bandsintownUrl||'')}|${page}`.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!force&&page===0&&excluded.size===0&&discoverPhotoCache.has(cacheKey))return discoverPhotoCache.get(cacheKey);
 const nowYear=new Date().getFullYear();
 const identity=ctx;
 const cleanCtx=identity.replace(/\s+/g,' ').trim();
 const queries=[
  `"${wanted}" ${cleanCtx} band live concert photo`,
  `"${wanted}" ${cleanCtx} live 2026 photo`,
  `"${wanted}" ${cleanCtx} official band photo`,
  `"${wanted}" ${cleanCtx} promo press photo`,
  `"${wanted}" ${cleanCtx} studio portrait band`,
  `"${wanted}" ${cleanCtx} album cover`,
  `site:bandsintown.com "${wanted}" live photos`,
  `site:metal-archives.com "${wanted}" band photo`,
  `site:spirit-of-metal.com "${wanted}" photo`,
  `site:metalstorm.net "${wanted}" photo`,
  `site:metalinjection.net "${wanted}" photo`,
  `site:blabbermouth.net "${wanted}" photo`
 ];
 const pool=[];
 // Bandsintown is the first photo source when the selected artist has a canonical
 // Bandsintown identity. We use the public artist/event pages so the existing
 // concert/API logic remains untouched.
 try{pool.push(...await bandsintownPhotoCandidates(wanted,String(options?.bandsintownUrl||'')))}catch{}
 // Then collect images from pages on metal-specialist sites themselves.
 try{pool.push(...await specializedMetalPageImages(wanted,cleanCtx))}catch{}
 // Then use image search, but bias it heavily toward specialist metal domains.
 const first=1;
 for(const q of queries){try{pool.push(...await imageSearch(q,40,first))}catch{}}
 if(pool.length<max*5){for(const q of queries.slice(0,8)){try{pool.push(...await imageSearch(q,40,41))}catch{}}}
 if(pool.length<max*8){try{
  for(const q of [`"${wanted}" metal band`,`"${wanted}" metal group`]){
   const u=`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrsort=relevance&gsrlimit=30&prop=imageinfo&iiprop=url|mime|extmetadata|size|timestamp&iiurlwidth=1000&format=json&origin=*`;
   const d=await fetchJson(u,{headers:{Accept:'application/json'}},15000);
   for(const x of Object.values(d?.query?.pages||{})){const i=x.imageinfo?.[0]||{},m=i.extmetadata||{};pool.push({url:i.url||'',thumbUrl:i.thumburl||i.url||'',title:String(x.title||'').replace(/^File:/i,''),description:stripHtmlText(m.ImageDescription?.value||''),sourceTitle:'Wikimedia Commons',pageTitle:String(x.title||''),sourceUrl:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(String(x.title||'')),width:Number(i.width||0),height:Number(i.height||0),date:String(m.DateTimeOriginal?.value||m.DateTime?.value||i.timestamp||'')})}
  }
 }catch{}
 }
 const enriched=await enrichImageDates(pool);
 const rows=enriched.map(x=>{
   const host=String(x.sourceUrl||'').toLowerCase();
   const specialist=/metal-archives\.com|spirit-of-metal\.com|metalstorm\.net|metalinjection\.net|blabbermouth\.net/.test(host);
   const bandsintown=Boolean(x._bandsintown||/bandsintown\.com/i.test(host));
   const meta=normArtistName(`${x.title} ${x.description} ${x.sourceTitle} ${x.pageTitle}`);
   let extra=specialist?35:0;
   if(bandsintown)extra+=120;
   if(meta===normArtistName(wanted))extra+=20;
   return {...x,score:scoreImage(x,wanted,nowYear)+extra+(imageYear(x.date)>=nowYear?35:0)+(imageYear(x.date)===nowYear-1?20:0)+(imageYear(x.date)>=2020?10:0),_specialist:specialist};
  })
  // The exact band name must be present in the image/page metadata. Specialist
  // metal sites get a strong preference; generic image aggregators are fallback.
  .filter(x=>x.url&&x.thumbUrl&&x.score>=12)
  .filter(x=>!/(bing|microsoft|search engine|generic logo|stock placeholder)/i.test(`${x.title} ${x.sourceTitle}`))
  .sort((a,b)=>{
   const ya=imageYear(a.date),yb=imageYear(b.date);
   if(Boolean(b._bandsintown)!==Boolean(a._bandsintown))return Boolean(b._bandsintown)?-1:1;
   if(yb!==ya)return yb-ya;
   if(Boolean(b._bandsintownLive)!==Boolean(a._bandsintownLive))return Boolean(b._bandsintownLive)?-1:1;
   if(Boolean(b._bandsintownProfile)!==Boolean(a._bandsintownProfile))return Boolean(b._bandsintownProfile)?1:-1;
   return b.score-a.score;
  });
 const out=[];const seen=new Set(excluded);
 for(const x of rows){const keys=[cleanImageUrl(x.url),cleanImageUrl(x.thumbUrl)].filter(Boolean);if(!keys.length||keys.some(k=>seen.has(k)))continue;keys.forEach(k=>seen.add(k));out.push({...x,credit:x.sourceTitle||'Recherche d’images'});if(out.length>=max)break}
 if(page===0&&excluded.size===0)discoverPhotoCache.set(cacheKey,out);
 return out;
}

export async function discoverArtistPhoto(name){
 const wanted=String(name||'').trim();
 const cacheKey=wanted.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(discoverPhotoCache.has(cacheKey))return discoverPhotoCache.get(cacheKey);
 const items=await discoverArtistPhotos(wanted,5);
 const first=items[0]?.thumbUrl||items[0]?.url||'';
 const out={photoUrl:first,description:'',title:items[0]?.title||''};
 discoverPhotoCache.set(cacheKey,out);
 return out;
}

export async function fetchArtistProfile(artist){
 let mbid=artist.mbid,canonical=artist.name;
 if(!mbid){const r=await resolve(artist.name);mbid=r.mbid;canonical=r.name;updateArtist(artist.id,{name:canonical,mbid})}
 const profile=await mb(`${BASE}/artist/${mbid}?inc=tags+url-rels&fmt=json`);
 const releases=await mb(`${BASE}/release-group?artist=${mbid}&fmt=json&limit=100`);
 const today=new Date().toISOString().slice(0,10);
 const albumGroups=(releases['release-groups']||[])
  .filter(x=>String(x['primary-type']||'').toLowerCase()==='album')
  .filter(x=>String(x['first-release-date']||'').trim())
  .filter(x=>String(x['first-release-date']).slice(0,10)<=today)
  .sort((a,b)=>String(b['first-release-date']).localeCompare(String(a['first-release-date'])));
 const wiki=await wikipediaProfile(canonical);
 const official=Array.isArray(profile.relations)?profile.relations.find(r=>String(r.type||'').toLowerCase()==='official homepage' && r.url?.resource):null;
 return {
  id:artist.id,
  name:profile.name||canonical,
  mbid,
  disambiguation:profile.disambiguation||'',
  country:profile.area?.name||'',
  formed:profile['life-span']?.begin||'',
  description:String(artist.description||'').trim()||wiki.description||'',
  photoUrl:wiki.photoUrl||'',
  photoSource:wiki.title?'Wikipédia':'',
  officialUrl:official?.url?.resource||'',
  latestAlbum:albumGroups[0]?{id:albumGroups[0].id,title:albumGroups[0].title,date:albumGroups[0]['first-release-date'],coverUrl:`https://coverartarchive.org/release-group/${albumGroups[0].id}/front-500`}:null,
  albums:albumGroups.map(x=>({id:x.id,title:x.title,date:x['first-release-date']||'',coverUrl:`https://coverartarchive.org/release-group/${x.id}/front-500`}))
 };
}

function inferStyle(tags){
 const t=tags.join(" ");
 const rules=[
  ["Deathcore",/deathcore/],["Metalcore",/metalcore/],["Post-Hardcore",/post-hardcore/],["Hardcore",/hardcore/],
  ["Nu Metal",/nu metal|nu-metal/],["Death Metal",/death metal/],["Black Metal",/black metal/],["Thrash Metal",/thrash metal/],
  ["Progressif",/progressive metal|progressive rock/],["Alternative",/alternative metal|alternative rock/],["Metal",/metal/],["Hard Rock",/hard rock/],["Rock",/rock/]
 ];
 return rules.find(([,re])=>re.test(t))?.[0]||null;
}
