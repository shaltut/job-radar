import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { getUserByEmail } from "@/lib/users-repo"
import { verifyCredentials } from "@/lib/auth-credentials"
import { isPublicPath } from "@/lib/auth-paths"

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) =>
        verifyCredentials(String(creds?.email ?? ""), String(creds?.password ?? ""), {
          getUser: (e) => getUserByEmail(e),
          compare: (pw, hash) => bcrypt.compare(pw, hash),
        }),
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        const u = user as { id: string; tenantId: string | null; isOwner: boolean | null }
        token.id = u.id
        token.tenantId = u.tenantId
        token.isOwner = u.isOwner
      }
      return token
    },
    session: ({ session, token }) => {
      const su = session.user as { id?: string; tenantId?: string; isOwner?: boolean }
      if (token.id) su.id = token.id as string
      if (token.tenantId) su.tenantId = token.tenantId as string
      if (token.isOwner !== undefined) su.isOwner = token.isOwner as boolean
      return session
    },
    authorized: ({ request, auth }) => isPublicPath(request.nextUrl.pathname) || !!auth,
  },
})
