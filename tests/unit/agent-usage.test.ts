import { describe, expect, it } from 'vitest'
import { calcCost, addUsage, EMPTY_USAGE } from '../../src/main/agent/usage'

describe('calcCost', () => {
  it('computes cost from input/output token prices', () => {
    const price = { input: 3, output: 15 }
    const cost = calcCost({ input: 100000, output: 50000 }, price)
    expect(cost).toBeCloseTo(0.3 + 0.75, 10)
  })

  it('includes cache read/write when provided', () => {
    const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    const cost = calcCost({ input: 1000, output: 1000, cacheRead: 100000, cacheWrite: 50000 }, price)
    expect(cost).toBeCloseTo(0.003 + 0.015 + 0.03 + 0.1875, 10)
  })

  it('returns 0 without a price', () => {
    expect(calcCost({ input: 100, output: 100 }, undefined)).toBe(0)
  })
})

describe('addUsage', () => {
  it('sums all counters', () => {
    const a = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 }
    const b = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 1.5 }
    expect(addUsage(a, b)).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, cost: 2 })
  })
})

describe('EMPTY_USAGE', () => {
  it('starts at zero', () => {
    expect(EMPTY_USAGE).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })
  })
})
