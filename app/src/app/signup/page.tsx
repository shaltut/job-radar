import { GlassCard } from "@/components/ui/glass-card"
import SignupPageClient from "./signup-client"

/**
 * Server wrapper (#129): public self-registration is gated behind
 * REGISTRATION_ENABLED (default off). This env read must happen server-side
 * (a client component can't read process.env at request time), so when the
 * flag is off we render a "closed" state here instead of the signup form.
 */
export default function SignupPage() {
  const registrationEnabled = process.env.REGISTRATION_ENABLED === "true"

  if (!registrationEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <GlassCard className="w-full max-w-sm space-y-3 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-white">
            J
          </div>
          <h1 className="text-xl font-semibold text-white">Registration is closed</h1>
          <p className="text-sm text-slate-400">
            Registration is currently closed — contact your administrator.
          </p>
        </GlassCard>
      </div>
    )
  }

  return <SignupPageClient />
}
