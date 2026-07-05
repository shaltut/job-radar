const PUBLIC_PREFIXES = ["/login", "/signup", "/api/auth", "/api/signup"]
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
}
