import { describe, it, expect, beforeAll } from "vitest"
import { encryptSecret, decryptSecret } from "@/lib/secrets"
beforeAll(() => { process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64") })
describe("secret crypto", () => {
  it("round-trips", () => { const e = encryptSecret("apify_abc123"); expect(e).not.toContain("apify_abc123"); expect(decryptSecret(e)).toBe("apify_abc123") })
  it("uses a fresh IV each time (ciphertext differs)", () => { expect(encryptSecret("x")).not.toBe(encryptSecret("x")) })
  it("rejects a tampered ciphertext", () => {
    const e = encryptSecret("secret"); const [iv, tag, ct] = e.split(":")
    const bad = [iv, tag, Buffer.from("zzzz").toString("base64")].join(":")
    expect(() => decryptSecret(bad)).toThrow()
  })
  it("throws on malformed input", () => { expect(() => decryptSecret("nope")).toThrow() })

  it("throws when SECRETS_KEY is unset", () => {
    const saved = process.env.SECRETS_KEY
    delete process.env.SECRETS_KEY
    try {
      expect(() => encryptSecret("x")).toThrow()
    } finally {
      process.env.SECRETS_KEY = saved
    }
  })

  it("throws when SECRETS_KEY is the wrong length", () => {
    const saved = process.env.SECRETS_KEY
    process.env.SECRETS_KEY = Buffer.alloc(16, 1).toString("base64") // 16 bytes, not 32
    try {
      expect(() => encryptSecret("x")).toThrow()
    } finally {
      process.env.SECRETS_KEY = saved
    }
  })

  it("rejects a tampered auth tag", () => {
    const e = encryptSecret("secret"); const [iv, tag, ct] = e.split(":")
    const bad = [iv, Buffer.from("0000").toString("base64"), ct].join(":")
    expect(() => decryptSecret(bad)).toThrow()
  })

  it("throws on empty string input", () => { expect(() => decryptSecret("")).toThrow() })
})
