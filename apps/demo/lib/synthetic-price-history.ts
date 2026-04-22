export interface PricePoint {
  t: number
  yesProbability: number
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60
const VOLATILITY = 0.03
const MIN_PROBABILITY = 0.01
const MAX_PROBABILITY = 0.99

function hashString(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number): number {
  if (value < MIN_PROBABILITY) return MIN_PROBABILITY
  if (value > MAX_PROBABILITY) return MAX_PROBABILITY
  return value
}

export function generatePriceHistory(
  marketId: string,
  currentYesProbability: number,
  openTime: number,
  now: number = Math.floor(Date.now() / 1000),
  pointCount = 60,
): PricePoint[] {
  const target = clamp(currentYesProbability)
  const rng = mulberry32(hashString(marketId))
  const start = 0.2 + rng() * 0.6

  const startTime = openTime > 0 && openTime < now ? openTime : now - SEVEN_DAYS_SECONDS
  const step = (now - startTime) / (pointCount - 1)

  const points: PricePoint[] = []
  let value = start
  for (let i = 0; i < pointCount; i += 1) {
    const progress = i / (pointCount - 1)
    const drift = (target - value) * progress
    const noise = (rng() - 0.5) * 2 * VOLATILITY * (1 - progress)
    value = clamp(value + drift + noise)
    points.push({
      t: Math.round(startTime + step * i),
      yesProbability: value,
    })
  }

  points[points.length - 1] = {
    t: Math.round(now),
    yesProbability: target,
  }

  return points
}
