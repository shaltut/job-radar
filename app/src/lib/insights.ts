/**
 * Spending insights helper library
 * Period range calculations, change percentages, projections, and aggregation helpers.
 */

export interface PeriodRange {
  start: Date;
  end: Date;
  label: string;
}

export interface PeriodRanges {
  current: PeriodRange;
  previous: PeriodRange;
}

/**
 * Calculate current and previous period date ranges.
 * Week starts on Monday. All dates are UTC.
 */
export function calculatePeriodRange(period: string, date: Date): PeriodRanges {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  switch (period) {
    case "day": {
      const currentStart = new Date(Date.UTC(y, m, d));
      const currentEnd = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
      const prevStart = new Date(Date.UTC(y, m, d - 1));
      const prevEnd = new Date(Date.UTC(y, m, d - 1, 23, 59, 59, 999));
      const fmt = (dt: Date) =>
        dt.toISOString().slice(0, 10);
      return {
        current: { start: currentStart, end: currentEnd, label: fmt(currentStart) },
        previous: { start: prevStart, end: prevEnd, label: fmt(prevStart) },
      };
    }

    case "week": {
      // Monday-based week
      const dow = date.getUTCDay(); // 0=Sun
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const currentStart = new Date(Date.UTC(y, m, d + mondayOffset));
      const currentEnd = new Date(Date.UTC(
        currentStart.getUTCFullYear(),
        currentStart.getUTCMonth(),
        currentStart.getUTCDate() + 6,
        23, 59, 59, 999
      ));
      const prevStart = new Date(Date.UTC(
        currentStart.getUTCFullYear(),
        currentStart.getUTCMonth(),
        currentStart.getUTCDate() - 7
      ));
      const prevEnd = new Date(Date.UTC(
        currentStart.getUTCFullYear(),
        currentStart.getUTCMonth(),
        currentStart.getUTCDate() - 1,
        23, 59, 59, 999
      ));
      const fmtRange = (s: Date, e: Date) =>
        `${s.toISOString().slice(0, 10)} to ${e.toISOString().slice(0, 10)}`;
      return {
        current: { start: currentStart, end: currentEnd, label: `Week of ${currentStart.toISOString().slice(0, 10)}` },
        previous: { start: prevStart, end: prevEnd, label: fmtRange(prevStart, prevEnd) },
      };
    }

    case "year": {
      const currentStart = new Date(Date.UTC(y, 0, 1));
      const currentEnd = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
      const prevStart = new Date(Date.UTC(y - 1, 0, 1));
      const prevEnd = new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999));
      return {
        current: { start: currentStart, end: currentEnd, label: `${y}` },
        previous: { start: prevStart, end: prevEnd, label: `${y - 1}` },
      };
    }

    case "month":
    default: {
      const currentStart = new Date(Date.UTC(y, m, 1));
      const currentEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      const prevStart = new Date(Date.UTC(y, m - 1, 1));
      const prevEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      return {
        current: {
          start: currentStart,
          end: currentEnd,
          label: `${monthNames[m]} ${y}`,
        },
        previous: {
          start: prevStart,
          end: prevEnd,
          label: `${monthNames[prevStart.getUTCMonth()]} ${prevStart.getUTCFullYear()}`,
        },
      };
    }
  }
}

/**
 * Calculate percentage change. Returns null if previous is 0.
 */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Project total spending for the full period based on pace so far.
 * Returns rounded integer.
 */
export function projectTotal(total: number, daysElapsed: number, daysInPeriod: number): number {
  if (daysElapsed <= 0) return 0;
  return Math.round((total / daysElapsed) * daysInPeriod);
}

/**
 * Days between two dates, minimum 1.
 */
export function daysBetween(start: Date, end: Date): number {
  const ms = Math.abs(end.getTime() - start.getTime());
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return Math.max(days, 1);
}

interface ExpenseRecord {
  category: string;
  amountEgp?: number | string | null;
  amount: number | string;
  description?: string;
}

interface CategoryAggregate {
  category: string;
  total: number;
  count: number;
}

/**
 * Group expenses by category, summing amountEgp (falling back to amount).
 * Returns sorted by total descending.
 */
export function aggregateByCategory(expenses: ExpenseRecord[]): CategoryAggregate[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const e of expenses) {
    const amt = e.amountEgp != null ? Number(e.amountEgp) : Number(e.amount);
    const existing = map.get(e.category);
    if (existing) {
      existing.total += amt;
      existing.count += 1;
    } else {
      map.set(e.category, { total: amt, count: 1 });
    }
  }
  return Array.from(map.entries())
    .map(([category, { total, count }]) => ({ category, total, count }))
    .sort((a, b) => b.total - a.total);
}

interface MerchantAggregate {
  name: string;
  amount: number;
  count: number;
}

/**
 * Group expenses by description (uppercased), return top 10 by amount.
 */
export function aggregateByMerchant(expenses: ExpenseRecord[]): MerchantAggregate[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const e of expenses) {
    const name = (e.description || "UNKNOWN").toUpperCase();
    const amt = e.amountEgp != null ? Number(e.amountEgp) : Number(e.amount);
    const existing = map.get(name);
    if (existing) {
      existing.amount += amt;
      existing.count += 1;
    } else {
      map.set(name, { amount: amt, count: 1 });
    }
  }
  return Array.from(map.entries())
    .map(([name, { amount, count }]) => ({ name, amount, count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
}
