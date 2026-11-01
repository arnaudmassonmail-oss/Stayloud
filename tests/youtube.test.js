import test from "node:test";
import assert from "node:assert/strict";
import {pickVideos} from "../src/providers/youtube.js";

const it=(id,title,channel)=>({id:{videoId:id},snippet:{title,channelTitle:channel,publishedAt:"2024-05-02T10:00:00Z"}});
test("YouTube: keeps the band's own videos, drops reactions, covers and other bands",()=>{
  const data={items:[
    it("aaaaaaaaaa1","Silent Planet - Panopticon (Official Music Video)","Solid State Records"),
    it("aaaaaaaaaa2","Panopticon","Silent Planet"),
    it("aaaaaaaaaa3","Vocal coach REACTION to Silent Planet","Some Coach"),
    it("aaaaaaaaaa4","Silent Planet - Antimatter (Drum Cover)","Drummer"),
    it("aaaaaaaaaa5","Planet Hemp - Official video","Planet Hemp"),
    it("aaaaaaaaaa1","Silent Planet - Panopticon (Official Music Video)","Solid State Records"),
    it("bad","Silent Planet - x","Silent Planet"),
    it("aaaaaaaaaa6","Silent Planet &amp; Friends &#39;Live&#39;","Fan")]};
  const v=pickVideos(data,"Silent Planet");
  assert.deepEqual(v.map(x=>x.id),["aaaaaaaaaa1","aaaaaaaaaa2","aaaaaaaaaa6"]);
  assert.equal(v[2].title,"Silent Planet & Friends 'Live'");assert.equal(v[0].published,"2024-05-02");
  assert.deepEqual(pickVideos({},"Silent Planet"),[]);
});
test("YouTube: background preparation keeps most of the daily quota for bands opened by hand",async()=>{
  const {prefetchAllowed,PREFETCH_PER_DAY}=await import("../src/providers/youtube.js");
  assert.ok(PREFETCH_PER_DAY>0&&PREFETCH_PER_DAY<=50);assert.equal(prefetchAllowed(Date.parse("2026-10-27T10:00:00Z")),true);
});
test("YouTube feed: every band's clips mixed, newest first, no duplicates",async()=>{
  const {mergeFeed}=await import("../src/providers/youtube.js");
  const v=(id,published)=>({id,title:id,channel:"x",published});
  const f=mergeFeed([{artist:{id:1,name:"Gojira"},items:[v("a",  "2023-01-01"),v("b","2025-06-01")]},{artist:{id:2,name:"Thrown"},items:[v("c","2024-03-01"),v("a","2023-01-01")]}]);
  assert.deepEqual(f.map(x=>x.id),["b","c","a"]);assert.equal(f[0].artist,"Gojira");assert.equal(f[1].artistId,2);
  assert.equal(mergeFeed([{artist:{id:1,name:"G"},items:[v("a","2020"),v("b","2021")]}],1).length,1);
});
test("band clips: newest first, same date keeps search order",async()=>{
  const {byRelease}=await import("../src/providers/youtube.js");
  const r=byRelease([{id:"a",published:"2019-05-01"},{id:"b",published:"2024-02-10"},{id:"c",published:""},{id:"d",published:"2024-02-10"}]);
  assert.deepEqual(r.map(v=>v.id),["b","d","a","c"]);
});
