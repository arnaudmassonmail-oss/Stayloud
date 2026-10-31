// Public page of a shared band: staypit.com/groupe/<MusicBrainz id>
// (or /groupe?n=<name> when the band has no MusicBrainz id). Its Open Graph
// tags give WhatsApp / Messenger a preview (photo, name, STAYPIT); opened,
// it shows the band (photo, country, text, last album, upcoming concerts)
// and invites to follow it in STAYPIT.
export const MBID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const httpUrl=u=>/^https:\/\/[^\s"'<>]+$/i.test(String(u||""))?String(u):"";
const cut=(s,n)=>{s=String(s||"").replace(/\s+/g," ").trim();return s.length>n?s.slice(0,n).replace(/\s+\S*$/,"")+"…":s};
function frDate(ymd){try{return new Date(ymd+"T12:00:00Z").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"})}catch{return ymd}}

export function bandPageHTML(p={},{activity=null,base="",path=""}={}){
  const name=String(p.name||"Un groupe metal").slice(0,120);
  const img=httpUrl(p.photoUrl)||httpUrl(p.latestAlbum?.coverUrl)||`${base}/icon-512.png`;
  const meta=[p.country,p.formed?`depuis ${String(p.formed).slice(0,4)}`:""].filter(Boolean).join(" · ");
  const text=cut(p.description,420);
  const gigs=activity&&activity.total?`🎤 ${activity.total} concert${activity.total>1?"s":""} à venir`+(activity.france?` · <b>${activity.france} en France</b>${activity.nextFrance?` (dès le ${esc(frDate(activity.nextFrance.date))}${activity.nextFrance.city?", "+esc(activity.nextFrance.city):""})`:""}`:""):"";
  const desc=cut(`${name}${meta?" ("+meta+")":""} : ${p.description||"actus, albums, concerts et clips"} — partagé depuis STAYPIT, le radar metal.`,240);
  const album=p.latestAlbum&&p.latestAlbum.title?`<div class="alb">${httpUrl(p.latestAlbum.coverUrl)?`<img src="${esc(p.latestAlbum.coverUrl)}" alt="" loading="lazy" onerror="this.remove()">`:""}<div><small>Dernier album</small><b>${esc(p.latestAlbum.title)}</b>${p.latestAlbum.date?`<span>${esc(String(p.latestAlbum.date).slice(0,4))}</span>`:""}</div></div>`:"";
  const off=httpUrl(p.officialUrl);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(name)} — STAYPIT</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#070809">
<meta property="og:type" content="profile"><meta property="og:site_name" content="STAYPIT · Radar Metal"><meta property="og:title" content="${esc(name)} 🤘">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${esc(base+path)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
*{box-sizing:border-box}body{margin:0;background:#070809;color:#e8ebee;font:15px/1.5 Inter,Arial,Helvetica,sans-serif}
.top{display:block;background:#000}.top img{display:block;width:100%;max-width:1051px;margin:0 auto}
main{max-width:760px;margin:0 auto;padding:16px}
.hero{aspect-ratio:16/10;border-radius:16px;background:#111 center/cover no-repeat;border:1px solid #232a31}
h1{font-size:26px;margin:14px 0 0;letter-spacing:.5px}.meta{color:#9aa4ae;margin:2px 0 10px}
.gigs{color:#3ddc84;margin:0 0 10px}.gigs b{color:#fff}
p.txt{color:#c9d0d6;margin:0 0 14px}
.alb{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid #232a31;border-radius:14px;background:#0d1116;margin:0 0 16px}
.alb img{width:64px;height:64px;border-radius:8px;object-fit:cover}.alb small{display:block;color:#9aa4ae}.alb b{display:block}.alb span{color:#9aa4ae;font-size:13px}
.btns{display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:12px;text-decoration:none;font-weight:700}
.btn.app{background:#d4141e;color:#fff}.btn.alt{background:#15191e;color:#e8ebee;border:1px solid #2c343d}
.pitch{margin-top:22px;padding:14px;border:1px solid #232a31;border-radius:14px;background:#0d1116;color:#b8c0c8}.pitch b{color:#fff}
</style></head><body>
<a class="top" href="/"><img src="/staypit-banner.jpg" alt="STAYPIT · Radar Metal"></a>
<main><div class="hero" style="background-image:url('${esc(img)}')"></div>
<h1>${esc(name)}</h1><div class="meta">${esc(meta)}</div>${gigs?`<div class="gigs">${gigs}</div>`:""}${text?`<p class="txt">${esc(text)}</p>`:""}${album}
<div class="btns"><a class="btn app" href="/">🤘 Suivre ${esc(name)} sur STAYPIT</a>${off?`<a class="btn alt" href="${esc(off)}" target="_blank" rel="noopener">Site officiel ↗</a>`:""}</div>
<div class="pitch"><b>STAYPIT · Radar Metal</b> : les actus, les sorties d’albums, les concerts près de chez toi et les clips de tes groupes préférés, au même endroit. Gratuit, sans pub.</div>
</main></body></html>`;
}
