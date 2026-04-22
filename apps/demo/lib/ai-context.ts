import { formatProbability, type Market, type Position } from '@lifi/prediction-sdk'

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
