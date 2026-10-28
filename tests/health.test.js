import {test} from "node:test";import assert from "node:assert/strict";
const {recordSource,sourcesHealth,setAlertSink,_resetHealth}=await import("../src/health.js");
const H=3600e3,T=Date.UTC(2026,9,1);
test("one alert when a working source fails for more than a day, again only after recovery",async()=>{
  _resetHealth();const alerts=[];setAlertSink(async(s,m)=>alerts.push(s));
  await recordSource("cm:nantes",true,"",T+0);
  await recordSource("cm:nantes",false,"HTTP 403",T+2*H);await recordSource("cm:paris",false,"HTTP 403",T+3*H);
  assert.equal(alerts.length,0,"not yet a day");
  await recordSource("cm:nantes",false,"HTTP 403",T+25*H);assert.deepEqual(alerts,["Alerte source : Concerts-Metal"]);
  await recordSource("cm:nantes",false,"HTTP 403",T+30*H);assert.equal(alerts.length,1,"no repeat");
  const h=(await sourcesHealth(T+30*H)).find(x=>x.id==="cm");assert.equal(h.status,"down");assert.equal(h.failing.length,2);
  await recordSource("cm:nantes",true,"",T+31*H);assert.equal((await sourcesHealth(T+31*H)).find(x=>x.id==="cm").status,"ok");
  for(const t of [33,40,57,58])await recordSource("cm:nantes",false,"vide",T+t*H);assert.equal(alerts.length,2,"new alert after recovery")});
test("a source that never worked does not alert; unknown families ignored",async()=>{
  _resetHealth();const alerts=[];setAlertSink(async s=>alerts.push(s));
  for(const t of [0,30,60,90])await recordSource("sk2:paris",false,"406",T+t*H);await recordSource("zz:x",false,"",T+0);
  assert.equal(alerts.length,0);assert.equal((await sourcesHealth()).length,5)});
