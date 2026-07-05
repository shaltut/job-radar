import { describe, it, expect } from 'vitest'
import {
  calculatePeriodRange,
  changePercent,
  projectTotal,
  daysBetween,
  aggregateByCategory,
  aggregateByMerchant,
} from '@/lib/insights'

// Fixed reference date: 2024-03-15 (Friday), UTC
const REF_DATE = new Date('2024-03-15T12:00:00Z')

describe('calculatePeriodRange', () => {
  describe('month period', () => {
    it('returns correct current month range', () => {
      const result = calculatePeriodRange('month', REF_DATE)
      expect(result.current.start.toISOString()).toBe('2024-03-01T00:00:00.000Z')
      expect(result.current.end.toISOString()).toBe('2024-03-31T23:59:59.999Z')
      expect(result.current.label).toBe('March 2024')
    })

    it('returns correct previous month range', () => {
      const result = calculatePeriodRange('month', REF_DATE)
      expect(result.previous.start.toISOString()).toBe('2024-02-01T00:00:00.000Z')
      expect(result.previous.end.toISOString()).toBe('2024-02-29T23:59:59.999Z')
      expect(result.previous.label).toBe('February 2024')
    })

    it('handles January correctly (previous month is December of prior year)', () => {
      const janDate = new Date('2024-01-15T00:00:00Z')
      const result = calculatePeriodRange('month', janDate)
      expect(result.previous.start.toISOString()).toBe('2023-12-01T00:00:00.000Z')
      expect(result.previous.label).toBe('December 2023')
    })

    it('defaults to month for unknown period', () => {
      const result = calculatePeriodRange('unknown', REF_DATE)
      expect(result.current.label).toBe('March 2024')
    })
  })

  describe('week period', () => {
    it('returns Monday-based week for a Friday', () => {
      // 2024-03-15 is a Friday; week should start Monday 2024-03-11
      const result = calculatePeriodRange('week', REF_DATE)
      expect(result.current.start.toISOString()).toBe('2024-03-11T00:00:00.000Z')
      expect(result.current.end.toISOString()).toBe('2024-03-17T23:59:59.999Z')
      expect(result.current.label).toBe('Week of 2024-03-11')
    })

    it('returns previous week range', () => {
      const result = calculatePeriodRange('week', REF_DATE)
      expect(result.previous.start.toISOString()).toBe('2024-03-04T00:00:00.000Z')
      expect(result.previous.end.toISOString()).toBe('2024-03-10T23:59:59.999Z')
    })

    it('handles Sunday correctly (week starts on previous Monday)', () => {
      // 2024-03-17 is a Sunday; Monday-based week started 2024-03-11
      const sunday = new Date('2024-03-17T12:00:00Z')
      const result = calculatePeriodRange('week', sunday)
      expect(result.current.start.toISOString()).toBe('2024-03-11T00:00:00.000Z')
    })

    it('handles Monday correctly (week starts on the same day)', () => {
      const monday = new Date('2024-03-11T12:00:00Z')
      const result = calculatePeriodRange('week', monday)
      expect(result.current.start.toISOString()).toBe('2024-03-11T00:00:00.000Z')
    })
  })

  describe('day period', () => {
    it('returns correct current day range', () => {
      const result = calculatePeriodRange('day', REF_DATE)
      expect(result.current.start.toISOString()).toBe('2024-03-15T00:00:00.000Z')
      expect(result.current.end.toISOString()).toBe('2024-03-15T23:59:59.999Z')
      expect(result.current.label).toBe('2024-03-15')
    })

    it('returns previous day range', () => {
      const result = calculatePeriodRange('day', REF_DATE)
      expect(result.previous.start.toISOString()).toBe('2024-03-14T00:00:00.000Z')
      expect(result.previous.end.toISOString()).toBe('2024-03-14T23:59:59.999Z')
      expect(result.previous.label).toBe('2024-03-14')
    })
  })

  describe('year period', () => {
    it('returns correct current year range', () => {
      const result = calculatePeriodRange('year', REF_DATE)
      expect(result.current.start.toISOString()).toBe('2024-01-01T00:00:00.000Z')
      expect(result.current.end.toISOString()).toBe('2024-12-31T23:59:59.999Z')
      expect(result.current.label).toBe('2024')
    })

    it('returns previous year range', () => {
      const result = calculatePeriodRange('year', REF_DATE)
      expect(result.previous.start.toISOString()).toBe('2023-01-01T00:00:00.000Z')
      expect(result.previous.end.toISOString()).toBe('2023-12-31T23:59:59.999Z')
      expect(result.previous.label).toBe('2023')
    })
  })
})

describe('changePercent', () => {
  it('calculates positive change correctly', () => {
    expect(changePercent(150, 100)).toBe(50)
  })

  it('calculates negative change correctly', () => {
    expect(changePercent(80, 100)).toBe(-20)
  })

  it('returns null when previous is 0', () => {
    expect(changePercent(100, 0)).toBeNull()
  })

  it('returns 0 when both are equal', () => {
    expect(changePercent(100, 100)).toBe(0)
  })

  it('rounds to one decimal place', () => {
    // (133 - 100) / 100 * 100 = 33.0
    expect(changePercent(133, 100)).toBe(33)
    // (110 - 99) / 99 * 100 = 11.111...% -> rounds to 11.1
    expect(changePercent(110, 99)).toBe(11.1)
  })
})

describe('projectTotal', () => {
  it('projects correctly with partial period elapsed', () => {
    // 1000 spent in 10 days of 30 -> projected 3000
    expect(projectTotal(1000, 10, 30)).toBe(3000)
  })

  it('returns 0 when daysElapsed is 0', () => {
    expect(projectTotal(1000, 0, 30)).toBe(0)
  })

  it('returns 0 when daysElapsed is negative', () => {
    expect(projectTotal(1000, -1, 30)).toBe(0)
  })

  it('rounds to nearest integer', () => {
    // 100 / 3 * 10 = 333.33 -> rounds to 333
    expect(projectTotal(100, 3, 10)).toBe(333)
  })

  it('returns total when daysElapsed equals daysInPeriod', () => {
    expect(projectTotal(500, 30, 30)).toBe(500)
  })
})

describe('daysBetween', () => {
  it('calculates days between two dates', () => {
    const start = new Date('2024-01-01T00:00:00Z')
    const end = new Date('2024-01-31T00:00:00Z')
    expect(daysBetween(start, end)).toBe(30)
  })

  it('returns minimum 1 for same date', () => {
    const date = new Date('2024-03-15T00:00:00Z')
    expect(daysBetween(date, date)).toBe(1)
  })

  it('works regardless of order (absolute value)', () => {
    const a = new Date('2024-01-01T00:00:00Z')
    const b = new Date('2024-01-10T00:00:00Z')
    expect(daysBetween(a, b)).toBe(daysBetween(b, a))
  })

  it('returns 1 for dates less than 24 hours apart', () => {
    const start = new Date('2024-03-15T00:00:00Z')
    const end = new Date('2024-03-15T23:59:59Z')
    expect(daysBetween(start, end)).toBe(1)
  })
})

describe('aggregateByCategory', () => {
  it('sums amounts by category and sorts descending', () => {
    const expenses = [
      { category: 'Food', amount: 100 },
      { category: 'Transport', amount: 200 },
      { category: 'Food', amount: 50 },
    ]
    const result = aggregateByCategory(expenses)
    expect(result[0]).toEqual({ category: 'Transport', total: 200, count: 1 })
    expect(result[1]).toEqual({ category: 'Food', total: 150, count: 2 })
  })

  it('prefers amountEgp over amount when available', () => {
    const expenses = [
      { category: 'Food', amount: 100, amountEgp: 200 },
    ]
    const result = aggregateByCategory(expenses)
    expect(result[0].total).toBe(200)
  })

  it('uses amount when amountEgp is null', () => {
    const expenses = [
      { category: 'Food', amount: 100, amountEgp: null },
    ]
    const result = aggregateByCategory(expenses)
    expect(result[0].total).toBe(100)
  })

  it('returns empty array for empty input', () => {
    expect(aggregateByCategory([])).toEqual([])
  })

  it('handles string amounts', () => {
    const expenses = [
      { category: 'Food', amount: '150.5' },
    ]
    const result = aggregateByCategory(expenses)
    expect(result[0].total).toBe(150.5)
  })
})

describe('aggregateByMerchant', () => {
  it('groups by uppercased description', () => {
    const expenses = [
      { category: 'Food', amount: 100, description: 'starbucks' },
      { category: 'Food', amount: 50, description: 'STARBUCKS' },
    ]
    const result = aggregateByMerchant(expenses)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: 'STARBUCKS', amount: 150, count: 2 })
  })

  it('uses UNKNOWN for missing description', () => {
    const expenses = [
      { category: 'Food', amount: 100 },
    ]
    const result = aggregateByMerchant(expenses)
    expect(result[0].name).toBe('UNKNOWN')
  })

  it('returns top 10 by amount', () => {
    const expenses = Array.from({ length: 15 }, (_, i) => ({
      category: 'Food',
      amount: i + 1,
      description: `Merchant${i}`,
    }))
    const result = aggregateByMerchant(expenses)
    expect(result).toHaveLength(10)
    // First should be highest amount (Merchant14 = 15)
    expect(result[0].name).toBe('MERCHANT14')
  })

  it('sorts by amount descending', () => {
    const expenses = [
      { category: 'Food', amount: 50, description: 'Small' },
      { category: 'Food', amount: 200, description: 'Big' },
      { category: 'Food', amount: 100, description: 'Medium' },
    ]
    const result = aggregateByMerchant(expenses)
    expect(result[0].name).toBe('BIG')
    expect(result[1].name).toBe('MEDIUM')
    expect(result[2].name).toBe('SMALL')
  })

  it('returns empty array for empty input', () => {
    expect(aggregateByMerchant([])).toEqual([])
  })
})
