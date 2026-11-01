// New members: after choosing up to 3 styles, about ten well-known bands are
// suggested (and ticked) so the app is not empty on the first visit. Each
// style has a hand-picked list of popular bands with plenty of information
// (Wikipedia, albums, clips); among them, the ones with concerts announced
// (in France first) come first. Bandsintown answers are cached 12 h per band.
import {bandActivity} from "./providers/tickets.js";
import {mb} from "./providers/musicbrainz.js";

export const ONBOARD_STYLES={
 "Groupes français":["Gojira","Mass Hysteria","Ultra Vomit","Rise of the Northstar","Landmvrks","Alcest","Benighted","Betraying the Martyrs","Dagoba","Tagada Jones","Lofofora","Novelists","Klone","Trust"],
 "Metalcore":["Architects","Parkway Drive","Bring Me the Horizon","Killswitch Engage","Bullet for My Valentine","While She Sleeps","Trivium","Polaris","Northlane","August Burns Red","Asking Alexandria","Of Mice & Men"],
 "Deathcore":["Lorna Shore","Whitechapel","Thy Art Is Murder","Suicide Silence","Chelsea Grin","Carnifex","Shadow of Intent","Fit for an Autopsy","Signs of the Swarm","Born of Osiris","Within Destruction","Bodysnatcher"],
 "Hardcore":["Knocked Loose","Hatebreed","Terror","Comeback Kid","Madball","Agnostic Front","Turnstile","Sick of It All","Stick to Your Guns","Biohazard","Malevolence","Get the Shot"],
 "Nu Metal":["Korn","Slipknot","Limp Bizkit","Deftones","Linkin Park","Papa Roach","Mass Hysteria","Disturbed","Static-X","Sevendust","Ill Niño","Tetrarch"],
 "Death Metal":["Cannibal Corpse","Arch Enemy","Amon Amarth","Obituary","Dying Fetus","Morbid Angel","Nile","Bloodbath","Behemoth","Kataklysm","Benighted","Aborted"],
 "Black Metal":["Mayhem","Dimmu Borgir","Watain","Behemoth","Satyricon","Marduk","Dark Funeral","Cradle of Filth","Emperor","Gorgoroth","Alcest","Belphegor"],
 "Thrash Metal":["Metallica","Slayer","Megadeth","Anthrax","Testament","Exodus","Kreator","Sepultura","Overkill","Sodom","Destruction","Municipal Waste"],
 "Alternative":["Deftones","Gojira","System of a Down","Spiritbox","Bad Omens","Sleep Token","Mastodon","Avenged Sevenfold","Alice in Chains","Tool","Halestorm","Architects"],
 "Post-Hardcore":["Pierce the Veil","Alexisonfire","Silverstein","Thrice","Underoath","Sleeping with Sirens","La Dispute","Dance Gavin Dance","The Used","Being as an Ocean","Saosin","Senses Fail"],
 "Progressif":["Tool","Opeth","Dream Theater","Gojira","Mastodon","Periphery","TesseracT","Leprous","Haken","Between the Buried and Me","Animals as Leaders","Devin Townsend"],
 "Punk":["The Offspring","Green Day","Bad Religion","Rise Against","Pennywise","Dropkick Murphys","Millencolin","Social Distortion","Descendents","Lagwagon","Tagada Jones","Les Wampas"],
 "Grunge":["Pearl Jam","Alice in Chains","Foo Fighters","Stone Temple Pilots","Mudhoney","Melvins","The Smashing Pumpkins","Bush","Nirvana","Soundgarden","Screaming Trees","Silverchair"],
 "Rock":["Foo Fighters","AC/DC","Queens of the Stone Age","Royal Blood","Muse","Red Hot Chili Peppers","Guns N' Roses","Biffy Clyro","Greta Van Fleet","Shinedown","The Rolling Stones","Nickelback"],
};
const STYLE_OF={"Groupes français":"Metal"};

// How many bands per style for a total of about ten.
export function quotas(n,total=10){const base=Math.floor(total/n),out=Array(n).fill(base);for(let i=0;i<total-base*n;i++)out[i]++;return out}
// Touring bands first (France counts most), then the hand-picked order.
export function rankBands(names,activity){
 return names.map((name,i)=>{const a=activity[name];const score=a?(a.france?100+Math.min(a.france,10)*5:0)+Math.min(a.total||0,30):0;return {name,i,score}})
  .sort((x,y)=>y.score-x.score||x.i-y.i).map(x=>x.name);
}
async function within(job,ms){return Promise.race([job.catch(()=>null),new Promise(r=>setTimeout(()=>r(null),ms))])}

export async function onboardingSuggestions(styles,{total=10,budgetMs=9000}={}){
 styles=[...new Set((Array.isArray(styles)?styles:[]).map(String).filter(s=>ONBOARD_STYLES[s]))].slice(0,3);
 if(!styles.length)return {items:[]};
 const all=[...new Set(styles.flatMap(s=>ONBOARD_STYLES[s]))];
 const activity={};const todo=[...all];
 const worker=async()=>{while(todo.length){const n=todo.shift();const a=await within(bandActivity(n),4000);if(a)activity[n]=a}};
 await within(Promise.all([worker(),worker(),worker(),worker(),worker()]),budgetMs);
 const q=quotas(styles.length,total),taken=new Set(),items=[];
 styles.forEach((s,k)=>{let n=0;for(const name of rankBands(ONBOARD_STYLES[s],activity)){if(n>=q[k])break;if(taken.has(name))continue;taken.add(name);n++;
  items.push({name,style:STYLE_OF[s]||s,from:s,activity:activity[name]||null})}});
 return {items};
}

// Many band names are shared ("Architects", "Polaris", "Trust"…): pick, among
// the MusicBrainz artists with exactly this name, the one tagged with the
// chosen style (or at least metal / rock / punk), French for the French list.
const STYLE_WORDS={"Groupes français":/metal|core|punk|rock/,"Metalcore":/metalcore/,"Deathcore":/deathcore/,"Hardcore":/hardcore/,"Nu Metal":/nu.?metal/,"Death Metal":/death metal/,"Black Metal":/black metal/,"Thrash Metal":/thrash/,"Alternative":/alternative|metal/,"Post-Hardcore":/post-hardcore|emo|screamo/,"Progressif":/progressive/,"Punk":/punk/,"Grunge":/grunge/,"Rock":/rock/};
const flat=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();
export function pickArtist(list,name,from){
 const want=flat(name),styleRe=STYLE_WORDS[from]||/metal/;
 const cands=(list||[]).filter(a=>a?.id&&flat(a.name)===want);
 const scored=cands.map(a=>{const tags=(a.tags||[]).map(t=>String(t.name||"").toLowerCase()).join(" | ");
  let sc=Number(a.score)||0;if(styleRe.test(tags))sc+=200;else if(/metal|core|punk|rock|grunge/.test(tags))sc+=120;
  sc+=Math.min(40,(a.tags||[]).reduce((n,t)=>n+(Number(t.count)||0),0));if(a.type==="Group")sc+=10;if(from==="Groupes français"&&a.country==="FR")sc+=150;
  return {a,sc}}).sort((x,y)=>y.sc-x.sc);
 return scored[0]?.a||null;
}
export async function resolveForOnboarding(name,from){
 const d=await mb(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent('artist:"'+String(name).replace(/"/g,"")+'"')}&fmt=json&limit=25`);
 const a=pickArtist(d?.artists,name,from);
 return a?{name:a.name,mbid:a.id,country:a.country||"",disambiguation:a.disambiguation||""}:null;
}
