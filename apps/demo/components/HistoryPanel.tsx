'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { formatPrice, getHistory, getMarket } from '@lifi/prediction-sdk'
import type { HistoryEvent } from '@lifi/prediction-sdk'
import { predictionClient } from '../lib/client'

type EventKind = 'buy' | 'sell' | 'claim' | 'other'

const PAGE_SIZE = 10

function classifyEvent(event: HistoryEvent): EventKind {
  const type = event.eventType?.toLowerCase() ?? ''
  if (type.includes('payout') || type.includes('claim')) return 'claim'
  if (type.includes('filled') || type.includes('trade')) {
    return event.isBuy ? 'buy' : 'sell'
  }
  // Fallback — infer from isBuy when eventType is unexpected
  if (Number(event.filledContracts) > 0) {
    return event.isBuy ? 'buy' : 'sell'
  }
  return 'other'
}

function formatTimestamp(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1_000)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function HistoryRow({ event }: { event: HistoryEvent }) {
  const kind = classifyEvent(event)
  const { data: marketData } = useQuery({
    queryKey: ['market', event.marketId],
    queryFn: () => getMarket(predictionClient, event.marketId),
    staleTime: 60_000,
    enabled: !!event.marketId,
  })

  const filled = Number(event.filledContracts) || 0
  const avgPriceUsd = formatPrice(Number(event.avgFillPriceUsd) || 0)
  const totalCostUsd = formatPrice(Number(event.totalCostUsd) || 0)
  const feeUsd = formatPrice(Number(event.feeUsd) || 0)
  const realizedPnl =
    event.realizedPnl !== null && event.realizedPnl !== undefined
      ? formatPrice(Number(event.realizedPnl))
      : null
  const payoutUsd = formatPrice(Number(event.payoutAmountUsd) || 0)

  const actionLabel =
    kind === 'buy'
      ? 'Buy'
      : kind === 'sell'
        ? 'Sell'
        : kind === 'claim'
          ? 'Claim'
          : event.eventType || 'Event'

  const actionColor =
    kind === 'buy'
      ? 'var(--success)'
      : kind === 'sell'
        ? 'var(--danger)'
        : 'var(--ink-600)'

  const title = marketData?.market.title
  const sideLabel = event.isYes ? 'YES' : 'NO'

  // Secondary line: what to display depends on event kind
  let amountLine: string
  if (kind === 'claim') {
    amountLine = `Claimed $${payoutUsd.toFixed(2)}`
  } else if (filled > 0) {
    amountLine = `${filled} @ $${avgPriceUsd.toFixed(2)} = $${totalCostUsd.toFixed(2)}`
  } else {
    amountLine = event.eventType
  }

  return (
    <div className="lifi-card" style={{ padding: 12 }}>
      {/* Top line: action + timestamp */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 6 }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: actionColor,
              letterSpacing: '0.02em',
            }}
          >
            {actionLabel}
          </span>
          {kind !== 'claim' && kind !== 'other' && (
            <span
              className={event.isYes ? 'badge-yes' : 'badge-no'}
              style={{ padding: '1px 6px', fontSize: 9 }}
            >
              {sideLabel}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-600)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {formatTimestamp(event.timestamp)}
        </span>
      </div>

      {/* Market title */}
      <p
        className="line-clamp-1"
        style={{
          fontSize: 11,
          color: 'var(--ink-800)',
          lineHeight: 1.4,
          marginBottom: 4,
        }}
      >
        {title ?? (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: 'var(--ink-600)',
            }}
          >
            {event.marketId.slice(0, 24)}…
          </span>
        )}
      </p>

      {/* Amount / details line */}
      <div className="flex items-center justify-between">
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-700)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {amountLine}
        </span>
        {realizedPnl !== null && kind === 'sell' && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: realizedPnl >= 0 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}
          </span>
        )}
        {feeUsd > 0 && realizedPnl === null && (
          <span style={{ fontSize: 10, color: 'var(--ink-600)' }}>
            fee ${feeUsd.toFixed(3)}
          </span>
        )}
      </div>
    </div>
  )
}

export function HistoryPanel() {
  const { publicKey, connected } = useWallet()
  const [page, setPage] = useState(0)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['history', publicKey?.toString()],
    queryFn: () => getHistory(predictionClient, publicKey!.toString()),
    enabled: !!publicKey,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const filteredEvents = useMemo(() => {
    const events = data?.events ?? []
    return events.filter((event) => {
      const kind = classifyEvent(event)
      return kind === 'buy' || kind === 'sell'
    })
  }, [data])

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE))

  // Clamp page whenever filtered list changes (e.g. refetch shrinks it)
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1))
  }, [page, totalPages])

  const pageStart = page * PAGE_SIZE
  const pageEvents = filteredEvents.slice(pageStart, pageStart + PAGE_SIZE)

  if (!connected) {
    return (
      <div
        className="lifi-panel flex items-center justify-center"
        style={{ padding: 28, minHeight: 80 }}
      >
        <span className="eyebrow">connect_wallet</span>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="lifi-panel" style={{ padding: 14 }}>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="lifi-card animate-pulse"
              style={{ height: 72 }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div
        className="lifi-panel flex items-center justify-center"
        style={{ padding: 20, minHeight: 60 }}
      >
        <span style={{ fontSize: 11, color: 'var(--danger)' }}>
          Failed to load history
        </span>
      </div>
    )
  }

  if (filteredEvents.length === 0) {
    return (
      <div
        className="lifi-panel flex items-center justify-center"
        style={{ padding: 28, minHeight: 80 }}
      >
        <div
          style={{
            border: '1px dashed var(--ink-400)',
            borderRadius: 12,
            padding: '12px 20px',
            fontSize: 12,
            color: 'var(--ink-600)',
          }}
        >
          <span className="eyebrow">no_history</span>
        </div>
      </div>
    )
  }

  return (
    <div className="lifi-panel" style={{ padding: 14 }}>
      <div className="flex flex-col gap-2">
        {pageEvents.map((event) => (
          <HistoryRow
            key={`${event.id}-${event.signature}`}
            event={event}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div
          className="flex items-center justify-between"
          style={{ marginTop: 12 }}
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: 11 }}
          >
            ← Prev
          </button>
          <span
            style={{
              fontSize: 11,
              color: 'var(--ink-600)',
              fontFamily: "'JetBrains Mono', monospace",
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: 11 }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
