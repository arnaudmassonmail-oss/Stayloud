import test from "node:test";
import assert from "node:assert/strict";
import {pickTicketmaster,pickBandsintown} from "../src/providers/tickets.js";

const tm=(name,date,city,url,attractions=[])=>({name,url,dates:{start:{localDate:date}},_embedded:{venues:[{city:{name:city}}],attractions:attractions.map(n=>({name:n}))}});
test("Ticketmaster: picks the event of this band, date and city",()=>{
  const data={_embedded:{events:[
    tm("Thrown","2026-12-05","Paris","https://tm/a"),
    tm("Thrown + Guests","2026-12-06","Lyon","https://tm/b"),
    tm("Thrown + Guests","2026-12-06","Paris","https://tm/c"),
    tm("Throwdown","2026-12-06","Paris","https://tm/d")]}};
  assert.equal(pickTicketmaster(data,{band:"thrown",date:"2026-12-06",city:"Paris"})?.url,"https://tm/c");
  assert.equal(pickTicketmaster(data,{band:"Thrown",date:"2026-12-07",city:"Paris"}),null);
  assert.equal(pickTicketmaster({},{band:"Thrown",date:"2026-12-06",city:"Paris"}),null);
});
test("Ticketmaster: band named only in the attractions, city with district",()=>{
  const data={_embedded:{events:[tm("Soirée Metal","2026-12-06","Paris 18","https://tm/e",["Thrown"])]}};
  assert.equal(pickTicketmaster(data,{band:"Thrown",date:"2026-12-06",city:"Paris"})?.url,"https://tm/e");
  assert.equal(pickTicketmaster(data,{band:"Rise of the Northstar",date:"2026-12-06",city:"Paris"}),null);
});
test("Bandsintown: ticket link of the concert of this date and city, not sold out",()=>{
  const evs=[
    {datetime:"2027-01-28T19:00:00",venue:{city:"Nantes"},offers:[{url:"https://bit/t/1",status:"available"}]},
    {datetime:"2027-01-30T19:00:00",venue:{city:"Paris"},offers:[{url:"https://bit/t/2",status:"sold out"}]},
    {datetime:"2027-01-31T19:00:00",venue:{city:"Lille"},offers:[]}];
  assert.equal(pickBandsintown(evs,{date:"2027-01-28",city:"Nantes"})?.url,"https://bit/t/1");
  assert.equal(pickBandsintown(evs,{date:"2027-01-28",city:"Paris"}),null);
  assert.equal(pickBandsintown(evs,{date:"2027-01-30",city:"Paris"}),null);
  assert.equal(pickBandsintown(evs,{date:"2027-01-31",city:"Lille"}),null);
  assert.equal(pickBandsintown(null,{date:"2027-01-28",city:"Nantes"}),null);
});
test("Ticketmaster nearby: geohash and concert rows with coordinates",async()=>{
  const {geohash,ticketmasterRows}=await import("../src/providers/tickets.js");
  assert.equal(geohash(57.64911,10.40744,11),"u4pruydqqvj");
  const rows=ticketmasterRows({_embedded:{events:[
    {name:"Gojira + Mastodon",url:"https://www.ticketmaster.fr/fr/manifestation/x",dates:{start:{localDate:"2027-03-02",localTime:"20:00:00"},status:{code:"onsale"}},_embedded:{venues:[{name:"Zénith Nantes Métropole",city:{name:"Saint-Herblain"},country:{countryCode:"FR"},location:{latitude:"47.229",longitude:"-1.628"}}],attractions:[{name:"Gojira"},{name:"Mastodon"}]}},
    {name:"Annulé",dates:{start:{localDate:"2027-03-03"},status:{code:"cancelled"}}},
    {name:"Sans date",dates:{start:{}}}]}});
  assert.equal(rows.length,1);const r=rows[0];
  assert.equal(r.artist,"Gojira");assert.equal(r.time,"20:00");assert.equal(r.city,"Saint-Herblain");assert.equal(r.country,"France");assert.equal(r.provider,"Ticketmaster");
  assert.equal(r._place.coordinates.latitude,47.229);
});
test("Ticketmaster nearby: only metal styles are kept from the music events",async()=>{
  const {ticketmasterRows,isMetalEvent}=await import("../src/providers/tickets.js");
  const ev=(name,genre,sub)=>({name,dates:{start:{localDate:"2027-01-31"}},classifications:[{segment:{name:"Music"},genre:{name:genre},subGenre:{name:sub}}],_embedded:{venues:[{name:"Zénith",city:{name:"Saint-Herblain"}}]}});
  const data={_embedded:{events:[ev("Electric Callboy","Rock","Metalcore"),ev("Sabaton","Metal","Heavy Metal"),ev("Zaz","Pop","French Pop"),ev("Rise Against","Rock","Punk")]}};
  assert.deepEqual(ticketmasterRows(data,{metalOnly:true}).map(r=>r.title),["Electric Callboy","Sabaton","Rise Against"]);
  assert.equal(ticketmasterRows(data).length,4);assert.equal(isMetalEvent({}),false);
});
test("activity summary: upcoming dates, France first date, past dates ignored",async()=>{
  const {activitySummary}=await import("../src/providers/tickets.js");
  const now=Date.parse("2026-11-01T12:00:00Z");
  const s=activitySummary([{datetime:"2026-12-05T20:00:00",venue:{city:"Lyon",country:"France"}},{datetime:"2026-11-20T20:00:00",venue:{city:"Berlin",country:"Germany"}},{datetime:"2026-10-01T20:00:00",venue:{city:"Paris",country:"France"}}],now);
  assert.equal(s.total,2);assert.equal(s.france,1);assert.equal(s.next.city,"Berlin");assert.equal(s.nextFrance.city,"Lyon");
  assert.deepEqual(activitySummary({errorMessage:"x"},now),{total:0,france:0,next:null,nextFrance:null});
});
