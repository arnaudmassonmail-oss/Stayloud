import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";import {tmpDir} from "./helpers/tmp.js";
process.env.DB_FILE=path.join(tmpDir(),"m.sqlite");
const {sourceProblems}=await import("../src/monitor.js");
const {badCity}=await import("../src/providers/discovery.js");
const res=(id,name,rows,extra={})=>({id,name,attempts:[{via:"relais",status:200,rows,title:"page",...extra},{via:"direct",status:403,rows:0,title:"Just a moment..."}]});
test("daily check: healthy sources give no problem; Bandsintown and Ticketmaster are known limits",()=>{
  assert.deepEqual(sourceProblems([res("cm","Concerts-Metal",56),res("sdm","Sueur de Metal",56),res("sk2","Songkick",4),res("bi","Bandsintown",0),res("tm","Ticketmaster",0)]),[]);
});
test("daily check: a source that reads too few concerts, or unreadable cities, is reported",()=>{
  const p=sourceProblems([res("cm","Concerts-Metal",2),res("sdm","Sueur de Metal",40,{badCities:30,badSample:"Montaigu In Your Face Hardcore"})]);
  assert.equal(p.length,2);assert.match(p[0],/^Concerts-Metal : 2 concert/);assert.match(p[1],/ville illisible/);
});
test("bad city detection",()=>{
  assert.equal(badCity("Montaigu"),false);assert.equal(badCity("Saint-Herblain"),false);
  assert.equal(badCity("Montaigu In Your Face #6 Ignite Melodic Hardcore"),true);assert.equal(badCity(""),true);assert.equal(badCity("Nantes 2026"),true);
});
