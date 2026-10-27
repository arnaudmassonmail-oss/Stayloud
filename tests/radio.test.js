import {test} from "node:test";import assert from "node:assert/strict";
const uu=i=>`0000000${i}-aaaa-bbbb-cccc-0000000000${String(i).padStart(2,"0")}`;
const st=(i,o={})=>({stationuuid:uu(i),name:"Station "+i,url_resolved:"https://s"+i+".example/stream",favicon:"",tags:"metal,black metal",countrycode:"us",codec:"MP3",bitrate:128,lastcheckok:1,hls:0,votes:10*i,clickcount:i,...o});
globalThis.fetch=async u=>{const s=String(u);
  if(s.includes("de1.api"))return new Response("down",{status:503});
  if(s.includes("/json/stations/search")){const tag=new URL(s).searchParams.get("tag");
    if(tag==="black metal")return Response.json([st(1),st(2,{url_resolved:"http://insecure/stream"}),st(3,{codec:"OGG"}),st(4,{lastcheckok:0}),st(5,{name:"Station 1"}),st(6,{hls:1}),st(7,{tags:"hardcore,gabber"})]);return Response.json([])}
  if(s.startsWith("https://s1.example/stream")){const title="StreamTitle='Gojira - Amazonia';";const len=Math.ceil(title.length/16);const meta=new Uint8Array(1+len*16);meta[0]=len;meta.set(new TextEncoder().encode(title),1);const body=new Uint8Array(16+meta.length);body.set(meta,16);return new Response(body,{headers:{"icy-metaint":"16"}})}
  return new Response("",{status:404})};
const R=await import("../src/providers/radio.js");
test("only stations playable in the app are kept",async()=>{const g=(await R.radioStations("Black Metal")).groups[0];assert.deepEqual(g.stations.map(s=>s.name),["Station 1"])});
test("title on air is read from the stream; unknown ids are refused",async()=>{
  assert.equal((await R.radioNowPlaying(uu(1))).title,"Gojira - Amazonia");assert.equal((await R.radioNowPlaying("../../etc/passwd")).title,null)});
