import path from "node:path"

/**
 * Resolve a stored PDF basename to an absolute path under baseDir, or null if invalid.
 * Guards against traversal: the name must be a bare ".pdf" basename (no separators, no "..").
 */
export function resolveMaterialPath(baseDir: string, name: string | null | undefined): string | null {
  if (!name || typeof name !== "string") return null
  if (!name.toLowerCase().endsWith(".pdf")) return null
  if (name.length <= 4) return null // reject a bare ".pdf" with no filename stem
  if (name !== path.basename(name)) return null
  return path.join(baseDir, name)
}
