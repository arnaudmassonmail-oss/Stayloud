// Health of the concert sources (Concerts-Metal, Sueur de Metal, Songkick,
// Bandsintown). Each live read of an agenda page is recorded; when a source
// that used to work returns nothing for more than a day (at least 3 reads in
// a row), the administrator gets one message in "Messages reçus". A new
// message is sent only after the source worked again in between.
import {d1ApiCacheGet,d1ApiCachePut} from "./d1.js";

export const SOURCE_NAMES={cm:"Concerts-Metal",sdm:"Sueur de Metal",sk2:"Songkick",bi:"Bandsintown"};
const DOWN_AFTER=24*3600e3,MIN_FAILS=3,KEY="health:sources";
let state=null,loading=null,saveTimer=null,sink=null;
export function setAlertSink(fn){sink=fn}
async function load(){
  if(state)return state;
  if(!loading)loading=(async()=>{let v=null;try{v=(await d1ApiCacheGet(KEY))?.value}catch{}state=v&&typeof v==="object"?v:{families:{}};return state})();
  return loading;
}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{d1ApiCachePut(KEY,state,Date.now()).catch(()=>{})},5000);saveTimer.unref?.()}
const familyOf=key=>String(key).split(":")[0];
export async function recordSource(key,ok,info="",now=Date.now()){
  const fam=familyOf(key);if(!SOURCE_NAMES[fam])return;
  await load();
  const f=state.families[fam]||(state.families[fam]={lastOk:0,lastFail:0,failsSinceOk:0,lastError:"",alerted:false,keys:{}});
  const k=f.keys[key]||(f.keys[key]={lastOk:0,lastFail:0,fails:0,lastError:""});
  if(ok){f.lastOk=now;f.failsSinceOk=0;f.alerted=false;k.lastOk=now;k.fails=0}
  else{f.lastFail=now;f.failsSinceOk++;f.lastError=String(info||"aucun concert lu").slice(0,200);k.lastFail=now;k.fails++;k.lastError=f.lastError}
  // Only sources that worked at least once can be "down" (a new region that
  // never answered is not an alert).
  if(!ok&&!f.alerted&&f.lastOk&&now-f.lastOk>DOWN_AFTER&&f.failsSinceOk>=MIN_FAILS){
    f.alerted=true;
    const failing=Object.entries(f.keys).filter(([,v])=>v.fails>0).map(([n])=>n.split(":").slice(1).join(":")).slice(0,12);
    const msg=`La source ${SOURCE_NAMES[fam]} ne renvoie plus aucun concert depuis le ${new Date(f.lastOk).toLocaleString("fr-FR",{timeZone:"Europe/Paris"})} (${f.failsSinceOk} lectures en échec d’affilée).\nDernière erreur : ${f.lastError}\nPages concernées : ${failing.join(", ")||"?"}\n\nLe site a peut-être changé sa présentation ou bloque le serveur. Les concerts des autres sources restent affichés. Détails : Mon compte › Administration › État des sources.`;
    try{await sink?.(`Alerte source : ${SOURCE_NAMES[fam]}`,msg)}catch(e){console.error("Source alert:",e?.message||e)}
  }
  save();
}
export async function sourcesHealth(now=Date.now()){
  await load();
  return Object.entries(SOURCE_NAMES).map(([fam,name])=>{const f=state.families[fam];
    if(!f)return {id:fam,name,status:"unknown",lastOk:0,lastFail:0,failsSinceOk:0,lastError:"",failing:[]};
    const down=f.failsSinceOk>0&&(!f.lastOk||now-f.lastOk>DOWN_AFTER)&&f.failsSinceOk>=MIN_FAILS;
    const failing=Object.entries(f.keys).filter(([,v])=>v.fails>0).map(([n,v])=>({page:n.split(":").slice(1).join(":"),fails:v.fails,lastError:v.lastError}));
    return {id:fam,name,status:down?"down":f.failsSinceOk?"warning":"ok",lastOk:f.lastOk,lastFail:f.lastFail,failsSinceOk:f.failsSinceOk,lastError:f.lastError,failing,pages:Object.keys(f.keys).length};
  });
}
// Tests only.
export function _resetHealth(s={families:{}}){state=s;loading=Promise.resolve(state)}
