import {XMLParser} from "fast-xml-parser";
import {fetchText,newsKey,isRelevantArtistNews} from "../utils.js";
import {providerRun} from "../db.js";

/* Tour/concert announcements are still press: they belong in Radar only when
   the article is actually about the tracked artist. */
export async function liveMentions(artist){
 const q=`"${artist.name}" (concert OR tour OR live OR dates OR Paris OR France)`;
 const url=`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
 const xml=await fetchText(url);const d=new XMLParser({ignoreAttributes:false}).parse(xml);let it=d?.rss?.channel?.item||[];if(!Array.isArray(it))it=[it];
 const out=it.map(x=>({title:String(x.title||""),url:String(x.link||""),source:String(x.source?.["#text"]||x.source||"Google News"),provider:"live-mentions",published_at:x.pubDate?new Date(x.pubDate).toISOString():null})).filter(x=>x.title&&x.url&&isRelevantArtistNews(artist,x.title,x.url)).map(x=>({...x,dedupe_key:newsKey(x)}));
 providerRun("live-mentions");return out;
}
