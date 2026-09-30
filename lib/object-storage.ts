import { createHash,createHmac } from "node:crypto";

function required(name:string){const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
function encode(value:string){return encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);}
function hmac(key:Buffer|string,value:string){return createHmac('sha256',key).update(value).digest();}
function stamp(date:Date){return date.toISOString().replace(/[:-]|\.\d{3}/g,'');}

export function storageConfigured(){return Boolean(process.env.STORAGE_ENDPOINT&&process.env.STORAGE_BUCKET&&process.env.STORAGE_ACCESS_KEY&&process.env.STORAGE_SECRET_KEY);}
export function presignObject(method:'PUT'|'GET'|'HEAD',objectKey:string,expires=600){
  const endpoint=new URL(required('STORAGE_ENDPOINT'));const bucket=required('STORAGE_BUCKET');const access=required('STORAGE_ACCESS_KEY');const secret=required('STORAGE_SECRET_KEY');const region=process.env.STORAGE_REGION||'us-east-1';const now=new Date();const amzDate=stamp(now);const date=amzDate.slice(0,8);const credentialScope=`${date}/${region}/s3/aws4_request`;const path=[endpoint.pathname.replace(/\/$/,''),bucket,...objectKey.split('/')].filter(Boolean).map((part,index)=>index===0&&part.startsWith('/')?part:encode(part)).join('/');const canonicalUri=path.startsWith('/')?path:`/${path}`;
  const params:Record<string,string>={'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':`${access}/${credentialScope}`,'X-Amz-Date':amzDate,'X-Amz-Expires':String(Math.min(900,expires)),'X-Amz-SignedHeaders':'host'};const canonicalQuery=Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${encode(key)}=${encode(value)}`).join('&');const canonicalRequest=[method,canonicalUri,canonicalQuery,`host:${endpoint.host}\n`,'host','UNSIGNED-PAYLOAD'].join('\n');const stringToSign=['AWS4-HMAC-SHA256',amzDate,credentialScope,createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');const signingKey=hmac(hmac(hmac(hmac(`AWS4${secret}`,date),region),'s3'),'aws4_request');const signature=createHmac('sha256',signingKey).update(stringToSign).digest('hex');return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
