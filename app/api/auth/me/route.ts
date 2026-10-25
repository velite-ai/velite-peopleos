import { currentUser } from "@/lib/auth";
import { fail, ok } from "@/lib/api";
import { canUseGiftRegister } from "@/lib/diwali-gift-rules";
export async function GET() { const user = await currentUser(); return user ? ok({ ...user, giftRegister: canUseGiftRegister(user) }) : fail("Authentication required", 401); }
