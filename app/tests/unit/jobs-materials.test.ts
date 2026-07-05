import { describe, it, expect } from "vitest"
import { resolveMaterialPath } from "@/lib/jobs-materials"

describe("resolveMaterialPath", () => {
  const base = "/app/job-materials"
  it("accepts a plain .pdf basename", () => {
    expect(resolveMaterialPath(base, "cv-acme.pdf")).toBe("/app/job-materials/cv-acme.pdf")
  })
  it("rejects null / empty / non-pdf", () => {
    expect(resolveMaterialPath(base, null)).toBeNull()
    expect(resolveMaterialPath(base, undefined)).toBeNull()
    expect(resolveMaterialPath(base, "")).toBeNull()
    expect(resolveMaterialPath(base, "cv.txt")).toBeNull()
    expect(resolveMaterialPath(base, ".pdf")).toBeNull()
  })
  it("rejects path traversal and separators", () => {
    expect(resolveMaterialPath(base, "../secret.pdf")).toBeNull()
    expect(resolveMaterialPath(base, "/etc/passwd.pdf")).toBeNull()
    expect(resolveMaterialPath(base, "sub/dir.pdf")).toBeNull()
  })
})
