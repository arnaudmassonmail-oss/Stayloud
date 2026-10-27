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
