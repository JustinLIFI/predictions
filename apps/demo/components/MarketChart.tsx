'use client'

import { useId, useMemo } from 'react'
import type { Market } from '@lifi/prediction-sdk'
import { generatePriceHistory, type PricePoint } from '../lib/synthetic-price-history'

const VIEW_WIDTH = 300
const VIEW_HEIGHT = 140
const PADDING_X = 4
const PADDING_TOP = 8
const PADDING_BOTTOM = 8

function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function pointsToPolyline(points: PricePoint[]): string {
  const xSpan = VIEW_WIDTH - PADDING_X * 2
  const ySpan = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  return points
    .map((p, i) => {
      const x = PADDING_X + (i / (points.length - 1)) * xSpan
      const y = PADDING_TOP + (1 - p.yesProbability) * ySpan
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function pointsToAreaPath(points: PricePoint[]): string {
  const xSpan = VIEW_WIDTH - PADDING_X * 2
  const ySpan = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const bottomY = PADDING_TOP + ySpan
  const segments = points.map((p, i) => {
    const x = PADDING_X + (i / (points.length - 1)) * xSpan
    const y = PADDING_TOP + (1 - p.yesProbability) * ySpan
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  })
  const firstX = PADDING_X
  const lastX = PADDING_X + xSpan
  return `${segments.join(' ')} L${lastX.toFixed(2)},${bottomY.toFixed(2)} L${firstX.toFixed(2)},${bottomY.toFixed(2)} Z`
}

export function MarketChart({ market }: { market: Market }): React.ReactElement | null {
  const gradientId = useId()

  const points = useMemo(() => {
    if (market.pricing.buyYesPriceUsd <= 0) return null
    const yesProbability = market.pricing.buyYesPriceUsd / 1_000_000
    return generatePriceHistory(market.marketId, yesProbability, market.openTime)
  }, [market.marketId, market.pricing.buyYesPriceUsd, market.openTime])

  if (market.status !== 'open' || !points) return null

  const last = points[points.length - 1]
  const xSpan = VIEW_WIDTH - PADDING_X * 2
  const ySpan = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const lastX = PADDING_X + xSpan
  const lastY = PADDING_TOP + (1 - last.yesProbability) * ySpan
  const midY = PADDING_TOP + ySpan / 2

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 6, padding: '0 2px' }}
      >
        <span className="eyebrow">yes_probability</span>
        <span className="eyebrow" style={{ opacity: 0.6 }}>demo_data</span>
      </div>
      <div
        style={{
          position: 'relative',
          background: 'var(--ink-100)',
          border: '1px solid var(--ink-300)',
          borderRadius: 12,
          padding: '8px 8px 4px',
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height={VIEW_HEIGHT}
          style={{ display: 'block' }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1={PADDING_X}
            y1={midY}
            x2={lastX}
            y2={midY}
            stroke="var(--ink-300)"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={pointsToAreaPath(points)}
            fill={`url(#${gradientId})`}
          />
          <polyline
            points={pointsToPolyline(points)}
            fill="none"
            stroke="var(--success)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={lastX} cy={lastY} r="3" fill="var(--success)" />
        </svg>
        <div
          className="flex items-center justify-between"
          style={{
            marginTop: 4,
            paddingTop: 4,
            borderTop: '1px solid var(--ink-300)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: 'var(--ink-600)',
            letterSpacing: '0.02em',
          }}
        >
          <span>{formatDate(points[0].t)}</span>
          <span>now</span>
        </div>
      </div>
    </div>
  )
}
