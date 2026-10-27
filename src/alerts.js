// "Nouvel album" / "Nouveau concert" alerts for the bands a user follows.
// An alert is new until the user has seen it (keys kept in D1). The first
// time a band is looked at, what it already has is recorded as seen: only
// albums and concerts announced afterwards raise an alert.
const DAY=864e5;
const norm=s=>String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export const albumKey=rg=>"a:"+rg.id;
export const concertKey=(artist,e)=>"c:"+[norm(artist),String(e.date||"").slice(0,10),norm(e.city)].join("|");
const albumBase=artist=>"__ba:"+norm(artist),concertBase=artist=>"__bc:"+norm(artist);

// Albums and EPs released in the last 4 months, or announced for the next year.
export function recentAlbums(artist,releaseGroups,now=Date.now()){
  const from=new Date(now-120*DAY).toISOString().slice(0,10),to=new Date(now+365*DAY).toISOString().slice(0,10),today=new Date(now).toISOString().slice(0,10);
  return (releaseGroups||[]).filter(rg=>{const t=String(rg["primary-type"]||"").toLowerCase(),d=String(rg["first-release-date"]||"").slice(0,10);
      const sec=(rg["secondary-types"]||[]).map(x=>String(x).toLowerCase());
      return rg.id&&(t==="album"||t==="ep")&&!sec.some(x=>/compilation|live|remix|demo/.test(x))&&d.length>=7&&d>=from&&d<=to})
    .map(rg=>{const d=String(rg["first-release-date"]).slice(0,10);return {key:albumKey(rg),type:"album",artistId:artist.id,artist:artist.name,title:rg.title,kind:String(rg["primary-type"]),date:d,upcoming:d>today,coverUrl:`https://coverartarchive.org/release-group/${rg.id}/front-250`}})
    .sort((a,b)=>b.date.localeCompare(a.date));
}
// Decide what is new. albumsByArtist: Map(artist.id -> albums | null when the
// releases could not be read yet). Returns the new items and the keys to
// record as seen (first look at a band).
export function pickNew({artists,albumsByArtist,events,seen,now=Date.now()}){
  const toMark=[],albums=[],concerts=[];
  for(const a of artists){
    const list=albumsByArtist.get(a.id);
    if(list){
      if(!seen.has(albumBase(a.name))){toMark.push(albumBase(a.name),...list.map(x=>x.key))}
      else albums.push(...list.filter(x=>!seen.has(x.key)));
    }
    const evs=events.filter(e=>Number(e.artist_id)===Number(a.id));
    if(!seen.has(concertBase(a.name))){
      // A band just added may not have its concerts loaded yet: wait a day
      // (or until some are known) before recording its starting point.
      const added=Date.parse(a.created_at||"")||0;
      if(evs.length||now-added>DAY)toMark.push(concertBase(a.name),...evs.map(e=>concertKey(a.name,e)));
    }else for(const e of evs){const k=concertKey(a.name,e);if(!seen.has(k))concerts.push({key:k,type:"concert",artistId:a.id,artist:a.name,title:e.title,date:e.date,time:e.time||null,venue:e.venue||"",city:e.city||"",country:e.country||"France",url:e.url||"",provider:e.provider||""})}
  }
  return {albums,concerts,toMark};
}
