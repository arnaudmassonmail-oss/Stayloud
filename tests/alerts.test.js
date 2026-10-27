import {test} from "node:test";import assert from "node:assert/strict";
import {recentAlbums,pickNew,concertKey} from "../src/alerts.js";
const NOW=Date.UTC(2026,9,27),gojira={id:1,name:"Gojira",created_at:"2025-01-01T00:00:00Z"};
const rgs=[{id:"old",title:"Fortitude","primary-type":"Album","first-release-date":"2021-04-30"},
  {id:"new",title:"Nouvel album","primary-type":"Album","first-release-date":"2026-09-12"},
  {id:"soon",title:"Annoncé","primary-type":"EP","first-release-date":"2027-02-12"},
  {id:"live",title:"Live","primary-type":"Album","secondary-types":["Live"],"first-release-date":"2026-10-01"},
  {id:"single",title:"Single","primary-type":"Single","first-release-date":"2026-10-20"}];
test("recent and announced albums / EPs only",()=>{const a=recentAlbums(gojira,rgs,NOW);
  assert.deepEqual(a.map(x=>x.title),["Annoncé","Nouvel album"]);assert.equal(a[0].upcoming,true);assert.equal(a[1].upcoming,false)});
test("first look records the starting point, later additions are new",()=>{
  const albums=new Map([[1,recentAlbums(gojira,rgs,NOW)]]),ev=[{artist_id:1,date:"2026-12-02",city:"Nantes",title:"Gojira"}];
  const first=pickNew({artists:[gojira],albumsByArtist:albums,events:ev,seen:new Set(),now:NOW});
  assert.equal(first.albums.length+first.concerts.length,0,"nothing new the first time");
  const seen=new Set(first.toMark);
  const later=pickNew({artists:[gojira],albumsByArtist:new Map([[1,recentAlbums(gojira,[...rgs,{id:"x",title:"Surprise","primary-type":"Album","first-release-date":"2026-10-25"}],NOW)]]),
    events:[...ev,{artist_id:1,date:"2027-03-10",city:"Paris",title:"Gojira + Mastodon"}],seen,now:NOW});
  assert.deepEqual(later.albums.map(x=>x.title),["Surprise"]);assert.deepEqual(later.concerts.map(x=>x.city),["Paris"]);assert.equal(later.toMark.length,0)});
test("a band just added without concerts yet waits before its starting point",()=>{
  const fresh={id:2,name:"Landmvrks",created_at:new Date(NOW-3600e3).toISOString()};
  const r=pickNew({artists:[fresh],albumsByArtist:new Map(),events:[],seen:new Set(),now:NOW});
  assert.equal(r.toMark.length,0,"nothing recorded yet");
  const r2=pickNew({artists:[fresh],albumsByArtist:new Map(),events:[{artist_id:2,date:"2027-01-05",city:"Lyon"}],seen:new Set(),now:NOW});
  assert.ok(r2.toMark.includes(concertKey("Landmvrks",{date:"2027-01-05",city:"Lyon"})),"concerts known at first load are not alerts")});
test("releases not readable yet: no album starting point",()=>{const r=pickNew({artists:[gojira],albumsByArtist:new Map(),events:[],seen:new Set(),now:NOW});assert.ok(!r.toMark.some(k=>k.startsWith("__ba:")))});
