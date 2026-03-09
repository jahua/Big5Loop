import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "careloop-session";
const PUBLIC_PATHS = ["/login", "/api/auth/", "/api/health", "/api/chat", "/api/gateway/", "/api/feedback"];

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "careloop-dev-secret-change-me"
);

async function verifyJwt(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return !!(payload.sub && payload.email);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const valid = await verifyJwt(token);
  if (!valid) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
