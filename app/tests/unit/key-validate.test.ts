import { describe, it, expect } from "vitest"
import { validateApifyToken, validateOpenAiKey } from "@/lib/key-validate"

const ok = async () => ({ ok: true }) as Response
const bad = async () => ({ ok: false }) as Response

describe("key validation", () => {
  it("apify 200 → valid", async () => expect(await validateApifyToken("t", ok)).toBe(true))
  it("apify non-200 → invalid", async () => expect(await validateApifyToken("t", bad)).toBe(false))
  it("apify network throw → invalid", async () => expect(await validateApifyToken("t", async () => { throw new Error() })).toBe(false))
  it("openai 200 → valid", async () => expect(await validateOpenAiKey("k", ok)).toBe(true))
  it("openai non-200 → invalid", async () => expect(await validateOpenAiKey("k", bad)).toBe(false))
  it("openai network throw → invalid", async () => expect(await validateOpenAiKey("k", async () => { throw new Error() })).toBe(false))
  it("apify empty → invalid without a call", async () => expect(await validateApifyToken("", async () => { throw "should not call" })).toBe(false))
  it("openai empty → invalid without a call", async () => expect(await validateOpenAiKey("", async () => { throw "should not call" })).toBe(false))
})
