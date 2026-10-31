// Public page of a shared clip: staypit.com/clip/<YouTube id>.
// WhatsApp, Messenger… read its Open Graph tags to show a preview (clip
// thumbnail, title, STAYPIT); opened, it plays the clip for anyone, with a
// link to YouTube and one to the app. Title and channel come from YouTube's
// free oEmbed service (no key), cached a week.
import {fetchJson} from "./utils.js";
import {cachedJson} from "./apicache.js";

export const CLIP_ID=/^[\w-]{11}$/;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export async function clipMeta(id){
  if(!CLIP_ID.test(id))return null;
  try{return await cachedJson(`clip:oembed:${id}`,v=>v?.title?7*864e5:36e5,async()=>{
    const d=await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v="+id)}`,{headers:{Accept:"application/json"}},8000);
    return {title:String(d?.title||"").slice(0,200),channel:String(d?.author_name||"").slice(0,120)};
  })}catch{return {title:"",channel:""}}
}

export function clipPageHTML(id,{title="",channel=""}={},base=""){
  const yt=`https://www.youtube.com/watch?v=${id}`,img=`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,url=`${base}/clip/${id}`;
  const name=title||"Un clip metal";
  const desc=`${channel?channel+" · ":""}Clip partagé depuis STAYPIT, le radar metal : actus, concerts et clips de tes groupes.`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(name)} — STAYPIT</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#070809">
<meta property="og:type" content="video.other"><meta property="og:site_name" content="STAYPIT · Radar Metal"><meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="480"><meta property="og:image:height" content="360">
<meta property="og:url" content="${esc(url)}"><meta property="og:video" content="https://www.youtube.com/embed/${id}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
*{box-sizing:border-box}body{margin:0;background:#070809;color:#e8ebee;font:15px/1.45 Inter,Arial,Helvetica,sans-serif}
.top{display:block;background:#000}.top img{display:block;width:100%;max-width:1051px;margin:0 auto}
main{max-width:860px;margin:0 auto;padding:16px}
.frame{position:relative;aspect-ratio:16/9;background:#000 center/cover no-repeat;border-radius:14px;overflow:hidden;border:1px solid #232a31}
.frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
h1{font-size:19px;margin:14px 0 2px}.ch{color:#9aa4ae;margin:0 0 16px}
.btns{display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:12px;text-decoration:none;font-weight:700}
.btn.app{background:#d4141e;color:#fff}.btn.yt{background:#15191e;color:#e8ebee;border:1px solid #2c343d}
.pitch{margin-top:22px;padding:14px;border:1px solid #232a31;border-radius:14px;background:#0d1116;color:#b8c0c8}.pitch b{color:#fff}
</style></head><body>
<a class="top" href="/"><img src="/staypit-banner.jpg" alt="STAYPIT · Radar Metal"></a>
<main><div class="frame" style="background-image:url('${esc(img)}')"><iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1" title="${esc(name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
<h1>${esc(name)}</h1>${channel?`<p class="ch">${esc(channel)}</p>`:'<p class="ch"></p>'}
<div class="btns"><a class="btn app" href="/">🤘 Découvrir STAYPIT</a><a class="btn yt" href="${esc(yt)}" target="_blank" rel="noopener">▶ Voir sur YouTube</a></div>
<div class="pitch"><b>STAYPIT · Radar Metal</b> : les actus, les sorties d’albums, les concerts près de chez toi et les clips de tes groupes préférés, au même endroit. Gratuit, sans pub.</div>
</main></body></html>`;
}
