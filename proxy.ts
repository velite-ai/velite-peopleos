import { NextRequest, NextResponse } from "next/server";
import { isAllowedWriteOrigin } from "@/lib/request-origin";

const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/api/auth/login",
  "/api/setup",
  "/api/health",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some(publicPath => path === publicPath || path.startsWith(`${publicPath}/`))) return NextResponse.next();
  if (path.startsWith("/_next/") || path === "/favicon.ico") return NextResponse.next();
  if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!isAllowedWriteOrigin({
      origin,
      requestOrigin: request.nextUrl.origin,
      appUrl: process.env.APP_URL,
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
    })) return NextResponse.json({ error: { message: "Cross-origin request rejected" } }, { status: 403 });
  }
  if (!request.cookies.get("velite_hr_session")?.value && !path.startsWith("/api/")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
