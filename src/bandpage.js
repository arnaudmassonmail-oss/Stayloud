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
  const mbid=MBID.test(String(p.mbid||""))?p.mbid:"";
  const follow=`/?follow=${encodeURIComponent(mbid)}&n=${encodeURIComponent(name)}`;
  const al=p.latestAlbum&&p.latestAlbum.title?p.latestAlbum.title:"";
  const listen=al&&p.name?`<section class="listen" id="listen" data-artist="${esc(p.name)}" data-album="${esc(al)}" hidden><h2>🎧 Écouter « ${esc(al)} »<small>extraits de 30 s</small></h2><ol id="tracks"></ol><a class="dz" id="dzLink" href="#" target="_blank" rel="noopener" hidden>Écouter l’album en entier sur Deezer ↗</a></section>`:"";
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
.listen{margin:0 0 18px;padding:12px;border:1px solid #232a31;border-radius:14px;background:#0d1116}
.listen h2{font-size:16px;margin:2px 4px 10px}.listen h2 small{display:block;font-weight:400;color:#9aa4ae;font-size:12px}
.listen ol{list-style:none;margin:0;padding:0}.listen li{display:flex;align-items:center;gap:10px;padding:8px 4px;border-top:1px solid #1b2128}
.listen li:first-child{border-top:0}.listen li button{flex:none;width:38px;height:38px;border-radius:50%;border:0;background:#d4141e;color:#fff;font-size:15px;cursor:pointer}
.listen li.on button{background:#fff;color:#d4141e}.listen li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.listen li small{color:#9aa4ae}
.listen .bar{height:3px;background:#1b2128;border-radius:2px;margin-top:4px;overflow:hidden}.listen .bar i{display:block;height:100%;width:0;background:#d4141e}
.listen .dz{display:inline-block;margin:10px 4px 2px;color:#ff4b55;font-weight:700;text-decoration:none}
.pitch{margin-top:22px;padding:14px;border:1px solid #232a31;border-radius:14px;background:#0d1116;color:#b8c0c8}.pitch b{color:#fff}
</style></head><body>
<a class="top" href="/"><img src="/staypit-banner.jpg" alt="STAYPIT · Radar Metal"></a>
<main><div class="hero" style="background-image:url('${esc(img)}')"></div>
<h1>${esc(name)}</h1><div class="meta">${esc(meta)}</div>${gigs?`<div class="gigs">${gigs}</div>`:""}${text?`<p class="txt">${esc(text)}</p>`:""}${album}
${listen}<div class="btns"><a class="btn app" href="${esc(follow)}">🤘 Suivre ${esc(name)} sur STAYPIT</a>${off?`<a class="btn alt" href="${esc(off)}" target="_blank" rel="noopener">Site officiel ↗</a>`:""}</div>
<div class="pitch"><b>STAYPIT · Radar Metal</b> : les actus, les sorties d’albums, les concerts près de chez toi et les clips de tes groupes préférés, au même endroit. Gratuit, sans pub.</div>
</main>${listen?`<script>
(async()=>{const box=document.getElementById('listen');if(!box)return;
 try{const r=await fetch('/api/public/album-tracks?artist='+encodeURIComponent(box.dataset.artist)+'&album='+encodeURIComponent(box.dataset.album));const d=await r.json();
  if(!d.ok||!d.tracks.length)return;const ol=document.getElementById('tracks'),audio=new Audio();let cur=null;
  const fmt=s=>Math.floor(s/60)+':'+String(Math.round(s%60)).padStart(2,'0');
  d.tracks.forEach((t,i)=>{const li=document.createElement('li');const b=document.createElement('button');b.type='button';b.textContent='▶';b.setAttribute('aria-label','Écouter '+t.title);
   const w=document.createElement('span');const n=document.createElement('div');n.textContent=(i+1)+'. '+t.title;const bar=document.createElement('div');bar.className='bar';bar.appendChild(document.createElement('i'));w.append(n,bar);
   const du=document.createElement('small');du.textContent=t.duration?fmt(t.duration):'';li.append(b,w,du);ol.appendChild(li);
   b.onclick=()=>{if(cur===li&&!audio.paused){audio.pause();return}if(cur){cur.classList.remove('on');cur.querySelector('button').textContent='▶';cur.querySelector('.bar i').style.width='0'}
    cur=li;li.classList.add('on');b.textContent='❚❚';audio.src=t.preview;audio.play().catch(()=>{})}});
  audio.ontimeupdate=()=>{if(cur&&audio.duration)cur.querySelector('.bar i').style.width=(100*audio.currentTime/audio.duration)+'%'};
  audio.onpause=()=>{if(cur)cur.querySelector('button').textContent='▶'};audio.onplay=()=>{if(cur)cur.querySelector('button').textContent='❚❚'};
  audio.onended=()=>{const next=cur&&cur.nextElementSibling;if(next)next.querySelector('button').click()};
  if(d.link){const a=document.getElementById('dzLink');a.href=d.link;a.hidden=false}
  box.hidden=false}catch(e){}})();
</script>`:""}</body></html>`;
}
