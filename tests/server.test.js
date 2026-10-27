// The real server (D1 emulated, no network): accounts, password-guessing
// protection, account deletion.
import {test,before,after} from "node:test";import assert from "node:assert/strict";import {spawn} from "node:child_process";import path from "node:path";import {tmpDir} from "./helpers/tmp.js";
const dir=tmpDir(),PORT=String(18000+Math.floor(Math.random()*2000)),B=`http://127.0.0.1:${PORT}`;let srv;
before(async()=>{srv=spawn(process.execPath,[new URL("./helpers/server.js",import.meta.url).pathname],{env:{...process.env,PORT,D1_EMU_FILE:path.join(dir,"d1.sqlite"),DB_FILE:path.join(dir,"local.sqlite"),REFRESH_CRON:"0 0 1 1 *"},stdio:"ignore"});
  for(let i=0;i<100;i++){try{if((await fetch(B+"/api/health")).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error("server did not start")});
after(()=>srv?.kill());
const J={"Content-Type":"application/json"};
const post=(p,body,cookie)=>fetch(B+p,{method:"POST",headers:{...J,...(cookie?{cookie}:{})},body:JSON.stringify(body)});
const cookieOf=r=>String(r.headers.get("set-cookie")||"").split(";")[0];
test("sign up, session, log in",async()=>{
  const r=await post("/api/auth/register",{username:"arnaud",email:"a@example.com",password:"secret123"});assert.equal(r.status,201);
  const me=await fetch(B+"/api/auth/me",{headers:{cookie:cookieOf(r)}});assert.equal((await me.json()).user.username,"arnaud");
  const l=await post("/api/auth/login",{username:"arnaud",password:"secret123"});assert.equal(l.status,200)});
test("password guessing is stopped after 8 wrong tries",async()=>{
  await post("/api/auth/register",{username:"bob",email:"b@example.com",password:"secret123"});
  for(let i=0;i<8;i++)assert.equal((await post("/api/auth/login",{username:"bob",password:"wrong"+i})).status,401);
  const r=await post("/api/auth/login",{username:"bob",password:"secret123"});assert.equal(r.status,429,"even the right password waits");assert.match((await r.json()).error,/Réessaie/);
  assert.equal((await post("/api/auth/login",{username:"arnaud",password:"secret123"})).status,200,"other accounts unaffected")});
test("password reset requests are limited and never reveal accounts",async()=>{
  const codes=[];for(let i=0;i<6;i++)codes.push((await post("/api/auth/forgot-password",{email:"nobody"+i+"@example.com"})).status);
  assert.deepEqual(codes,[200,200,200,200,200,429])});
let carl2="";
test("account deletion needs the password and erases the account",async()=>{
  const r=await post("/api/auth/register",{username:"carl",email:"c@example.com",password:"secret123"});const c=cookieOf(r);
  assert.equal((await post("/api/auth/delete-account",{password:"nope"},c)).status,403);
  assert.equal((await post("/api/auth/delete-account",{password:"secret123"},c)).status,200);
  assert.equal((await fetch(B+"/api/auth/me",{headers:{cookie:c}})).status,401);
  const again=await post("/api/auth/register",{username:"carl",email:"c@example.com",password:"secret123"});
  assert.equal(again.status,201,"name and e-mail are free again");carl2=cookieOf(again)});
test("sign-ups from one address are limited",async()=>{
  // arnaud, bob, carl, carl again = 4 so far; the 5th passes, the 6th waits
  assert.equal((await post("/api/auth/register",{username:"dan",email:"d@example.com",password:"secret123"})).status,201);
  assert.equal((await post("/api/auth/register",{username:"eve",email:"e@example.com",password:"secret123"})).status,429)});
test("admin-only routes are protected",async()=>{
  const a=cookieOf(await post("/api/auth/login",{username:"arnaud",password:"secret123"}));
  const s=await fetch(B+"/api/admin/sources",{headers:{cookie:a}});assert.equal(s.status,200);assert.equal((await s.json()).sources.length,4);
  assert.equal((await fetch(B+"/api/admin/sources",{headers:{cookie:carl2}})).status,403,"members are refused");
  assert.equal((await fetch(B+"/api/admin/sources")).status,401,"visitors are refused")});
test("alerts: empty at first, only valid keys can be marked seen",async()=>{
  const a=cookieOf(await post("/api/auth/login",{username:"arnaud",password:"secret123"}));
  const r=await fetch(B+"/api/alerts",{headers:{cookie:a}});assert.equal(r.status,200);const d=await r.json();assert.deepEqual([d.albums,d.concerts],[[],[]]);
  assert.equal((await post("/api/alerts/seen",{keys:["a:x","nope","c:y"]},a)).status,200);
  assert.equal((await fetch(B+"/api/alerts")).status,401)});
test("calendar: one concert as .ics, agenda feed by secret link",async()=>{
  const ev=await fetch(B+"/api/calendar/event.ics?title=Gojira&date=2026-11-02&time=20:00&city=Nantes");assert.equal(ev.status,200);assert.match(ev.headers.get("content-type"),/text\/calendar/);assert.match(await ev.text(),/SUMMARY:Gojira/);
  assert.equal((await fetch(B+"/api/calendar/event.ics?title=x")).status,400);
  const a=cookieOf(await post("/api/auth/login",{username:"arnaud",password:"secret123"}));
  const put=await fetch(B+"/api/agenda",{method:"PUT",headers:{...J,cookie:a},body:JSON.stringify({key:"2099-11-02|zenith",status:"going",data:{title:"Gojira + Mastodon",artist:"Gojira",date:"2099-11-02",venue:"Zénith",city:"Nantes"}})});assert.equal(put.status,200);
  const f=await (await fetch(B+"/api/calendar/feed",{headers:{cookie:a}})).json();assert.match(f.webcal,/^webcal:\/\/.+\/cal\/[A-Za-z0-9_-]+\.ics$/);
  const feed=await fetch(f.url);assert.equal(feed.status,200);const body=await feed.text();assert.match(body,/SUMMARY:Gojira \+ Mastodon/);assert.match(body,/X-WR-CALNAME:STAYLOUD/);
  const renewed=await (await fetch(B+"/api/calendar/feed/renew",{method:"POST",headers:{cookie:a}})).json();assert.notEqual(renewed.url,f.url);
  assert.equal((await fetch(f.url)).status,404,"old link stops working");assert.equal((await fetch(renewed.url)).status,200);
  assert.equal((await fetch(B+"/api/calendar/feed")).status,401)});
test("releases: list for the followed bands (none here), login required",async()=>{
  const a=cookieOf(await post("/api/auth/login",{username:"arnaud",password:"secret123"}));
  const r=await fetch(B+"/api/releases",{headers:{cookie:a}});assert.equal(r.status,200);assert.deepEqual((await r.json()).items,[]);
  assert.equal((await fetch(B+"/api/releases")).status,401)});
test("setlists: off without a setlist.fm key; a past concert keeps its setlist id",async()=>{
  const a=cookieOf(await post("/api/auth/login",{username:"arnaud",password:"secret123"}));
  const r=await fetch(B+"/api/setlist?artist=Gojira&date=2022-09-03&city=Nantes",{headers:{cookie:a}});assert.equal(r.status,200);assert.equal((await r.json()).configured,false);
  assert.equal((await fetch(B+"/api/setlists/search?artist=Gojira")).status,401);
  const put=await fetch(B+"/api/agenda",{method:"PUT",headers:{...J,cookie:a},body:JSON.stringify({key:"2022-09-03|zenith",status:"going",data:{title:"Gojira",artist:"Gojira",date:"2022-09-03",venue:"Zénith",city:"Nantes",provider:"setlist.fm",setlistId:"63d6b2a7"}})});assert.equal(put.status,200);
  const ag=await (await fetch(B+"/api/agenda",{headers:{cookie:a}})).json();assert.equal(ag.items.find(x=>x.key==="2022-09-03|zenith")?.data.setlistId,"63d6b2a7")});
test("videos: off without a YouTube key, login required",async()=>{
  const a=cookieOf(await post("/api/auth/login",{username:"arnaud",password:"secret123"}));
  const r=await fetch(B+"/api/videos?artist=Gojira",{headers:{cookie:a}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{configured:false,items:[]});
  assert.equal((await fetch(B+"/api/videos?artist=Gojira")).status,401)});
