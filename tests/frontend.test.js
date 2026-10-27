// public/index.html is one big page: check its scripts parse and that every
// menu entry leads to a screen that exists (a lost screen once shipped).
import {test} from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
test("inline scripts have no syntax error",()=>{assert.ok(scripts.length>0);for(const [i,c] of scripts.entries())assert.doesNotThrow(()=>new Function(c),`script #${i}`)});
test("every helpGo('x') / openHelpSheet('x') has a screen",()=>{
  const views=new Set([...html.matchAll(/view==='(\w+)'/g)].map(m=>m[1]));
  const used=new Set([...html.matchAll(/(?:helpGo|openHelpSheet)\(\\?'(\w+)\\?'\)/g)].map(m=>m[1]));
  assert.ok(used.size>5);for(const v of used)assert.ok(views.has(v),`missing screen "${v}"`)});
test("every navigation target is a section",()=>{
  const sections=new Set([...html.matchAll(/<section id="([\w-]+)"/g)].map(m=>m[1]));
  const targets=new Set([...html.matchAll(/data-s="([\w-]+)"/g),...html.matchAll(/show\(\\?'([\w-]+)\\?'\)/g)].map(m=>m[1]));
  for(const t of targets)assert.ok(sections.has(t),`no section #${t}`)});
test("bottom bar has the 5 tabs",()=>{const m=html.match(/<div class="mobile-bottom">([\s\S]*?)<\/div>/);assert.ok(m);
  const labels=[...m[1].matchAll(/class="nav-label">([^<]+)</g)].map(x=>x[1]);assert.deepEqual(labels,["Actus","Concerts","Écouter","Groupes","Communauté"])});
test("privacy page names the publisher and contact",()=>{const p=fs.readFileSync(new URL("../public/confidentialite.html",import.meta.url),"utf8");assert.match(p,/Arnaud Masson/);assert.match(p,/contact@stayloud-radar\.online/)});
test("concert cards have the ticket button, ticketing sites are recognised",()=>{
  assert.match(html,/\$\{ticketBtnHTML\(x\)\}/);
  const m=html.match(/const TICKET_HOSTS=(\/.*\/i);/);assert.ok(m);const re=eval(m[1]);
  for(const h of ["helloasso.com","fnacspectacles.com","ticketmaster.fr","dice.fm","weezevent.com"])assert.ok(re.test(h),h);
  for(const h of ["songkick.com","bandsintown.com","concerts-metal.com"])assert.ok(!re.test(h),h)});
