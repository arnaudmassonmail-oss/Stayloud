// Test helper: answers the Cloudflare D1 HTTP API with a local SQLite file and
// blocks every other outside request (tests never depend on the network).
import Database from "better-sqlite3";
const db=new Database(process.env.D1_EMU_FILE);
const real=globalThis.fetch;
globalThis.fetch=async(url,opt={})=>{const u=String(url);
  if(u.includes("api.cloudflare.com")){const {sql,params=[]}=JSON.parse(opt.body);
    try{const st=db.prepare(sql);let results=[],meta={};if(st.reader)results=st.all(...params);else{const r=st.run(...params);meta={last_row_id:Number(r.lastInsertRowid),changes:r.changes}}
      return new Response(JSON.stringify({success:true,result:[{success:true,results,meta}]}))}
    catch(e){return new Response(JSON.stringify({success:false,errors:[{message:e.message}]}),{status:400})}}
  if(u.includes("api.resend.com"))return new Response(JSON.stringify({id:"test"}));
  if(u.startsWith("http://127.0.0.1")||u.startsWith("http://localhost"))return real(url,opt);
  return new Response("offline in tests",{status:503});
};
