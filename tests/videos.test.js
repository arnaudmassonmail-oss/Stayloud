import test from "node:test";
import assert from "node:assert/strict";
test("videos can be posted from the concert day to 30 days after",async()=>{
  process.env.CLOUDFLARE_ACCOUNT_ID=process.env.CLOUDFLARE_ACCOUNT_ID||"";
  const src=(await import("node:fs")).readFileSync(new URL("../src/server.js",import.meta.url),"utf8");
  const fn=src.match(/export function videoWindow\(concertDay,today\)\{[^\n]*\}/)[0].replace("export ","");
  const videoWindow=new Function("VIDEO_DAYS",fn+";return videoWindow")(30);
  assert.deepEqual(videoWindow("2026-11-20","2026-11-20"),{open:true,started:true,daysLeft:30});
  assert.equal(videoWindow("2026-11-20","2026-12-20").open,true);assert.equal(videoWindow("2026-11-20","2026-12-21").open,false);
  assert.equal(videoWindow("2026-11-25","2026-11-20").started,false);assert.equal(videoWindow("","2026-11-20").open,false)});
