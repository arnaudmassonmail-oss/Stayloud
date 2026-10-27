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
