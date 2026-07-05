"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import Link from "next/link"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

function errorMessage(code: string | null): string | null {
  if (!code) return null
  if (code === "CredentialsSignin") return "Invalid email or password."
  return "Something went wrong signing you in. Please try again."
}

function LoginForm({ registrationEnabled }: { registrationEnabled: boolean }) {
  const searchParams = useSearchParams()
  const bannerError = errorMessage(searchParams.get("error"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await signIn("credentials", { email, password, redirect: true, callbackUrl: "/" })
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <GlassCard className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-white">
            J
          </div>
          <h1 className="text-xl font-semibold text-white">Sign in</h1>
          <p className="text-sm text-slate-400">Welcome back to Job Radar</p>
        </div>

        {bannerError && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {bannerError}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm text-slate-300">Email</label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm text-slate-300">Password</label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {registrationEnabled && (
          <p className="text-center text-sm text-slate-400">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-emerald-400 hover:underline">
              Sign up
            </Link>
          </p>
        )}
      </GlassCard>
    </div>
  )
}

export default function LoginPageClient({ registrationEnabled }: { registrationEnabled: boolean }) {
  return (
    <Suspense fallback={null}>
      <LoginForm registrationEnabled={registrationEnabled} />
    </Suspense>
  )
}
