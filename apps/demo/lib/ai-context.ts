import { formatProbability, type Event, type Market, type Position } from '@lifi/prediction-sdk'

const formatUsd = (microUsdc: number): string => {
  const dollars = microUsdc / 1_000_000
  const sign = dollars < 0 ? '-' : ''
  return `${sign}$${Math.abs(dollars).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

const formatCloseTime = (unixSeconds: number): string => {
  if (!unixSeconds) return 'unknown'
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toISOString()
}

export function marketToContext(market: Market): string {
  const lines = [
    `Title: ${market.title}`,
    market.description ? `Description: ${market.description}` : '',
    `Status: ${market.status}`,
    market.result ? `Result: ${market.result}` : '',
    `YES probability: ${formatProbability(market.pricing.buyYesPriceUsd)} (buy) / ${formatProbability(market.pricing.sellYesPriceUsd)} (sell)`,
    `NO probability: ${formatProbability(market.pricing.buyNoPriceUsd)} (buy) / ${formatProbability(market.pricing.sellNoPriceUsd)} (sell)`,
    `Volume: ${formatUsd(market.pricing.volume)}`,
    `Closes: ${formatCloseTime(market.closeTime)}`,
    market.resolveAt ? `Resolves: ${formatCloseTime(market.resolveAt)}` : '',
    market.rulesPrimary ? `Resolution rules: ${market.rulesPrimary}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

export function positionsToContext(
  positions: Position[],
  marketsById: Record<string, Market>,
): string {
  const totalValue = positions.reduce((acc, p) => acc + p.valueUsd, 0)
  const totalPnl = positions.reduce((acc, p) => acc + p.unrealizedPnl, 0)
  const claimable = positions.filter((p) => p.claimable && !p.claimed).length

  const header = [
    `${positions.length} open position${positions.length === 1 ? '' : 's'}`,
    `total value ${formatUsd(totalValue)}`,
    `unrealized P&L ${formatUsd(totalPnl)}`,
    claimable > 0 ? `${claimable} claimable` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const bullets = positions.map((p, i) => {
    const market = marketsById[p.marketId]
    const title = market?.title ?? `${p.marketId.slice(0, 12)}…`
    const lines = [
      `[${i + 1}] ${title}`,
      `    Side: ${p.side.toUpperCase()} · Contracts: ${p.contracts}`,
      `    Avg price: ${formatProbability(p.avgPriceUsd)} · Current mark: ${formatProbability(p.markPriceUsd)}`,
      `    Cost: ${formatUsd(p.totalCostUsd)} · Value: ${formatUsd(p.valueUsd)} · P&L: ${formatUsd(p.unrealizedPnl)}`,
    ]
    if (market) {
      lines.push(`    Status: ${market.status}${market.result ? ` · Result: ${market.result}` : ''}`)
      lines.push(`    Closes: ${formatCloseTime(market.closeTime)}`)
      if (market.rulesPrimary) {
        lines.push(`    Rules: ${market.rulesPrimary}`)
      }
    }
    if (p.claimable && !p.claimed) {
      lines.push(`    Claimable payout: ${formatUsd(p.payoutUsd ?? 0)}`)
    } else if (p.claimed) {
      lines.push(`    Already claimed`)
    }
    return lines.join('\n')
  })

  return [header, '', ...bullets].join('\n')
}

export interface Candidate {
  n: number
  marketId: string
  title: string
  buyYesPriceUsd: number
  buyNoPriceUsd: number
}

export interface CandidateCatalog {
  candidates: Candidate[]
  contextString: string
}

function durationToClose(unixSeconds: number): string {
  if (!unixSeconds) return 'unknown close'
  const diff = unixSeconds * 1000 - Date.now()
  if (diff <= 0) return 'closed'
  const days = Math.floor(diff / 86_400_000)
  if (days >= 2) return `closes in ${days}d`
  const hours = Math.floor(diff / 3_600_000)
  if (hours >= 1) return `closes in ${hours}h`
  const mins = Math.max(1, Math.floor(diff / 60_000))
  return `closes in ${mins}m`
}

function formatVolumeCompact(microUsdc: number): string {
  const usd = microUsdc / 1_000_000
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(0)}`
}

export function buildCandidateCatalog(
  events: Event[],
  max: number,
  heldMarketIds: Set<string>,
): CandidateCatalog {
  const byId = new Map<string, { market: Market; category: string }>()
  for (const event of events) {
    for (const market of event.markets ?? []) {
      if (market.status !== 'open') continue
      if (byId.has(market.marketId)) continue
      byId.set(market.marketId, { market, category: event.category })
    }
  }

  const sorted = Array.from(byId.values()).sort(
    (a, b) => b.market.pricing.volume - a.market.pricing.volume,
  )
  const top = sorted.slice(0, max)

  const candidates: Candidate[] = top.map(({ market }, i) => ({
    n: i + 1,
    marketId: market.marketId,
    title: market.title,
    buyYesPriceUsd: market.pricing.buyYesPriceUsd,
    buyNoPriceUsd: market.pricing.buyNoPriceUsd,
  }))

  const contextString = top
    .map(({ market, category }, i) => {
      const yes = formatProbability(market.pricing.buyYesPriceUsd)
      const no = formatProbability(market.pricing.buyNoPriceUsd)
      const vol = formatVolumeCompact(market.pricing.volume)
      const close = durationToClose(market.closeTime)
      const held = heldMarketIds.has(market.marketId) ? ' · HELD' : ''
      return `[${i + 1}] ${market.title} · YES ${yes} (NO ${no}) · vol ${vol} · ${close} · ${category}${held}`
    })
    .join('\n')

  return { candidates, contextString }
}
