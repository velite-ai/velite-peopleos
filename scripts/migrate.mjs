import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error("DATABASE_URL is required");
const directory=resolve(process.cwd(),"database");
const files=(await readdir(directory)).filter(file=>/^\d+.*\.sql$/.test(file)).sort();
const sql=postgres(databaseUrl,{max:1,prepare:false,onnotice:()=>{}});
try{
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
  await sql`SELECT pg_advisory_lock(948271663)`;
  for(const file of files){
    const source=await readFile(resolve(directory,file),"utf8");
    const checksum=createHash("sha256").update(source).digest("hex");
    const [existing]=await sql`SELECT checksum FROM schema_migrations WHERE name=${file}`;
    if(existing){if(existing.checksum!==checksum)throw new Error(`Applied migration ${file} was modified`);continue;}
    await sql.begin(async tx=>{await tx.unsafe(source);await tx`INSERT INTO schema_migrations (name,checksum) VALUES (${file},${checksum})`;});
    process.stdout.write(`Applied ${file}\n`);
  }
}finally{
  await sql`SELECT pg_advisory_unlock(948271663)`.catch(()=>{});
  await sql.end();
}
