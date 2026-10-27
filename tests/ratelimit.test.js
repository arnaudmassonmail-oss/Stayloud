import {test} from "node:test";import assert from "node:assert/strict";
import {makeLimiter,waitText} from "../src/ratelimit.js";
test("blocks after max events in the window, then frees",()=>{const l=makeLimiter({max:3,windowMs:1000});
  for(let i=0;i<3;i++){assert.ok(l.allowed("a",i));l.add("a",i)}
  assert.equal(l.allowed("a",10),false);assert.ok(l.retryAfter("a",10)>=1);assert.ok(l.allowed("b",10),"other keys untouched");
  assert.ok(l.allowed("a",1001),"old events leave the window")});
test("reset clears a key",()=>{const l=makeLimiter({max:1,windowMs:1e6});l.add("x");assert.equal(l.allowed("x"),false);l.reset("x");assert.ok(l.allowed("x"))});
test("wait text",()=>{assert.equal(waitText(30),"une minute");assert.equal(waitText(600),"10 minutes")});
