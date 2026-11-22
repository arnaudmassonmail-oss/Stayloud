import test from "node:test";
import assert from "node:assert/strict";
import {presign,r2Config} from "../src/r2.js";
test("presigned URL matches the AWS Signature V4 reference example",()=>{
  const cfg={key:"AKIAIOSFODNN7EXAMPLE",secret:"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",bucket:"examplebucket",host:"examplebucket.s3.amazonaws.com",region:"us-east-1",virtualHost:true};
  const u=presign("GET","test.txt",{cfg,expires:86400,now:Date.parse("2013-05-24T00:00:00Z")});
  assert.match(u,/X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/)});
test("R2: path-style URL on the account host, content type signed for uploads",()=>{
  const cfg=r2Config({R2_ACCOUNT_ID:"acc",R2_ACCESS_KEY_ID:"k",R2_SECRET_ACCESS_KEY:"s",R2_BUCKET:"staypit-videos"});
  const u=presign("PUT","videos/ab/1-x.mp4",{cfg,headers:{"Content-Type":"video/mp4"}});
  assert.match(u,/^https:\/\/acc\.r2\.cloudflarestorage\.com\/staypit-videos\/videos\/ab\/1-x\.mp4\?/);assert.match(u,/X-Amz-SignedHeaders=content-type%3Bhost/);assert.match(u,/%2Fauto%2Fs3%2F/);
  assert.equal(r2Config({}),null)});
