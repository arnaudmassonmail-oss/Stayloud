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
