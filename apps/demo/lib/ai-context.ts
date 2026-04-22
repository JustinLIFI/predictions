import { formatProbability, type Market } from '@lifi/prediction-sdk'

const formatUsd = (microUsdc: number): string =>
  `$${(microUsdc / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

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
