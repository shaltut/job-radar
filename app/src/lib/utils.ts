import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

// Egypt timezone constant
export const EGYPT_TIMEZONE = "Africa/Cairo"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string, currency: string = 'EGP'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatNumber(amount: number | string, decimals: number = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-EG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

export function formatPercent(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: EGYPT_TIMEZONE,
  })
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: EGYPT_TIMEZONE,
  })
}

// Convert local Egypt time input to UTC for storage
export function toUTC(dateString: string): Date {
  // Input is in Egypt local time (from date input), convert to UTC
  const localDate = new Date(dateString + "T00:00:00")
  // Create date in Egypt timezone and convert to UTC
  const egyptDate = new Date(localDate.toLocaleString('en-US', { timeZone: EGYPT_TIMEZONE }))
  const utcDate = new Date(localDate.getTime() - (egyptDate.getTime() - localDate.getTime()))
  return utcDate
}

// Get today's date in Egypt timezone as YYYY-MM-DD string (for date inputs)
export function getTodayEgypt(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: EGYPT_TIMEZONE })
}

// Format date for input field (YYYY-MM-DD) in Egypt timezone
export function formatDateForInput(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-CA', { timeZone: EGYPT_TIMEZONE })
}

export function getMonthName(month: number): string {
  return new Date(2024, month - 1, 1).toLocaleString('en-US', { month: 'long' })
}

// Check if a date is due (on or before today in Egypt timezone)
export function isDueInEgypt(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  const dateStr = d.toLocaleDateString('en-CA', { timeZone: EGYPT_TIMEZONE })
  const todayStr = getTodayEgypt()
  return dateStr <= todayStr
}

// Check if a date is overdue (before today in Egypt timezone)
export function isOverdueInEgypt(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  const dateStr = d.toLocaleDateString('en-CA', { timeZone: EGYPT_TIMEZONE })
  const todayStr = getTodayEgypt()
  return dateStr < todayStr
}
