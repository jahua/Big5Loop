import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "careloop-dev-secret-change-me"
);
const COOKIE_NAME = "careloop-session";
const MAX_AGE = 7 * 24 * 60 * 60; // 7 days

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" && !process.env.NEXTAUTH_URL?.includes("localhost"),
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ sub: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifySessionToken(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub || !payload.email) return null;
    return {
      id: payload.sub,
      email: payload.email as string,
      name: (payload.name as string) ?? "",
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function setSessionCookie(token: string) {
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, token, COOKIE_OPTIONS);
}

/** Set session cookie on a NextResponse. Use this in route handlers to ensure the cookie is sent with the response. */
export function setSessionCookieOnResponse(res: NextResponse, token: string): NextResponse {
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
}

export function clearSessionCookie() {
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
}

/** Clear session cookie on a NextResponse. Use in route handlers to ensure the browser receives the clear. */
export function clearSessionCookieOnResponse(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}

export { COOKIE_NAME };
