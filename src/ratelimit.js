// Small in-memory limiter (one server process): counts events per key in a
// sliding window. Used against password guessing on login and against abuse
// of sign-up / password-reset e-mails.
export function makeLimiter({max,windowMs}){
  const hits=new Map();
  const recent=(key,now)=>{const list=(hits.get(key)||[]).filter(t=>now-t<windowMs);if(list.length)hits.set(key,list);else hits.delete(key);return list};
  return {
    // true while the key is still under the limit
    allowed(key,now=Date.now()){return recent(key,now).length<max},
    // seconds until the oldest counted event leaves the window
    retryAfter(key,now=Date.now()){const l=recent(key,now);return l.length?Math.max(1,Math.ceil((l[0]+windowMs-now)/1000)):0},
    add(key,now=Date.now()){const l=recent(key,now);l.push(now);hits.set(key,l);if(hits.size>20000)hits.delete(hits.keys().next().value)},
    reset(key){hits.delete(key)}
  };
}
export function waitText(sec){const m=Math.ceil(sec/60);return m<=1?"une minute":`${m} minutes`}
