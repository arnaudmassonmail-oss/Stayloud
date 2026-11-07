import test from "node:test";
import assert from "node:assert/strict";
import {albumPageHTML} from "../src/albumpage.js";
test("album page: preview tags, previews player, follow link, escaping",()=>{
  const h=albumPageHTML({title:'Fortitude <i>',artist:"Gojira",artistMbid:"5b11f4ce-a62d-471e-81fc-a69a8278c7da",date:"2021-04-30",type:"Album",coverUrl:"https://coverartarchive.org/release-group/x/front-500"},{base:"https://staypit.com",path:"/album/x"});
  assert.match(h,/og:image" content="https:\/\/coverartarchive\.org\/release-group\/x\/front-500"/);
  assert.match(h,/ALBUM|Album · 2021/);assert.match(h,/\/api\/public\/album-tracks/);
  assert.match(h,/href="\/\?follow=5b11f4ce-a62d-471e-81fc-a69a8278c7da&amp;n=Gojira"/);assert.match(h,/href="\/groupe\/5b11f4ce/);
  assert.ok(!h.includes("<i>")&&h.includes("&lt;i&gt;"));
  assert.match(albumPageHTML({title:"X"},{base:"https://staypit.com"}),/icon-512\.png/);
});
