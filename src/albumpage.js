// Public page of a shared album: staypit.com/album/<MusicBrainz release-group
// id> (or /album?a=<artist>&t=<title>). Preview in WhatsApp / Messenger (cover,
// title, band); opened, it shows the cover, the 30 s Deezer previews of every
// track (same player as the band page) and invites to follow the band.
import {MBID} from "./bandpage.js";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const httpUrl=u=>/^https:\/\/[^\s"'<>]+$/i.test(String(u||""))?String(u):"";
const TYPES={album:"Album",ep:"EP",single:"Single",live:"Live",compilation:"Compilation"};

export function albumPageHTML(a={},{base="",path=""}={}){
  const title=String(a.title||"Un album metal").slice(0,200),artist=String(a.artist||"").slice(0,120);
  const year=String(a.date||"").slice(0,4),kind=TYPES[String(a.type||"").toLowerCase()]||"Album";
  const cover=httpUrl(a.coverUrl)||`${base}/icon-512.png`;
  const head=`${title}${artist?" — "+artist:""}`;
  const desc=`${kind}${year?" ("+year+")":""}${artist?" de "+artist:""} : écoute les extraits sur STAYPIT, le radar metal.`;
  const amb=MBID.test(String(a.artistMbid||""))?a.artistMbid:"";
  const follow=artist?`/?follow=${encodeURIComponent(amb)}&n=${encodeURIComponent(artist)}`:"/";
  const band=artist?(amb?`/groupe/${amb}`:`/groupe?n=${encodeURIComponent(artist)}`):"";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(head)} — STAYPIT</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#070809">
<meta property="og:type" content="music.album"><meta property="og:site_name" content="STAYPIT · Radar Metal"><meta property="og:title" content="${esc(head)} 🤘">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(cover)}"><meta property="og:url" content="${esc(base+path)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
*{box-sizing:border-box}body{margin:0;background:#070809;color:#e8ebee;font:15px/1.5 Inter,Arial,Helvetica,sans-serif}
.top{display:block;background:#000}.top img{display:block;width:100%;max-width:1051px;margin:0 auto}
main{max-width:640px;margin:0 auto;padding:16px}
.cover{width:min(100%,420px);aspect-ratio:1;margin:4px auto 0;border-radius:14px;background:#111 center/cover no-repeat;border:1px solid #232a31;box-shadow:0 10px 40px rgba(0,0,0,.6)}
.kick{margin:16px 0 0;color:#ff4b55;font-weight:800;letter-spacing:2px;font-size:12px;text-transform:uppercase}
h1{font-size:25px;margin:2px 0 0;line-height:1.2}.by{margin:4px 0 14px;color:#c9d0d6;font-size:17px}.by a{color:#fff;font-weight:700}
.listen{margin:0 0 18px;padding:12px;border:1px solid #232a31;border-radius:14px;background:#0d1116}
.listen h2{font-size:16px;margin:2px 4px 10px}.listen h2 small{display:block;font-weight:400;color:#9aa4ae;font-size:12px}
.listen ol{list-style:none;margin:0;padding:0}.listen li{display:flex;align-items:center;gap:10px;padding:8px 4px;border-top:1px solid #1b2128}
.listen li:first-child{border-top:0}.listen li button{flex:none;width:38px;height:38px;border-radius:50%;border:0;background:#d4141e;color:#fff;font-size:15px;cursor:pointer}
.listen li.on button{background:#fff;color:#d4141e}.listen li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.listen li small{color:#9aa4ae}
.listen .bar{height:3px;background:#1b2128;border-radius:2px;margin-top:4px;overflow:hidden}.listen .bar i{display:block;height:100%;width:0;background:#d4141e}
.listen .dz{display:inline-block;margin:10px 4px 2px;color:#ff4b55;font-weight:700;text-decoration:none}.listen .dz[hidden]{display:none}
.listen .wait{color:#9aa4ae;margin:4px}
.btns{display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:12px;text-decoration:none;font-weight:700}
.btn.app{background:#d4141e;color:#fff}.btn.alt{background:#15191e;color:#e8ebee;border:1px solid #2c343d}
.pitch{margin-top:22px;padding:14px;border:1px solid #232a31;border-radius:14px;background:#0d1116;color:#b8c0c8}.pitch b{color:#fff}
</style></head><body>
<a class="top" href="/"><img src="/staypit-banner.jpg" alt="STAYPIT · Radar Metal"></a>
<main><div class="cover" style="background-image:url('${esc(cover)}')"></div>
<div class="kick">${esc(kind)}${year?" · "+esc(year):""}</div><h1>${esc(title)}</h1>${artist?`<div class="by">de ${band?`<a href="${esc(band)}">${esc(artist)}</a>`:esc(artist)}</div>`:""}
${artist?`<section class="listen" id="listen" data-artist="${esc(artist)}" data-album="${esc(title)}"><h2>🎧 Écouter l’album<small>extraits de 30 s</small></h2><div class="wait" id="wait">Recherche des extraits…</div><ol id="tracks"></ol><a class="dz" id="dzLink" href="#" target="_blank" rel="noopener" hidden>Écouter l’album en entier sur Deezer ↗</a></section>`:""}
<div class="btns">${artist?`<a class="btn app" href="${esc(follow)}">🤘 Suivre ${esc(artist)} sur STAYPIT</a>`:`<a class="btn app" href="/">🤘 Découvrir STAYPIT</a>`}${band?`<a class="btn alt" href="${esc(band)}">Voir le groupe</a>`:""}</div>
<div class="pitch"><b>STAYPIT · Radar Metal</b> : les actus, les sorties d’albums, les concerts près de chez toi et les clips de tes groupes préférés, au même endroit. Gratuit, sans pub.</div>
</main>${artist?`<script>
(async()=>{const box=document.getElementById('listen'),wait=document.getElementById('wait');
 try{const r=await fetch('/api/public/album-tracks?artist='+encodeURIComponent(box.dataset.artist)+'&album='+encodeURIComponent(box.dataset.album));const d=await r.json();
  if(!d.ok||!d.tracks.length){wait.textContent='Pas d’extrait disponible pour cet album.';return}wait.remove();
  const ol=document.getElementById('tracks'),audio=new Audio();let cur=null;const fmt=s=>Math.floor(s/60)+':'+String(Math.round(s%60)).padStart(2,'0');
  d.tracks.forEach((t,i)=>{const li=document.createElement('li');const b=document.createElement('button');b.type='button';b.textContent='▶';b.setAttribute('aria-label','Écouter '+t.title);
   const w=document.createElement('span');const n=document.createElement('div');n.textContent=(i+1)+'. '+t.title;const bar=document.createElement('div');bar.className='bar';bar.appendChild(document.createElement('i'));w.append(n,bar);
   const du=document.createElement('small');du.textContent=t.duration?fmt(t.duration):'';li.append(b,w,du);ol.appendChild(li);
   b.onclick=()=>{if(cur===li&&!audio.paused){audio.pause();return}if(cur){cur.classList.remove('on');cur.querySelector('button').textContent='▶';cur.querySelector('.bar i').style.width='0'}
    cur=li;li.classList.add('on');b.textContent='❚❚';audio.src=t.preview;audio.play().catch(()=>{})}});
  audio.ontimeupdate=()=>{if(cur&&audio.duration)cur.querySelector('.bar i').style.width=(100*audio.currentTime/audio.duration)+'%'};
  audio.onpause=()=>{if(cur)cur.querySelector('button').textContent='▶'};audio.onplay=()=>{if(cur)cur.querySelector('button').textContent='❚❚'};
  audio.onended=()=>{const next=cur&&cur.nextElementSibling;if(next)next.querySelector('button').click()};
  if(d.link){const a=document.getElementById('dzLink');a.href=d.link;a.hidden=false}}catch(e){wait.textContent='Extraits indisponibles pour le moment.'}})();
</script>`:""}</body></html>`;
}
