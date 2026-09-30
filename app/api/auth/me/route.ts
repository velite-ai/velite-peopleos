import { currentUser } from "@/lib/auth";
import { fail, ok } from "@/lib/api";
export async function GET() { const user = await currentUser(); return user ? ok(user) : fail("Authentication required", 401); }
