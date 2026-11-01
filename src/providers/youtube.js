// Clips played inside the app: a band's videos from the YouTube Data API
// (free key: YOUTUBE_API_KEY). A search costs 100 of the 10 000 daily units,
// so each band's list is cached a week (one search serves every user).
import {fetchJson} from "../utils.js";
import {cachedJson} from "../apicache.js";

const DAY=864e5;
const norm=s=>String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const decode=s=>String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
export const youtubeConfigured=()=>!!String(process.env.YOUTUBE_API_KEY||"").trim();
export const VIDEO_KINDS={clips:"official music video",live:"live"};

// Search results -> the band's videos (the band must be named in the title or
// be the channel; reactions, covers and lessons are left out).
export function pickVideos(data,band){
  const b=norm(band),seen=new Set();
  return (data?.items||[]).map(it=>({id:String(it?.id?.videoId||""),title:decode(it?.snippet?.title),channel:decode(it?.snippet?.channelTitle),published:String(it?.snippet?.publishedAt||"").slice(0,10)}))
    .filter(v=>/^[\w-]{11}$/.test(v.id)&&!seen.has(v.id)&&seen.add(v.id))
    .filter(v=>{const t=` ${norm(v.title)} `,c=norm(v.channel);return b&&(t.includes(` ${b} `)||c===b||c.startsWith(b+" ")||c.replace(/ /g,"")===b.replace(/ /g,""))})
    .filter(v=>!/\b(reaction|react|reacts|cover|guitar lesson|drum cover|tutorial|karaoke|lyrics video fan)\b/i.test(v.title))
    .slice(0,12);
}
// Newest first (order of release on YouTube); same date keeps the search order.
export function byRelease(items){return (items||[]).map((v,i)=>({v,i})).sort((a,b)=>String(b.v.published||'').localeCompare(String(a.v.published||''))||a.i-b.i).map(x=>x.v)}

// Lists prepared in the background (Clips page) may use only part of the
// day's quota, so that bands opened by hand always get their videos.
export const PREFETCH_PER_DAY=40;
let budget={day:"",prefetch:0};
export function prefetchAllowed(now=Date.now()){const day=new Date(now).toISOString().slice(0,10);if(budget.day!==day)budget={day,prefetch:0};return budget.prefetch<PREFETCH_PER_DAY}
export class PrefetchSkipped extends Error{}
export async function bandVideos({band,kind="clips",prefetch=false}){
  band=String(band||"").trim().slice(0,120);if(!VIDEO_KINDS[kind])kind="clips";
  const key=String(process.env.YOUTUBE_API_KEY||"").trim();
  if(!band||!key)return [];
  return byRelease(await cachedJson(`yt:${kind}:${norm(band)}`,v=>v?.length?7*DAY:DAY,async()=>{
    if(prefetch){if(!prefetchAllowed())throw new PrefetchSkipped("quota de préchargement atteint");budget.prefetch++}
    const p=new URLSearchParams({part:"snippet",type:"video",videoEmbeddable:"true",maxResults:"25",q:`${band} ${VIDEO_KINDS[kind]}`,key});
    const data=await fetchJson(`https://www.googleapis.com/youtube/v3/search?${p}`,{headers:{Accept:"application/json"}},10000);
    return pickVideos(data,band);
  }));
}

// "Derniers clips de tes groupes": every followed band's clips, newest first.
// Lists already known come from the cache; missing ones are searched within
// the background quota (the others show up on a later visit).
export function mergeFeed(lists,limit=80){
  const seen=new Set(),out=[];
  for(const {artist,items} of lists)for(const v of items||[])if(!seen.has(v.id)){seen.add(v.id);out.push({...v,artistId:artist.id,artist:artist.name})}
  return out.sort((a,b)=>String(b.published).localeCompare(String(a.published))).slice(0,limit);
}
export async function videoFeed(artists){
  const todo=[...(artists||[])].filter(a=>String(a?.name||"").trim()).slice(0,150),lists=[];let pending=0;
  const next=async()=>{while(todo.length){const a=todo.shift();try{lists.push({artist:a,items:await bandVideos({band:a.name,prefetch:true})})}catch{pending++}}};
  await Promise.all([next(),next(),next(),next()]);
  return {items:mergeFeed(lists),pending,bands:lists.length};
}
