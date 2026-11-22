import test from "node:test";
import assert from "node:assert/strict";
import {quotas,rankBands,pickArtist,onboardingSuggestions,ONBOARD_STYLES} from "../src/onboarding.js";
test("about ten bands shared between the chosen styles",()=>{assert.deepEqual(quotas(1),[10]);assert.deepEqual(quotas(2),[5,5]);assert.deepEqual(quotas(3),[4,3,3])});
test("bands touring in France first, then touring elsewhere, then the hand-picked order",()=>{
  assert.deepEqual(rankBands(["A","B","C","D"],{C:{total:2,france:1},B:{total:15,france:0}}),["C","B","A","D"])});
test("homonyms: the band tagged with the style wins, French band for the French list",()=>{
  const l=[{id:"1",name:"Architects",score:100,tags:[{name:"pop",count:3}]},{id:"2",name:"Architects",score:95,type:"Group",tags:[{name:"metalcore",count:9}]},{id:"3",name:"Trust",score:100,country:"GB"},{id:"4",name:"Trust",score:90,country:"FR"},{id:"5",name:"Architect",score:100}];
  assert.equal(pickArtist(l,"Architects","Metalcore").id,"2");assert.equal(pickArtist(l,"Trust","Groupes français").id,"4");assert.equal(pickArtist(l,"Nobody","Rock"),null)});
test("unknown styles are ignored, at most 3 styles",async()=>{
  assert.deepEqual(await onboardingSuggestions(["Polka"]),{items:[]});
  assert.ok(Object.values(ONBOARD_STYLES).every(l=>l.length>=10),"each style has enough bands")});
test("profile: cleaned and checked (first name, age 15+, city, 1 to 3 known styles, small photo)",async()=>{
  const {cleanProfile,onboardingSuggestions}=await import("../src/onboarding.js");
  const ok=cleanProfile({firstName:" Arnaud <b> ",lastName:"Masson",age:"44",city:"Nantes",styles:["Metalcore","Polka","Deathcore","Hardcore","Punk"],photo:"data:image/jpeg;base64,AAAA"});
  assert.equal(ok.firstName,"Arnaud b");assert.equal(ok.age,44);assert.deepEqual(ok.styles,["Metalcore","Deathcore","Hardcore"]);assert.equal(ok.photo,"data:image/jpeg;base64,AAAA");
  assert.match(cleanProfile({firstName:"A",age:14,city:"X",styles:["Rock"]}).error,/15 ans/);
  assert.match(cleanProfile({firstName:"A",age:20,city:"",styles:["Rock"]}).error,/ville/);
  assert.match(cleanProfile({firstName:"A",age:20,city:"X",styles:[]}).error,/style/);
  assert.equal(cleanProfile({firstName:"A",age:20,city:"X",styles:["Rock"],photo:"javascript:alert(1)"}).photo,"");
  assert.match(cleanProfile({firstName:"A",age:20,city:"X",styles:["Rock"],photo:"data:image/png;base64,"+"A".repeat(130000)}).error,/lourde/);
  const r=await onboardingSuggestions(["Metalcore","Deathcore","Hardcore"],{perStyle:5,budgetMs:1});
  assert.equal(r.items.length,15,"5 bands per style");});
