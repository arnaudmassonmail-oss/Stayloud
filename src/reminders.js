// "Rappel la veille": every morning, each member who marked "J'y vais" for a
// concert of the next day gets an e-mail (time, venue, friends going, tickets,
// route). Sent once per member and concert; members can turn it off in
// Mon compte › Rappels de concerts (stored in api_cache: pref:remind:<id>).
import crypto from "node:crypto";
import {d1GoingConcertsOn,d1FriendIds,d1ApiCacheGet,d1ApiCachePut} from "./d1.js";

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const httpUrl=u=>/^https?:\/\/[^\s"'<>]+$/i.test(String(u||""))?String(u):"";
// Calendar day in Paris, `days` after `now`.
export function parisDay(now=Date.now(),days=0){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
  const d=new Date(p+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
export async function remindersEnabled(userId){try{const v=(await d1ApiCacheGet(`pref:remind:${Number(userId)}`))?.value;return !(v&&v.off)}catch{return true}}
export async function setRemindersEnabled(userId,on){await d1ApiCachePut(`pref:remind:${Number(userId)}`,{off:!on},Date.now())}

export function reminderEmail(r,{base="",friends=[]}={}){
  const c=r.data||{},band=String(c.artist||c.title||"Ton concert"),title=String(c.title||"");
  const when=new Date(String(c.date).slice(0,10)+"T12:00:00Z").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"});
  const time=/^\d{2}:\d{2}/.test(String(c.time||""))?String(c.time).slice(0,5).replace(":","h"):"";
  const place=[c.venue,c.city].map(x=>String(x||"").trim()).filter(Boolean).join(" · ");
  const maps=place?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.venue,c.city].filter(Boolean).join(", "))}`:"";
  const url=httpUrl(c.url);
  const who=friends.length?`<p style="margin:0 0 14px;padding:10px 12px;border-radius:10px;background:rgba(46,204,113,.12);color:#7dffb0">🤘 ${friends.map(esc).join(", ")} ${friends.length>1?"y vont":"y va"} aussi !</p>`:"";
  const btn=(href,label,main)=>`<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 16px;border-radius:10px;text-decoration:none;font-weight:bold;${main?"background:#d4141e;color:#fff":"background:#15191e;color:#e8ebee;border:1px solid #2c343d"}">${label}</a>`;
  const subject=`🤘 Demain : ${band}${c.city?" à "+c.city:""}`;
  const html=`<div style="background:#050607;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#e8ebee"><div style="max-width:480px;margin:0 auto;background:#0d1116;border:1px solid #2a333d;border-radius:14px;overflow:hidden">${base?`<img src="${esc(base)}/staypit-banner.png" alt="STAYPIT Radar Metal" width="480" style="display:block;width:100%;height:auto">`:""}<div style="padding:22px">
<p style="margin:0 0 6px">Salut ${esc(String(r.username||"").replace(/^./,c=>c.toUpperCase()))},</p><p style="margin:0 0 16px">c’est <b>demain</b> ! N’oublie pas ton concert :</p>
<p style="margin:0 0 4px;font-size:24px;font-weight:bold;color:#ff2733">${esc(band)}</p>${title&&title!==band?`<p style="margin:0 0 8px;font-weight:bold">${esc(title)}</p>`:""}
<p style="margin:0 0 4px">📅 ${esc(when)}${time?` · ${esc(time)}`:""}</p>${place?`<p style="margin:0 0 14px">📍 ${esc(place)}</p>`:""}${who}
<div style="margin:6px 0 4px">${url?btn(url,"🎫 Infos / billets",true):""}${maps?btn(maps,"🗺 Itinéraire"):""}${base?btn(base,"Ouvrir STAYPIT"):""}</div>
<p style="margin:18px 0 0;font-size:12px;color:#8b949e">Tu reçois ce rappel parce que tu as indiqué « J’y vais » pour ce concert. Pour ne plus recevoir ces rappels : Mon compte › Rappels de concerts.</p></div></div></div>`;
  return {subject,html};
}

async function send(to,{subject,html}){
  const apiKey=String(process.env.RESEND_API_KEY||"").trim(),from=String(process.env.EMAIL_FROM||"").trim();
  if(!apiKey||!from)throw new Error("RESEND_API_KEY / EMAIL_FROM manquants");
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html})});
  if(!r.ok){let why="";try{why=(await r.text()).slice(0,200)}catch{}throw new Error(`Resend HTTP ${r.status} ${why}`)}
}

export async function runConcertReminders({now=Date.now(),day=parisDay(now,1),force=false,onlyUser=null}={}){
  const base=String(process.env.APP_PUBLIC_URL||"").replace(/\/$/,"");
  const rows=(await d1GoingConcertsOn(day)).filter(r=>onlyUser==null||r.userId===Number(onlyUser));
  const out={day,concerts:rows.length,sent:0,skipped:0,errors:[]};
  const friendsOf=new Map();
  for(const r of rows){
    try{
      if(!r.email||!/@/.test(r.email)){out.skipped++;continue}
      if(!(await remindersEnabled(r.userId))){out.skipped++;continue}
      const key=`remind:sent:${r.userId}:${crypto.createHash("sha1").update(r.ckey).digest("hex").slice(0,16)}:${day}`;
      if(!force&&(await d1ApiCacheGet(key))){out.skipped++;continue}
      if(!friendsOf.has(r.userId))friendsOf.set(r.userId,new Set(await d1FriendIds(r.userId)));
      const fr=friendsOf.get(r.userId),friends=rows.filter(x=>x.ckey===r.ckey&&x.userId!==r.userId&&fr.has(x.userId)).map(x=>x.username);
      await send(r.email,reminderEmail(r,{base,friends}));
      await d1ApiCachePut(key,{at:now},now);out.sent++;
    }catch(e){out.errors.push(String(e?.message||e).slice(0,200))}
  }
  if(out.errors.length)console.error("Concert reminders:",out.errors.join(" | "));
  return out;
}
