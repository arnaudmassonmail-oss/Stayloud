import test from "node:test";
import assert from "node:assert/strict";
import {shapeSetlist,pickSetlist} from "../src/providers/setlistfm.js";

const fm=(artist,city,songs=[],extra={})=>({id:"x"+city,artist:{name:artist},eventDate:"02-11-2024",venue:{name:"Stereolux",city:{name:city,country:{name:"France"}}},url:"https://www.setlist.fm/x",tour:{name:"Tour"},sets:{set:songs},...extra});
test("setlist.fm: sets, encore, covers and tapes are read",()=>{
  const s=shapeSetlist(fm("Silent Planet","Nantes",[{song:[{name:"Intro",tape:true},{name:"Panopticon"},{name:"Du Hast",cover:{name:"Rammstein"}},{name:"  "}]},{encore:1,song:[{name:"Firstborn",info:"acoustic"}]}]));
  assert.equal(s.date,"2024-11-02");assert.equal(s.city,"Nantes");assert.equal(s.songCount,3);
  assert.deepEqual(s.sets.map(x=>x.name),["","Rappel"]);
  assert.equal(s.sets[0].songs[2].cover,"Rammstein");assert.equal(s.sets[0].songs[0].tape,true);assert.equal(s.sets[0].songs.length,3);
  assert.equal(s.sets[1].songs[0].info,"acoustic");
});
test("setlist.fm: picks the exact band in the concert's city",()=>{
  const list=[fm("Thrown Into Exile","Nantes",[{song:[{name:"A"}]}]),fm("Thrown","Paris",[{song:[{name:"B"}]}]),fm("Thrown","Nantes",[{song:[{name:"C"}]}])];
  assert.equal(pickSetlist(list,{band:"thrown",city:"Nantes"}).sets[0].songs[0].name,"C");
  assert.equal(pickSetlist(list,{band:"Thrown",city:"Lille"}),null);
  assert.equal(pickSetlist([fm("Thrown","Paris 18")],{band:"Thrown",city:"Paris"})?.city,"Paris 18");
  assert.equal(pickSetlist([fm("Thrown","Lyon")],{band:"Thrown",city:""})?.city,"Lyon");
  assert.equal(pickSetlist([],{band:"Thrown",city:"Nantes"}),null);
});
