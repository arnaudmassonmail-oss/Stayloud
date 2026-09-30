import {XMLParser} from "fast-xml-parser";
import {fetchJson,fetchText,newsKey,isRelevantArtistNews,parseDate} from "../utils.js";
import {providerRun} from "../db.js";

function clean(rows,artist){
 return rows
  .filter(x=>x.title&&x.url&&isRelevantArtistNews(artist,x.title,x.url,x.source,x.provider))
  .map(x=>({...x,dedupe_key:newsKey(x)}));
}

function unique(rows){
 const seen=new Set(),out=[];
 for(const x of rows){
  const k=x.dedupe_key||newsKey(x);
  if(seen.has(k))continue;
  seen.add(k);out.push({...x,dedupe_key:k});
 }
 return out;
}

function googleQueryDate(v){return parseDate(v)}

async function googleQuery(artist,query){
 const u=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`;
 const xml=await fetchText(u);
 const d=new XMLParser({ignoreAttributes:false}).parse(xml);
 let it=d?.rss?.channel?.item||[];
 if(!Array.isArray(it))it=[it];
 return it.map(x=>({
   title:String(x.title||""),
   url:String(x.link||""),
   source:String(x.source?.["#text"]||x.source||"Google News"),
   provider:"google-news",
   published_at:googleQueryDate(x.pubDate),
   image_url:String(x.enclosure?.["@_url"]||x.enclosure?.url||x["media:content"]?.["@_url"]||x["media:thumbnail"]?.["@_url"]||"")
 }));
}

/*
 * Some feeds do not expose the article publication date. In that case we
 * inspect the article page itself. We first look for standard Article/
 * NewsArticle JSON-LD and then common meta/itemprop fields.
 */
function walkDateValue(value){
 if(value==null)return null;
 if(typeof value==='string')return parseDate(value);
 if(Array.isArray(value)){for(const v of value){const d=walkDateValue(v);if(d)return d}return null}
 if(typeof value==='object'){
   for(const key of ['datePublished','dateCreated','published_time','article:published_time']){if(value[key]){const d=parseDate(value[key]);if(d)return d}}
   for(const v of Object.values(value)){const d=walkDateValue(v);if(d)return d}
 }
 return null;
}
function walkImageValue(value){
 if(!value)return '';
 if(typeof value==='string' && /^https?:\/\//i.test(value))return value;
 if(Array.isArray(value)){for(const v of value){const u=walkImageValue(v);if(u)return u}return ''}
 if(typeof value==='object'){
   for(const key of ['url','contentUrl','thumbnailUrl']){if(value[key]){const u=walkImageValue(value[key]);if(u)return u}}
   for(const v of Object.values(value)){const u=walkImageValue(v);if(u)return u}
 }
 return '';
}
function extractPageMeta(html){
 let date=null,image='';
 const jsonlds=[...String(html||'').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 for(const m of jsonlds){
   let raw=m[1].trim();
   try{const obj=JSON.parse(raw);if(!date)date=walkDateValue(obj);if(!image)image=walkImageValue(obj?.image);if(date&&image)break}
   catch{
     if(!date){const hit=raw.match(/"(?:datePublished|dateCreated)"\s*:\s*"([^"]+)"/i);if(hit)date=parseDate(hit[1])}
     if(!image){const hit=raw.match(/"(?:image|thumbnailUrl|contentUrl)"\s*:\s*"([^"]+)"/i);if(hit)image=hit[1].replace(/\\\//g,'/')}
   }
 }
 const patterns=[
  /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|publish-date|publication_date|date|datePublished)["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|og:published_time|publish-date|publication_date|date|datePublished)["']/i,
  /<[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
  /<[^>]+itemprop=["']datePublished["'][^>]*>([^<]+)</i
 ];
 if(!date)for(const re of patterns){const m=String(html||'').match(re);if(m){date=parseDate(m[1]);if(date)break}}
 if(!image){
  const ims=[
   /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
   /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::secure_url)?["']/i,
   /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
   /<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["']/i
  ];
  for(const re of ims){const m=String(html||'').match(re);if(m&&/^https?:\/\//i.test(m[1])){image=m[1];break}}
 }
 return {date,image};
}

async function enrichDates(rows,max=80){
 const out=[];let checked=0;
 for(const x of rows){
   if(!x.url || checked>=max){out.push(x);continue}
   // Fetch the article page when we still need a date or an article-specific image.
   if(x.published_at && x.image_url){out.push(x);continue}
   checked++;
   try{
     const html=await fetchText(x.url,{},10000);
     const meta=extractPageMeta(html);
     out.push({...x,published_at:x.published_at||meta.date||null,image_url:x.image_url||meta.image||''});
   }catch{out.push(x)}
 }
 return out;
}

export async function gdelt(artist){
 const q=encodeURIComponent(`"${artist.name}"`);
 const u=`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=100&format=json&timespan=${process.env.NEWS_MONTHS||3}months`;
 const d=await fetchJson(u);
 let out=clean((d.articles||[]).map(a=>({
   title:a.title||"",
   url:a.url||a.sourceurl||"",
   source:a.domain||"GDELT",
   provider:"gdelt",
   published_at:parseDate(a.seendate||a.datetime),
   image_url:String(a.socialimage||"")
 })),artist);
 out=await enrichDates(out,50);
 providerRun("gdelt");
 return unique(out);
}

export async function googleNews(artist){
 /*
  * Plusieurs requêtes complémentaires sont volontairement utilisées.
  * Une seule requête Google News peut ne pas remonter un article important
  * (départ d'un membre, changement de line-up, album, etc.).
  */
 const n=artist.name;
 const queries=[
   `"${n}"`,
   `"${n}" metal`,
   `"${n}" band`,
   `"${n}" (guitarist OR drummer OR vocalist OR singer OR member OR leaves OR left OR departure OR joins OR lineup)`,
   `"${n}" (album OR single OR EP OR tour OR touring OR festival OR concert OR show OR release)`
 ];
 const rows=[];
 for(const q of queries){
  try{rows.push(...await googleQuery(artist,q))}catch{}
 }
 let out=clean(unique(rows),artist);
 out=await enrichDates(out,60);
 providerRun("google-news");
 return out;
}
