import type { UsageSummary } from '../../shared/types'

export interface ModelPrice {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface UsageInput {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export function calcCost(tokens: UsageInput, price: ModelPrice | undefined): number {
  if (!price) return 0
  const toDollars = (tokensCount: number, perMillion: number | undefined): number =>
    perMillion === undefined ? 0 : (tokensCount / 1_000_000) * perMillion
  return (
    toDollars(tokens.input, price.input) +
    toDollars(tokens.output, price.output) +
    toDollars(tokens.cacheRead ?? 0, price.cacheRead) +
    toDollars(tokens.cacheWrite ?? 0, price.cacheWrite)
  )
}

export function addUsage(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cost: a.cost + b.cost
  }
}

export const EMPTY_USAGE: UsageSummary = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
