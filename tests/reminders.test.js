import test from "node:test";
import assert from "node:assert/strict";
import {parisDay,reminderEmail} from "../src/reminders.js";
test("tomorrow is counted in Paris time",()=>{
  assert.equal(parisDay(Date.parse("2026-11-20T23:30:00Z"),1),"2026-11-22","00:30 in Paris is already the 21st");
  assert.equal(parisDay(Date.parse("2026-11-20T10:00:00Z"),1),"2026-11-21")});
test("reminder e-mail: band, time, place, friends, tickets, route, escaping",()=>{
  const {subject,html}=reminderEmail({username:"arnaud",data:{artist:"Gojira",title:"Gojira <b>",date:"2026-11-21",time:"20:00",venue:"Halle Tony Garnier",city:"Lyon",url:"https://tm.fr/x"}},{base:"https://staypit.com",friends:["Julie"]});
  assert.equal(subject,"🤘 Demain : Gojira à Lyon");
  assert.match(html,/samedi 21 novembre · 20h00/);assert.match(html,/Halle Tony Garnier · Lyon/);assert.match(html,/Julie y va aussi/);
  assert.match(html,/href="https:\/\/tm\.fr\/x"/);assert.match(html,/google\.com\/maps\/search/);assert.ok(!html.includes("Gojira <b>"));
  assert.ok(!reminderEmail({data:{artist:"X",date:"2026-11-21",url:"javascript:alert(1)"}}).html.includes("javascript:"))});
