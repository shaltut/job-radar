"use client"

import { useState, type FormEvent } from "react"
import { signIn } from "next-auth/react"
import Link from "next/link"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function SignupPageClient() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  // #126 honeypot: hidden from real users; a bot that fills every field will
  // populate this, and the server silently no-ops instead of signing them up.
  const [companyWebsite, setCompanyWebsite] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, company_website: companyWebsite }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        await signIn("credentials", { email, password, redirect: true, callbackUrl: "/" })
        return
      }
      if (res.status === 409) {
        setError("That email already registered")
      } else if (res.status === 429) {
        setError("Too many signup attempts. Please try again later.")
      } else {
        setError(data?.error || "Signup failed. Please try again.")
      }
    } catch {
      setError("Signup failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <GlassCard className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-white">
            J
          </div>
          <h1 className="text-xl font-semibold text-white">Create an account</h1>
          <p className="text-sm text-slate-400">Get started with Job Radar</p>
        </div>

        {error && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* #126 honeypot: hidden from sighted/keyboard users, left empty by
              them; a bot that blindly fills every input will populate it. */}
          <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
            <label htmlFor="company_website">Company website</label>
            <input
              id="company_website"
              name="company_website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={companyWebsite}
              onChange={(e) => setCompanyWebsite(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm text-slate-300">Name</label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
            />
          </div>
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating account…" : "Sign up"}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </p>
      </GlassCard>
    </div>
  )
}
