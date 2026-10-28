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
