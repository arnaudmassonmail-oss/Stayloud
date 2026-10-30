import {test} from "node:test";import assert from "node:assert/strict";import path from "node:path";import {tmpDir} from "./helpers/tmp.js";
process.env.DB_FILE=path.join(tmpDir(),"t.sqlite");
const m=await import("../src/providers/discovery.js");
test("same show from two sources is listed once; Songkick dates lose",()=>{
  const out=m.dedupeAcrossSources([
    {title:"Electric Callboy + Bloodywood",date:"2027-01-31",venue:"Zenith Nantes Métropole",city:"Saint-Herblain",provider:"Concerts-Metal Nantes"},
    {title:"Electric Callboy",date:"2027-02-02",venue:"Zénith de Nantes Métropole",city:"Nantes",provider:"Songkick Metal"},
    {title:"Ugly Kid Joe",date:"2027-02-02",venue:"Stereolux",city:"Nantes",provider:"Songkick Metal"},
    {title:"Ugly Kid Joe",date:"2027-02-08",venue:"Salle Maxi, Stereolux",city:"Nantes",provider:"Concerts-Metal.com"},
    {title:"The Ocean",date:"2027-01-30",venue:"Le Ferrailleur",city:"Nantes",provider:"Concerts-Metal.com"}]);
  assert.deepEqual(out.map(x=>x.date+" "+x.title).sort(),["2027-01-30 The Ocean","2027-01-31 Electric Callboy + Bloodywood","2027-02-08 Ugly Kid Joe"])});
test("Songkick page text is read",()=>{
  const md=["## dimanche 31 janvier 2027","- [Electric Callboy](https://www.songkick.com/concerts/1-electric-callboy)","Zénith de Nantes Métropole, Nantes, France","## mardi 2 février 2027","- [Ugly Kid Joe](https://www.songkick.com/concerts/2-ugly-kid-joe)","Stereolux, Nantes, France"].join("\n");
  assert.deepEqual(m.parseSongkickMetalText(md,{slug:"x",name:"Nantes"}).map(x=>x.date+" "+x.title),["2027-01-31 Electric Callboy","2027-02-02 Ugly Kid Joe"])});
test("Sueur de Metal page text is read",()=>{
  const txt=`24 OCTOBRE 2026\nGORGON [BLACK METAL]\n- MYRKVID [BLACK METAL]\n20:00\nFRÉJUS (83)\n27 OCTOBRE 2026\nMESSA [OCCULT ROCK / DOOM - ITALIE]\n- +GUEST(S)\n20:30\nAIX-EN-PROVENCE (13)`;
  const rows=m.parseSueurDeMetalText(txt,{slug:"PACA",url:"https://www.sueurdemetal.com/timeline/PACA"});
  assert.ok(rows.some(r=>r.date.startsWith("2026-10-24")&&/Gorgon/i.test(r.title)&&/Fr[ée]jus/i.test(r.city)));
  assert.ok(rows.some(r=>r.date.startsWith("2026-10-27")&&/Messa/i.test(r.title)))});
test("approved member concerts: inside the radius, never twice",()=>{
  const c={id:1,title:"Soirée Bruit Fier",bands:"Wildfire, Mark Vador",date:"2026-12-24",venue:"Salle Vincent Ansquer",city:"La Bruffière",lat:47.015,lon:-1.19};
  assert.equal(m.mergeCommunityConcerts([],[c],47.218,-1.553,50).length,1);
  assert.equal(m.mergeCommunityConcerts([],[c],47.218,-1.553,10).length,0);
  assert.equal(m.mergeCommunityConcerts([{title:"Wildfire",date:"2026-12-24",venue:"x",city:"y"}],[c],47.218,-1.553,50).length,1)});
test("sources: the free direct fetch is tried first, the paid relay only when it fails",async()=>{
  const {_firstWithRows}=await import("../src/providers/discovery.js");
  let relay=0;const rows=[{title:"x"}];
  const r1=await _firstWithRows([async()=>{relay++;return {rows}},async()=>({rows,transport:"direct"})]);
  assert.equal(r1.transport,"direct");assert.equal(relay,0);
  const r2=await _firstWithRows([async()=>({rows,transport:"jina"}),async()=>{throw new Error("HTTP 403")}]);
  assert.equal(r2.transport,"jina");
  const r3=await _firstWithRows([async()=>{throw new Error("HTTP 402")},async()=>({rows:[]})]);
  assert.deepEqual(r3.rows,[]);assert.deepEqual(r3.errors.sort(),["direct page sans concert","relais HTTP 402"]);
});
test("relay: ScraperAPI when its key is set, Jina otherwise",async()=>{
  const {relayRequest}=await import("../src/providers/discovery.js");
  const old={sk:process.env.SCRAPERAPI_KEY,pr:process.env.SCRAPERAPI_PREMIUM};
  try{
    delete process.env.SCRAPERAPI_KEY;
    const j=relayRequest("https://nantes.concerts-metal.com/");assert.equal(j.name,"Jina");assert.equal(j.target,"https://r.jina.ai/https://nantes.concerts-metal.com/");
    process.env.SCRAPERAPI_KEY="abc";delete process.env.SCRAPERAPI_PREMIUM;
    const s=relayRequest("https://nantes.concerts-metal.com/");const u=new URL(s.target);
    assert.equal(s.name,"ScraperAPI");assert.equal(u.hostname,"api.scraperapi.com");assert.equal(u.searchParams.get("api_key"),"abc");assert.equal(u.searchParams.get("url"),"https://nantes.concerts-metal.com/");assert.equal(u.searchParams.get("premium"),null);
    process.env.SCRAPERAPI_PREMIUM="1";assert.equal(new URL(relayRequest("https://x.test/").target).searchParams.get("premium"),"true");
  }finally{if(old.sk==null)delete process.env.SCRAPERAPI_KEY;else process.env.SCRAPERAPI_KEY=old.sk;if(old.pr==null)delete process.env.SCRAPERAPI_PREMIUM;else process.env.SCRAPERAPI_PREMIUM=old.pr}
});
test("find in sources: too short a query returns nothing",()=>{
  const r=m.findInSources("ab");assert.deepEqual(r.items,[]);
  const r2=m.findInSources("no matter what");assert.ok(Array.isArray(r2.items));
});
test("Concerts-Metal HTML: date line and bands in the same cell are kept apart",()=>{
  const html=`<table><tr><td><img src="x.jpg"></td><td><b>Ve 2026-11-06 (2 jours) - Le Zinor, Montaigu</b><br><a href="#">In Your Face #6</a> Melodic Hardcore <a>Murphy's Law</a> Hardcore Punk<br><a>Aurore</a> Metalcore</td></tr>
  <tr><td>Sa 2026-11-21 - Le Ferrailleur, Nantes</td><td><a>Cage Fight</a> Hardcore <a>Kabbel</a> Metal</td></tr></table>`;
  const rows=m.parseConcertsMetalHtml(html,"https://nantes.concerts-metal.com/");
  assert.equal(rows.length,2);
  assert.equal(rows[0].city,"Montaigu");assert.equal(rows[0].venue,"Le Zinor");assert.equal(rows[0].date,"2026-11-06");
  assert.doesNotMatch(rows[0].title,/2026|Zinor/);assert.match(rows[0].title,/In Your Face/);
  assert.equal(rows[1].city,"Nantes");assert.equal(rows[1].venue,"Le Ferrailleur");assert.match(rows[1].title,/Cage Fight/);
});
