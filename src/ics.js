// iCalendar (.ics) for "Ajouter à mon calendrier" and the agenda feed that
// phones subscribe to (RFC 5545). Times are local wall-clock times (concerts
// in France): a concert without a time is an all-day event, with a time it
// lasts 3 hours.
const esc=s=>String(s??"").replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/([,;])/g,"\\$1");
// Lines longer than 75 bytes are folded (continuation lines start with a space).
function fold(line){const out=[];let cur="";for(const ch of line){if(Buffer.byteLength(cur+ch)>(out.length?74:75)){out.push(cur);cur=ch}else cur+=ch}out.push(cur);return out.join("\r\n ")}
const pad=n=>String(n).padStart(2,"0");
const stamp=(d=new Date())=>`${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
function dayAfter(ymd){const d=new Date(ymd+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10).replace(/-/g,"")}
export function validConcert(c){return /^\d{4}-\d{2}-\d{2}$/.test(String(c?.date||"").slice(0,10))}
export function vevent(c,{uid,status}={}){
  const day=String(c.date).slice(0,10),ymd=day.replace(/-/g,"");
  const time=/^\d{2}:\d{2}/.test(String(c.time||""))?String(c.time).slice(0,5):"";
  const title=String(c.title||c.artist||"Concert").slice(0,200);
  const place=[c.venue,c.city].map(x=>String(x||"").trim()).filter(Boolean).join(", ");
  const lines=["BEGIN:VEVENT",`UID:${uid||`${ymd}-${title.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,60)}@stayloud-radar.online`}`,`DTSTAMP:${stamp()}`];
  if(time){const [h,m]=time.split(":").map(Number);const end=h+3;const endDay=end>=24?dayAfter(day):ymd;
    lines.push(`DTSTART:${ymd}T${pad(h)}${pad(m)}00`,`DTEND:${endDay}T${pad(end%24)}${pad(m)}00`)}
  else lines.push(`DTSTART;VALUE=DATE:${ymd}`,`DTEND;VALUE=DATE:${dayAfter(day)}`);
  lines.push(`SUMMARY:${esc((status==="interested"?"☆ ":"")+title)}`);
  if(place)lines.push(`LOCATION:${esc(place)}`);
  const desc=[c.artist&&c.artist!==title?`Groupe : ${c.artist}`:"",status==="going"?"Tu y vas (STAYPIT)":status==="interested"?"Intéressé (STAYPIT)":"",c.url?`Infos / billets : ${c.url}`:"","Ajouté depuis STAYPIT Radar Metal"].filter(Boolean).join("\n");
  lines.push(`DESCRIPTION:${esc(desc)}`);
  if(/^https?:\/\//i.test(String(c.url||"")))lines.push(`URL:${String(c.url).replace(/[\r\n]/g,"")}`);
  lines.push("END:VEVENT");return lines;
}
export function calendar(events,{name="STAYPIT"}={}){
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//STAYPIT//Radar Metal//FR","CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${esc(name)}`,"X-WR-TIMEZONE:Europe/Paris","REFRESH-INTERVAL;VALUE=DURATION:PT6H","X-PUBLISHED-TTL:PT6H"];
  for(const e of events)lines.push(...e);
  lines.push("END:VCALENDAR");return lines.map(fold).join("\r\n")+"\r\n";
}
// Google Agenda "add event" link (same fields).
export function googleCalendarUrl(c){
  const day=String(c.date).slice(0,10).replace(/-/g,"");const time=/^\d{2}:\d{2}/.test(String(c.time||""))?String(c.time).slice(0,5).replace(":",""):"";
  let dates;if(time){const h=Number(time.slice(0,2)),end=h+3;dates=`${day}T${time}00/${end>=24?dayAfter(String(c.date).slice(0,10)):day}T${pad(end%24)}${time.slice(2)}00`}else dates=`${day}/${dayAfter(String(c.date).slice(0,10))}`;
  const p=new URLSearchParams({action:"TEMPLATE",text:String(c.title||c.artist||"Concert"),dates,ctz:"Europe/Paris",location:[c.venue,c.city].filter(Boolean).join(", "),details:[c.url?`Infos / billets : ${c.url}`:"","Ajouté depuis STAYPIT"].filter(Boolean).join("\n")});
  return "https://calendar.google.com/calendar/render?"+p.toString();
}
