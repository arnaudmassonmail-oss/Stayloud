import test from "node:test";
import assert from "node:assert/strict";
import {bandPageHTML,MBID} from "../src/bandpage.js";
test("band page: preview tags, concerts, album, escaping, safe links",()=>{
  const h=bandPageHTML({name:'Gojira <b>',country:"France",formed:"1996",description:"Groupe de metal landais.",photoUrl:"https://upload.wikimedia.org/g.jpg",officialUrl:"javascript:alert(1)",latestAlbum:{title:"Fortitude",date:"2021-04-30",coverUrl:"https://coverartarchive.org/x/front-500"}},
    {activity:{total:5,france:2,nextFrance:{date:"2026-12-05",city:"Lyon"}},base:"https://staypit.com",path:"/groupe/abc"});
  assert.match(h,/<meta property="og:image" content="https:\/\/upload\.wikimedia\.org\/g\.jpg">/);
  assert.match(h,/og:url" content="https:\/\/staypit\.com\/groupe\/abc"/);
  assert.match(h,/5 concerts à venir · <b>2 en France<\/b> \(dès le 5 décembre 2026, Lyon\)/);
  assert.match(h,/Fortitude/);assert.match(h,/France · depuis 1996/);
  assert.ok(!h.includes("<b>\n")&&!h.includes("Gojira <b>"),"name escaped");assert.ok(!h.includes("javascript:"),"unsafe link dropped");
  assert.match(bandPageHTML({},{base:"https://staypit.com"}),/og:image" content="https:\/\/staypit\.com\/icon-512\.png"/);
});
test("MusicBrainz ids only",()=>{assert.ok(MBID.test("5b11f4ce-a62d-471e-81fc-a69a8278c7da"));assert.ok(!MBID.test("../../x"))});
