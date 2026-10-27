// "Mes concerts passés": setlists from setlist.fm (free API key for
// non-commercial use: SETLISTFM_API_KEY). setlist.fm allows about 2
// requests per second, so calls go one at a time; answers are cached
// (a past setlist rarely changes) and every page links back to setlist.fm.
import {fetchJson} from "../utils.js";
import {cachedJson} from "../apicache.js";

const HOUR=3600e3,API="https://api.setlist.fm/rest/1.0";
const norm=s=>String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export const setlistConfigured=()=>!!String(process.env.SETLISTFM_API_KEY||"").trim();

let chain=Promise.resolve();
function queued(fn){const run=chain.then(fn,fn);chain=run.then(()=>new Promise(r=>setTimeout(r,600)),()=>new Promise(r=>setTimeout(r,600)));return run}
async function get(path,params){
  const key=String(process.env.SETLISTFM_API_KEY||"").trim();if(!key)throw new Error("setlist.fm n’est pas configuré");
  const url=`${API}${path}?${new URLSearchParams(params)}`;
  return queued(async()=>{try{return await fetchJson(url,{headers:{"x-api-key":key,Accept:"application/json","Accept-Language":"fr"}},12000)}
    catch(e){if(/HTTP 404/.test(String(e?.message)))return null;throw e}});
}
// "2027-01-28" <-> "28-01-2027" (setlist.fm format)
const toFm=ymd=>ymd.split("-").reverse().join("-");
const fromFm=d=>/^\d{2}-\d{2}-\d{4}$/.test(String(d||""))?String(d).split("-").reverse().join("-"):"";
function sameCity(a,b){const x=norm(a),y=norm(b);if(!x||!y)return true;return x===y||x.startsWith(y+" ")||y.startsWith(x+" ")}

// One setlist.fm setlist -> what the app shows.
export function shapeSetlist(s){
  if(!s||typeof s!=="object")return null;
  const sets=(s.sets?.set||[]).map((st,i)=>({
    name:st.encore?(st.encore>1?`Rappel ${st.encore}`:"Rappel"):String(st.name||""),
    songs:(st.song||[]).filter(x=>x&&String(x.name||"").trim()).map(x=>({name:String(x.name).trim(),cover:x.cover?.name?String(x.cover.name):"",info:String(x.info||""),tape:!!x.tape}))
  })).filter(st=>st.songs.length);
  const v=s.venue||{},c=v.city||{};
  return {id:String(s.id||""),artist:String(s.artist?.name||""),date:fromFm(s.eventDate),venue:String(v.name||""),city:String(c.name||""),country:String(c.country?.name||""),
    tour:String(s.tour?.name||""),url:String(s.url||""),songCount:sets.reduce((n,st)=>n+st.songs.filter(x=>!x.tape).length,0),sets};
}
// setlist.fm's name search is loose ("Thrown" also finds "Thrown Into Exile"):
// keep the exact band when it is there.
function sameArtist(rows,band){const b=norm(band);const exact=rows.filter(s=>norm(s.artist)===b);return exact.length?exact:rows}
// Setlists of that day -> the one in this city (or the only one).
export function pickSetlist(list,{band,city}){
  const all=sameArtist((list||[]).map(shapeSetlist).filter(Boolean),band);
  const inCity=all.filter(s=>sameCity(s.city,city));
  const pool=inCity.length?inCity:(all.length===1?all:[]);
  return pool.find(s=>s.songCount)||pool[0]||null;
}

// Setlist of one concert (band + date + city).
// A concert added from setlist.fm keeps its setlist id.
export async function findSetlist({band,date,city,id}){
  id=String(id||"").trim();
  if(/^[0-9a-f]{4,12}$/i.test(id))return cachedJson(`setlist:id:${id}`,v=>v?.songCount?14*24*HOUR:12*HOUR,async()=>shapeSetlist(await get(`/setlist/${id}`,{})));
  band=String(band||"").trim().slice(0,120);date=String(date||"").slice(0,10);city=String(city||"").trim().slice(0,80);
  if(!band||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  return cachedJson(`setlist:${norm(band)}|${date}|${norm(city)}`,v=>v?.songCount?14*24*HOUR:12*HOUR,async()=>{
    const d=await get("/search/setlists",{artistName:band,date:toFm(date)});
    return pickSetlist(d?.setlist,{band,city});
  });
}
// Past concerts of a band (to add one to "Mes concerts passés"), newest first.
export async function searchSetlists({band,page=1}){
  band=String(band||"").trim().slice(0,120);page=Math.max(1,Math.min(20,Number(page)||1));
  if(!band)return {items:[],total:0,page};
  return cachedJson(`setlists:${norm(band)}|${page}`,24*HOUR,async()=>{
    const d=await get("/search/setlists",{artistName:band,p:String(page)});
    const items=sameArtist((d?.setlist||[]).map(shapeSetlist).filter(s=>s&&s.date),band).map(({sets,...s})=>s);
    return {items,total:Number(d?.total)||items.length,page,perPage:Number(d?.itemsPerPage)||20};
  });
}
