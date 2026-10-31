import test from "node:test";
import assert from "node:assert/strict";
import {clipPageHTML,CLIP_ID} from "../src/clippage.js";
test("clip page: preview tags, player, links, escaping",()=>{
  const h=clipPageHTML("dQw4w9WgXcQ",{title:'Gojira <script>alert(1)</script> "Live"',channel:"Gojira"},"https://staypit.com");
  assert.match(h,/<meta property="og:image" content="https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg">/);
  assert.match(h,/<meta property="og:url" content="https:\/\/staypit\.com\/clip\/dQw4w9WgXcQ">/);
  assert.match(h,/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(h,/href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.ok(!h.includes("<script>"),"title is escaped");assert.match(h,/&lt;script&gt;/);
  assert.match(clipPageHTML("dQw4w9WgXcQ",{}),/Un clip metal/);
});
test("clip ids: only YouTube video ids",()=>{
  assert.ok(CLIP_ID.test("dQw4w9WgXcQ"));assert.ok(!CLIP_ID.test("../etc/pass"));assert.ok(!CLIP_ID.test("short"));
});
