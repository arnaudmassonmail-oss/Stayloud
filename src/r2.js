// Cloudflare R2 (S3-compatible) presigned URLs, signed with AWS Signature V4.
// Videos go straight from the phone to R2 (PUT) and are read from R2 (GET):
// they never pass through the server. Settings (Render):
//   R2_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID), R2_ACCESS_KEY_ID,
//   R2_SECRET_ACCESS_KEY, R2_BUCKET.
import crypto from "node:crypto";

export function r2Config(env=process.env){
  const account=String(env.R2_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID||"").trim(),key=String(env.R2_ACCESS_KEY_ID||"").trim(),secret=String(env.R2_SECRET_ACCESS_KEY||"").trim(),bucket=String(env.R2_BUCKET||"").trim();
  return account&&key&&secret&&bucket?{account,key,secret,bucket,host:`${account}.r2.cloudflarestorage.com`}:null;
}
const hmac=(k,s)=>crypto.createHmac("sha256",k).update(s).digest();
const hex=s=>crypto.createHash("sha256").update(s).digest("hex");
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());

export function presign(method,objectKey,{expires=900,now=Date.now(),cfg=r2Config(),headers={}}={}){
  if(!cfg)throw new Error("R2 n’est pas configuré");
  const region=cfg.region||"auto",t=new Date(now).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,""),day=t.slice(0,8),scope=`${day}/${region}/s3/aws4_request`;
  const obj=String(objectKey).split("/").map(enc).join("/"),path=cfg.virtualHost?`/${obj}`:`/${enc(cfg.bucket)}/${obj}`;
  const hdrs={host:cfg.host,...Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v).trim()]))};
  const signed=Object.keys(hdrs).sort();
  const q={"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":`${cfg.key}/${scope}`,"X-Amz-Date":t,"X-Amz-Expires":String(Math.max(1,Math.min(604800,expires))),"X-Amz-SignedHeaders":signed.join(";")};
  const qs=Object.keys(q).sort().map(k=>`${enc(k)}=${enc(q[k])}`).join("&");
  const canon=[method,path,qs,signed.map(k=>`${k}:${hdrs[k]}\n`).join(""),signed.join(";"),"UNSIGNED-PAYLOAD"].join("\n");
  const sts=["AWS4-HMAC-SHA256",t,scope,hex(canon)].join("\n");
  const kSign=hmac(hmac(hmac(hmac("AWS4"+cfg.secret,day),region),"s3"),"aws4_request");
  return `https://${cfg.host}${path}?${qs}&X-Amz-Signature=${crypto.createHmac("sha256",kSign).update(sts).digest("hex")}`;
}
export async function r2Head(objectKey){const r=await fetch(presign("HEAD",objectKey,{expires:60}),{method:"HEAD"});return r.ok?{size:Number(r.headers.get("content-length"))||0,type:r.headers.get("content-type")||""}:null}
export async function r2Delete(objectKey){const r=await fetch(presign("DELETE",objectKey,{expires:60}),{method:"DELETE"});return r.ok||r.status===404}
