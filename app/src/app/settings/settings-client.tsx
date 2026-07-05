"use client"

import { useState } from "react"
import { fetchWithCsrf } from "@/lib/csrf"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExternalLink } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyStatus {
  set: boolean
  last4?: string
}

export interface KeysStatus {
  apify: KeyStatus
  openai: KeyStatus
}

type Which = "apify" | "openai"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskedLabel(status: KeyStatus): string {
  return status.set ? `••••…${status.last4 ?? ""}` : "not set"
}

// ---------------------------------------------------------------------------
// Section: one key field (Apify or OpenAI)
// ---------------------------------------------------------------------------

function KeyField({
  which,
  title,
  description,
  helpHref,
  helpLabel,
  status,
  onChange,
}: {
  which: Which
  title: string
  description: string
  helpHref: string
  helpLabel: string
  status: KeyStatus
  onChange: (which: Which, status: KeyStatus) => void
}) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<"valid" | "invalid" | "error" | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const submit = async (nextValue: string) => {
    setSaving(true)
    setResult(null)
    setErrorMsg(null)
    try {
      const res = await fetchWithCsrf("/api/settings/keys", {
        method: "POST",
        body: JSON.stringify({ which, value: nextValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResult("invalid")
        setErrorMsg((data as { error?: string }).error ?? `HTTP ${res.status}`)
        return
      }
      setResult(nextValue.trim() === "" ? null : "valid")
      setValue("")
      onChange(which, nextValue.trim() === "" ? { set: false } : { set: true, last4: nextValue.slice(-4) })
    } catch (e) {
      setResult("error")
      setErrorMsg(e instanceof Error ? e.message : "Request failed")
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    if (!value.trim()) return
    submit(value)
  }

  const handleRemove = () => {
    submit("")
  }

  return (
    <GlassCard className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-slate-500">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-md bg-slate-800/80 px-3 py-1.5 font-mono text-sm text-slate-300 ring-1 ring-white/10">
          {maskedLabel(status)}
        </code>
        <a
          href={helpHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded"
        >
          {helpLabel} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder={`Paste your ${title} key…`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-sm"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {status.set && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRemove}
            disabled={saving}
            className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/60"
          >
            {saving ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>

      {result === "valid" && (
        <div className="rounded-lg px-4 py-3 ring-1 text-sm bg-emerald-500/10 ring-emerald-500/30 text-emerald-300">
          ✓ Valid — key saved
        </div>
      )}
      {(result === "invalid" || result === "error") && (
        <div className="rounded-lg px-4 py-3 ring-1 text-sm bg-rose-500/10 ring-rose-500/30 text-rose-300">
          ✗ {errorMsg ?? "Invalid key"}
        </div>
      )}
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SettingsClient({ initialStatus }: { initialStatus: KeysStatus }) {
  const [status, setStatus] = useState<KeysStatus>(initialStatus)

  const handleChange = (which: Which, next: KeyStatus) => {
    setStatus((prev) => ({ ...prev, [which]: next }))
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-400">
          Bring your own Apify and OpenAI keys. Keys are encrypted at rest and never shown back to you in full — only the last 4 characters.
        </p>
      </div>

      <KeyField
        which="apify"
        title="Apify token"
        description="Powers job discovery runs on your own Apify account. Validated against your account before it's saved."
        helpHref="https://console.apify.com/account/integrations"
        helpLabel="Apify console"
        status={status.apify}
        onChange={handleChange}
      />

      <KeyField
        which="openai"
        title="OpenAI API key"
        description="Stored for future use in résumé scoring and tailoring. Validated against OpenAI before it's saved."
        helpHref="https://platform.openai.com/api-keys"
        helpLabel="OpenAI dashboard"
        status={status.openai}
        onChange={handleChange}
      />
    </div>
  )
}
