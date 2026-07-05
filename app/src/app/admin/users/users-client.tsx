"use client"

import { useState, type FormEvent } from "react"
import { fetchWithCsrf } from "@/lib/csrf"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

// Mirrors users-repo.ts's AdminUserRow. Defined locally (not imported) so this
// client component never pulls in users-repo.ts's `import "server-only"`.
interface AdminUser {
  id: string
  email: string
  name: string | null
  disabled: boolean
  created_at: string
  is_owner: boolean | null
}

function fmtDate(s: string): string {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

export default function UsersClient({ initialUsers }: { initialUsers: AdminUser[] }) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  async function refresh() {
    const res = await fetch("/api/admin/users", { credentials: "include" })
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      setUsers(data.users ?? [])
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreateSuccess(null)
    setCreating(true)
    try {
      const res = await fetchWithCsrf("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, name, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(data?.error ?? `HTTP ${res.status}`)
        return
      }
      setCreateSuccess(`Created ${data?.user?.email ?? email} — share the temp password with them directly.`)
      setEmail("")
      setName("")
      setPassword("")
      await refresh()
    } catch {
      setCreateError("Failed to create user. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(u: AdminUser) {
    setToggleError(null)
    setToggling(u.id)
    const nextDisabled = !u.disabled
    try {
      const res = await fetchWithCsrf(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: nextDisabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setToggleError(data?.error ?? `HTTP ${res.status}`)
        return
      }
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, disabled: nextDisabled } : x)))
    } catch {
      setToggleError("Failed to update user. Please try again.")
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="text-sm text-slate-400">
          Provision accounts and manage access. Public registration is disabled — this is the only way to add a user.
        </p>
      </div>

      <GlassCard className="space-y-4">
        <h2 className="text-lg font-semibold">Create user</h2>

        {createError && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">{createError}</p>
        )}
        {createSuccess && (
          <p className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{createSuccess}</p>
        )}

        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div className="space-y-1.5 sm:col-span-1">
            <label htmlFor="new-email" className="text-sm text-slate-300">Email</label>
            <Input
              id="new-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <label htmlFor="new-name" className="text-sm text-slate-300">Name</label>
            <Input
              id="new-name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <label htmlFor="new-password" className="text-sm text-slate-300">Temp password</label>
            <Input
              id="new-password"
              type="text"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
            />
          </div>
          <Button type="submit" disabled={creating} className="sm:col-span-1">
            {creating ? "Creating…" : "Create user"}
          </Button>
        </form>
      </GlassCard>

      <GlassCard className="space-y-3">
        <h2 className="text-lg font-semibold">All users</h2>

        {toggleError && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">{toggleError}</p>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Access</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium text-slate-200">{u.email}</TableCell>
                <TableCell className="text-slate-400">{u.name ?? "—"}</TableCell>
                <TableCell>
                  {u.is_owner ? (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">Admin</Badge>
                  ) : u.disabled ? (
                    <Badge variant="destructive">Disabled</Badge>
                  ) : (
                    <Badge variant="secondary">Active</Badge>
                  )}
                </TableCell>
                <TableCell className="text-slate-500">{fmtDate(u.created_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs text-slate-500">
                      {u.is_owner ? "Admin" : u.disabled ? "Disabled" : "Enabled"}
                    </span>
                    <Switch
                      checked={!u.disabled}
                      disabled={!!u.is_owner || toggling === u.id}
                      onCheckedChange={() => handleToggle(u)}
                      aria-label={u.disabled ? `Enable ${u.email}` : `Disable ${u.email}`}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500">
                  No users yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </GlassCard>
    </div>
  )
}
