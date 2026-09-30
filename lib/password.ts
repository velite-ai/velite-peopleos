import { hash, verify, type Options } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

const options:Options={algorithm:2,version:1,memoryCost:19456,timeCost:3,parallelism:1,outputLen:32};
export function hashPassword(password:string){return hash(password,options);}
export async function verifyPassword(encoded:string,password:string){if(encoded.startsWith('$argon2id$'))return verify(encoded,password);if(encoded.startsWith('$2'))return bcrypt.compare(password,encoded);return false;}
export function passwordNeedsUpgrade(encoded:string){return !encoded.startsWith('$argon2id$');}
