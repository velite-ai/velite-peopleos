import { db } from "@/lib/database";
import { NextResponse } from "next/server";
import { pingRedis } from "@/lib/redis-health";

export async function GET() {
  try {
    const [,redis]=await Promise.all([db()`SELECT 1`,pingRedis()]);
    if(!redis)return NextResponse.json({ status: "degraded", database: "connected", redis: "unavailable", time: new Date().toISOString() },{status:503});
    return NextResponse.json({ status: "ok", database: "connected", redis: "connected", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable", redis: "unknown", time: new Date().toISOString() }, { status: 503 });
  }
}
