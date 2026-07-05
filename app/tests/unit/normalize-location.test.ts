import { describe, it, expect } from "vitest"
import { normalizeLocation } from "@/lib/normalize-location"

describe("normalizeLocation", () => {
  it("collapses Abu Dhabi variants to one canonical string", () => {
    const variants = [
      "Abu Dhabi",
      "Abu Dhabi, UAE",
      "Abu Dhabi - United Arab Emirates",
      "Abu Dhabi - United Arab Emirates (UAE)",
      "Abu Dhabi · UAE",
      "Abu Dhabi, Abu Dhabi Emirate, United Arab Emirates",
      "Abu Dhabi Emirate, United Arab Emirates",
    ]
    const results = variants.map(normalizeLocation)
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe("Abu Dhabi, United Arab Emirates")
  })

  it("collapses Riyadh variants (including the Arabic form) to one canonical string", () => {
    const variants = [
      "Riyadh",
      "Riyadh - Saudi Arabia",
      "Riyadh, Saudi Arabia",
      "Riyadh · Saudi Arabia",
      "Riyadh, Riyadh, Saudi Arabia",
      "Riyadh Region",
      "الرياض, المملكة العربية السعودية",
    ]
    const results = variants.map(normalizeLocation)
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe("Riyadh, Saudi Arabia")
  })

  it("collapses Dubai variants to one canonical string", () => {
    const variants = [
      "Dubai",
      "Dubai, UAE",
      "Dubai - United Arab Emirates",
      "Dubai, United Arab Emirates",
      "Dubai - United Arab Emirates (UAE)",
      "Dubai, Dubai, United Arab Emirates",
      "Dubai · UAE",
    ]
    const results = variants.map(normalizeLocation)
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe("Dubai, United Arab Emirates")
  })

  it("normalizes remote values, with and without a country", () => {
    expect(normalizeLocation("Remote")).toBe("Remote")
    expect(normalizeLocation("Anywhere in the World")).toBe("Remote")
    expect(normalizeLocation("Remote, United States")).toBe("Remote, United States")
    expect(normalizeLocation("Remote, UAE")).toBe("Remote, United Arab Emirates")
  })

  it("leaves an already-clean 'City, Country' value unchanged", () => {
    expect(normalizeLocation("Doha, Qatar")).toBe("Doha, Qatar")
    expect(normalizeLocation("Cairo, Egypt")).toBe("Cairo, Egypt")
  })

  it("handles null and empty input without throwing", () => {
    expect(normalizeLocation(null)).toBeNull()
    expect(normalizeLocation("")).toBeNull()
    expect(normalizeLocation("   ")).toBeNull()
  })

  it("returns an unparseable / multi-place value unchanged (never guesses)", () => {
    // NOTE: "New York City, San Francisco" is deliberately NOT asserted here
    // any more — round-2 (see the describe block below) intentionally
    // changes this exact case to resolve to "United States" (all segments
    // resolve to the same single country, so it collapses per the round-2
    // "country always present" rule). The other two remain genuinely
    // unresolvable/multi-country and stay unchanged.
    expect(normalizeLocation("USA, Canada, USA timezones")).toBe("USA, Canada, USA timezones")
    expect(normalizeLocation("Americas, Europe, Asia, Oceania")).toBe("Americas, Europe, Asia, Oceania")
  })

  it("resolves ISO alpha-3 country codes seen in the data", () => {
    expect(normalizeLocation("ARE")).toBe("United Arab Emirates")
    expect(normalizeLocation("SAU")).toBe("Saudi Arabia")
    expect(normalizeLocation("MAR")).toBe("Morocco")
  })

  it("drops a 3-segment 'City, Region, Country' down to 'City, Country'", () => {
    expect(normalizeLocation("London, England, United Kingdom")).toBe("London, United Kingdom")
    expect(normalizeLocation("Toronto, Ontario, Canada")).toBe("Toronto, Canada")
  })

  it("is idempotent: normalizing a normalized value returns the same value", () => {
    const samples = [
      "Abu Dhabi, UAE",
      "Riyadh Region",
      "Remote",
      "Remote, United States",
      "Doha, Qatar",
      null,
      "",
      "New York City, San Francisco",
      "ARE",
      "الرياض, المملكة العربية السعودية",
    ]
    for (const s of samples) {
      const once = normalizeLocation(s)
      const twice = normalizeLocation(once)
      expect(twice).toBe(once)
    }
  })
})

describe("normalizeLocation round-2: country always present", () => {
  it("province stand-in → keep city, add country", () => {
    expect(normalizeLocation("Jeddah, Makkah")).toBe("Jeddah, Saudi Arabia")
  })

  it("a province NAME that is also a city keeps its city when paired with a country", () => {
    // "Makkah" is both a province and a city; with an explicit country it is
    // the CITY and must NOT collapse to the bare country.
    expect(normalizeLocation("Makkah, Saudi Arabia")).toBe("Makkah, Saudi Arabia")
  })

  it("US state code → single city keeps city", () => {
    expect(normalizeLocation("San Francisco, CA")).toBe("San Francisco, United States")
    expect(normalizeLocation("New York, NY")).toBe("New York, United States")
    expect(normalizeLocation("Johnston, IA 50131")).toBe("Johnston, United States")
    expect(normalizeLocation("English, IA")).toBe("English, United States")
    expect(normalizeLocation("Denver, CO")).toBe("Denver, United States")
    expect(normalizeLocation("Philadelphia, PA")).toBe("Philadelphia, United States")
    expect(normalizeLocation("Columbus, OH")).toBe("Columbus, United States")
    expect(normalizeLocation("San Diego, CA")).toBe("San Diego, United States")
    expect(normalizeLocation("Brooklyn, NY")).toBe("Brooklyn, United States")
  })

  it("bare city gazetteer", () => {
    expect(normalizeLocation("Los Angeles")).toBe("Los Angeles, United States")
    expect(normalizeLocation("San Francisco Bay")).toBe("San Francisco Bay, United States")
    expect(normalizeLocation("Surat")).toBe("Surat, India")
    expect(normalizeLocation("Bristol")).toBe("Bristol, United Kingdom")
  })

  it("multi-city all same country → COLLAPSE to country", () => {
    expect(normalizeLocation("New York City, San Francisco")).toBe("United States")
    expect(normalizeLocation("Los Angeles, New York")).toBe("United States")
    expect(normalizeLocation("New York City, Washington DC, San Francisco, Washington")).toBe("United States")
    expect(normalizeLocation("Los Angeles, New York City, Texas, San Francisco, Florida")).toBe("United States")
  })

  it("multi-COUNTRY → left unchanged (never guess)", () => {
    expect(normalizeLocation("Doha, Qatar, UAE")).toBe("Doha, Qatar, UAE")
    expect(normalizeLocation("USA, Canada, USA timezones")).toBe("USA, Canada, USA timezones")
    expect(normalizeLocation("Austin, New York City, San Francisco, London, Amsterdam, Paris, Berlin"))
      .toBe("Austin, New York City, San Francisco, London, Amsterdam, Paris, Berlin")
    expect(normalizeLocation("New York City, San Francisco, Birmingham"))
      .toBe("New York City, San Francisco, Birmingham")
  })

  it("regions/continents left unchanged", () => {
    expect(normalizeLocation("European Union")).toBe("European Union")
    expect(normalizeLocation("Americas, Europe, Asia, Oceania")).toBe("Americas, Europe, Asia, Oceania")
  })

  it("US territory left unchanged (acceptable, not guessed)", () => {
    expect(normalizeLocation("United States Virgin Islands")).toBe("United States Virgin Islands")
  })

  it("already City, Country / bare country / Remote unchanged", () => {
    expect(normalizeLocation("Jeddah, Saudi Arabia")).toBe("Jeddah, Saudi Arabia")
    expect(normalizeLocation("Saudi Arabia")).toBe("Saudi Arabia")
    expect(normalizeLocation("Remote")).toBe("Remote")
  })

  it("idempotent (feed output back in)", () => {
    for (const raw of [
      "Jeddah, Makkah",
      "San Francisco, CA",
      "New York City, San Francisco",
      "Los Angeles",
      "Johnston, IA 50131",
      "Los Angeles, New York City, Texas, San Francisco, Florida",
    ]) {
      const once = normalizeLocation(raw)!
      expect(normalizeLocation(once)).toBe(once)
    }
  })

  it("unknown city, no country signal → unchanged (never guess)", () => {
    expect(normalizeLocation("Springfield")).toBe("Springfield")
  })
})
