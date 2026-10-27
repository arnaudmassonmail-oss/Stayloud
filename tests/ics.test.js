import {test} from "node:test";import assert from "node:assert/strict";
import {vevent,calendar,googleCalendarUrl,validConcert} from "../src/ics.js";
const c={title:"Gojira + Mastodon",artist:"Gojira",date:"2026-11-02",time:"20:00",venue:"Zénith, Nantes; Métropole",city:"Saint-Herblain",url:"https://billets.example/gojira"};
test("a concert with a time lasts 3 hours, local time",()=>{const ics=calendar([vevent(c)]).replace(/\r\n /g,"");
  assert.match(ics,/BEGIN:VCALENDAR\r\n/);assert.match(ics,/DTSTART:20261102T200000\r\n/);assert.match(ics,/DTEND:20261102T230000\r\n/);
  assert.match(ics,/LOCATION:Zénith\\, Nantes\\; Métropole\\, Saint-Herblain/,"commas and semicolons escaped");assert.match(ics,/END:VCALENDAR\r\n$/)});
test("late concert ends the next day; no time = all-day event",()=>{
  assert.match(vevent({...c,time:"22:30"}).join("\n"),/DTEND:20261103T013000/);
  const all=vevent({...c,time:""}).join("\n");assert.match(all,/DTSTART;VALUE=DATE:20261102/);assert.match(all,/DTEND;VALUE=DATE:20261103/)});
test("long lines are folded at 75 bytes",()=>{const ics=calendar([vevent({...c,title:"X".repeat(200)})]);for(const l of ics.split("\r\n"))assert.ok(Buffer.byteLength(l)<=75,l)});
test("Google Agenda link and date check",()=>{const u=new URL(googleCalendarUrl(c));assert.equal(u.searchParams.get("dates"),"20261102T200000/20261102T230000");assert.equal(validConcert({date:"2026-11-02"}),true);assert.equal(validConcert({date:"bientôt"}),false)});
