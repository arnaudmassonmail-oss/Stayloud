// Shared cache for outside services (MusicBrainz, Deezer…): one answer serves
// every user. Kept in memory and in D1 (survives restarts / redeploys), and a
// request already running is shared instead of being sent twice. Failures are
// never cached; an expired copy is used when the service fails.
import {d1ApiCacheGet,d1ApiCachePut,d1ApiCachePrune} from "./d1.js";
const mem=new Map(),inflight=new Map();const MEM_MAX=4000,PERSIST_MAX=400000;
let nextPrune=Date.now()+10*60e3;
function remember(key,v){mem.delete(key);mem.set(key,v);if(mem.size>MEM_MAX)mem.delete(mem.keys().next().value)}
// ttlMs may be a function of the cached value (e.g. shorter for empty answers).
export async function cachedJson(key,ttlMs,fetcher,{persist=true}={}){
 const fresh=h=>Date.now()-h.at<(typeof ttlMs==='function'?ttlMs(h.value):ttlMs);
 let hit=mem.get(key);
 if(hit&&fresh(hit)){remember(key,hit);return hit.value}
 if(inflight.has(key))return inflight.get(key);
 const job=(async()=>{
  if(!hit&&persist){try{const r=await d1ApiCacheGet(key);if(r){hit=r;remember(key,r);if(fresh(r))return r.value}}catch{}}
  let value;
  try{value=await fetcher()}catch(e){if(hit)return hit.value;throw e}
  const v={value,at:Date.now()};remember(key,v);
  if(persist){let size=0;try{size=JSON.stringify(value).length}catch{}
   if(size&&size<PERSIST_MAX)d1ApiCachePut(key,value,v.at).catch(()=>{});
   if(Date.now()>nextPrune){nextPrune=Date.now()+24*3600e3;d1ApiCachePrune(Date.now()-60*864e5).catch(()=>{})}}
  return value;
 })().finally(()=>inflight.delete(key));
 inflight.set(key,job);return job;
}
