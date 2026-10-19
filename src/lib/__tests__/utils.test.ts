import { describe, it, expect } from 'vitest'
import { cn, formatCurrency, formatDate, daysUntil, budgetRemaining } from '@/lib/utils'

describe('utils', () => {
  describe('cn', () => {
    it('should merge tailwind classes correctly', () => {
      expect(cn('p-4', 'm-2')).toBe('p-4 m-2')
      expect(cn('p-4', 'p-2')).toBe('p-2')
    })
  })

  describe('formatCurrency', () => {
    it('should format valid amounts', () => {
      expect(formatCurrency(1000, 'GBP')).toBe('£1,000.00')
    })

    it('should return dash for null/undefined', () => {
      expect(formatCurrency(null)).toBe('—')
      expect(formatCurrency(undefined)).toBe('—')
    })
  })

  describe('formatDate', () => {
    it('should format dates correctly', () => {
      const date = new Date('2024-01-01T00:00:00Z')
      // Note: exact string may depend on local timezone in test environment, 
      // but en-GB usually expects "01 Jan 2024"
      expect(formatDate(date)).toContain('01 Jan 2024')
    })

    it('should return dash for invalid dates', () => {
      expect(formatDate(null)).toBe('—')
    })
  })

  describe('daysUntil', () => {
    it('should calculate correct number of days', () => {
      const today = new Date()
      const tomorrow = new Date()
      tomorrow.setDate(today.getDate() + 1)
      
      expect(daysUntil(tomorrow)).toBe(1)
    })

    it('should return null for invalid dates', () => {
      expect(daysUntil(null)).toBeNull()
    })
  })

  describe('budgetRemaining', () => {
    it('should calculate remaining budget', () => {
      expect(budgetRemaining(100, 40)).toBe(60)
      expect(budgetRemaining(100, null)).toBe(100)
    })

    it('should return null if estimate is missing', () => {
      expect(budgetRemaining(null, 40)).toBeNull()
    })
  })
})