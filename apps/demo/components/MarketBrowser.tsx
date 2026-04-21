'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  formatProbability,
  formatPrice,
  getEvents,
  searchEvents,
} from '@lifi/prediction-sdk'
import type { Event, EventCategory, Market } from '@lifi/prediction-sdk'
import { predictionClient } from '../lib/client'
import { AskAIModal } from './AskAIModal'

const CATEGORIES: { label: string; value: EventCategory | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Crypto', value: 'crypto' },
  { label: 'Sports', value: 'sports' },
  { label: 'Politics', value: 'politics' },
  { label: 'Economics', value: 'economics' },
  { label: 'Tech', value: 'tech' },
]

function timeToClose(closeTime: number): string {
  const diff = closeTime * 1000 - Date.now()
  if (diff <= 0) return 'Closed'
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const mins = Math.floor((diff % 3_600_000) / 60_000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function fmtVol(microUsdc: number): string {
  const usd = formatPrice(microUsdc)
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(0)}`
}

function ProbabilityBar({ yesMicro, noMicro }: { yesMicro: number; noMicro: number }) {
  const yesPct = yesMicro / 10_000
  const noPct = noMicro / 10_000
  return (
    <div
      style={{
        position: 'relative',
        height: 3,
        borderRadius: 999,
        background: 'var(--ink-300)',
        overflow: 'hidden',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${yesPct}%`,
          background: 'linear-gradient(90deg, #34D399, rgba(52,211,153,0.35))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${noPct}%`,
          background: 'linear-gradient(270deg, #F87171, rgba(248,113,113,0.35))',
        }}
      />
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{
        color: 'var(--ink-600)',
        flexShrink: 0,
        transition: 'transform 200ms var(--ease-out)',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    >
      <path
        d="M2.5 5l4.5 4 4.5-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AskAIButton({
  onClick,
  compact = false,
}: {
  onClick: () => void
  compact?: boolean
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Ask AI about this market"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onClick()
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '1px 6px' : '3px 8px',
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        color: 'var(--lifi-pink)',
        background: 'rgba(247, 194, 255, 0.08)',
        border: '1px solid rgba(247, 194, 255, 0.25)',
        borderRadius: 999,
        cursor: 'pointer',
        letterSpacing: '0.02em',
        lineHeight: 1.2,
        transition: 'background 150ms, border-color 150ms',
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(247, 194, 255, 0.15)'
        e.currentTarget.style.borderColor = 'rgba(247, 194, 255, 0.45)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(247, 194, 255, 0.08)'
        e.currentTarget.style.borderColor = 'rgba(247, 194, 255, 0.25)'
      }}
    >
      <span aria-hidden="true">✦</span>
      ASK_AI
    </span>
  )
}

// Gradient border on single-market selected card (full border, paint-over technique)
const GRADIENT_BORDER_CARD: React.CSSProperties = {
  background:
    'linear-gradient(#1A1A1D, #1A1A1D) padding-box, linear-gradient(135deg, #F7C2FF 0%, #5C67FF 100%) border-box',
  border: '1px solid transparent',
}

function MarketSubRow({
  market,
  onSelect,
  selected,
  onAskAI,
}: {
  market: Market
  onSelect: (id: string) => void
  selected: boolean
  onAskAI: (market: Market) => void
}) {
  return (
    <button
      type="button"
      className={`market-sub-row${selected ? ' market-sub-row-selected' : ''}`}
      onClick={() => onSelect(market.marketId)}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--ink-900)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {market.title}
      </span>
      <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
        <AskAIButton compact onClick={() => onAskAI(market)} />
        <span className="badge-yes">
          <span className="badge-dot" style={{ background: 'var(--success)' }} />
          {formatProbability(market.pricing.buyYesPriceUsd)}
        </span>
        <span className="badge-no">
          <span className="badge-dot" style={{ background: 'var(--danger)' }} />
          {formatProbability(market.pricing.buyNoPriceUsd)}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            color: 'var(--ink-600)',
            minWidth: 36,
            textAlign: 'right',
          }}
        >
          {timeToClose(market.closeTime)}
        </span>
      </div>
    </button>
  )
}

function SkeletonCard() {
  return (
    <div className="lifi-card animate-pulse" style={{ padding: 16 }} aria-hidden="true">
      <div
        style={{
          height: 13,
          borderRadius: 6,
          background: 'var(--ink-300)',
          width: '72%',
          marginBottom: 8,
        }}
      />
      <div
        style={{
          height: 10,
          borderRadius: 4,
          background: 'var(--ink-300)',
          width: '48%',
        }}
      />
    </div>
  )
}

// Single-market event — whole card is a button
function SingleMarketCard({
  event,
  market,
  onSelect,
  selected,
  onAskAI,
}: {
  event: Event
  market: Market
  onSelect: (id: string) => void
  selected: boolean
  onAskAI: (market: Market) => void
}) {
  const title = event.metadata?.title ?? event.title ?? '—'
  return (
    <button
      type="button"
      onClick={() => onSelect(market.marketId)}
      className="lifi-card lifi-card-btn w-full text-left"
      style={{ padding: 16, ...(selected ? GRADIENT_BORDER_CARD : {}) }}
    >
      <div
        className="flex items-start gap-2"
        style={{ marginBottom: 10 }}
      >
        <p
          className="line-clamp-2"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink-900)',
            lineHeight: 1.45,
            letterSpacing: '-0.01em',
            margin: 0,
          }}
        >
          {title}
        </p>
        <AskAIButton onClick={() => onAskAI(market)} />
      </div>

      <ProbabilityBar
        yesMicro={market.pricing.buyYesPriceUsd}
        noMicro={market.pricing.buyNoPriceUsd}
      />

      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <span className="badge-yes">
          <span className="badge-dot" style={{ background: 'var(--success)' }} />
          YES {formatProbability(market.pricing.buyYesPriceUsd)}
        </span>
        <span className="badge-no">
          <span className="badge-dot" style={{ background: 'var(--danger)' }} />
          NO {formatProbability(market.pricing.buyNoPriceUsd)}
        </span>
      </div>

      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          color: 'var(--ink-600)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>vol {fmtVol(market.pricing.volume)}</span>
        <span>{timeToClose(market.closeTime)}</span>
      </div>
    </button>
  )
}

// Multi-market event — collapsed by default, togglable
function MultiMarketEventCard({
  event,
  onSelect,
  selectedMarketId,
  onAskAI,
}: {
  event: Event
  onSelect: (marketId: string) => void
  selectedMarketId?: string | null
  onAskAI: (market: Market) => void
}) {
  const title = event.metadata?.title ?? event.title ?? '—'
  const markets = event.markets ?? []
  const hasSelected = markets.some((m) => m.marketId === selectedMarketId)
  const [open, setOpen] = useState(hasSelected)

  const bestYesMicro = Math.max(...markets.map((m) => m.pricing.buyYesPriceUsd))
  const totalVolMicro = markets.reduce((sum, m) => sum + m.pricing.volume, 0)

  return (
    <div className="lifi-card" style={{ padding: 0 }}>
      {/* Single-row header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '11px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
        }}
      >
        {/* Title — truncates to one line */}
        <p
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink-900)',
            lineHeight: 1.45,
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            margin: 0,
          }}
        >
          {title}
        </p>

        {/* Summary pills — visible only when collapsed */}
        {!open && (
          <div
            className="flex items-center gap-1.5"
            style={{ flexShrink: 0 }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                color: 'var(--ink-600)',
                background: 'var(--ink-300)',
                borderRadius: 4,
                padding: '2px 5px',
              }}
            >
              {markets.length}
            </span>
            <span
              className="badge-yes"
              style={{ fontSize: 10, padding: '1px 6px' }}
            >
              {formatProbability(bestYesMicro)}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                color: 'var(--ink-600)',
              }}
            >
              {fmtVol(totalVolMicro)}
            </span>
          </div>
        )}

        <Chevron open={open} />
      </button>

      {/* Expanded sub-rows — card grows naturally, capped at 300px with internal scroll */}
      {open && (
        <div style={{ borderTop: '1px solid var(--ink-300)' }}>
          <div
            className="scroll-none"
            style={{
              maxHeight: 300,
              overflowY: 'auto',
              padding: '8px 12px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {markets.map((market) => (
              <MarketSubRow
                key={market.marketId}
                market={market}
                onSelect={onSelect}
                selected={selectedMarketId === market.marketId}
                onAskAI={onAskAI}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EventCard({
  event,
  onSelect,
  selectedMarketId,
  onAskAI,
}: {
  event: Event
  onSelect: (marketId: string) => void
  selectedMarketId?: string | null
  onAskAI: (market: Market) => void
}) {
  const markets = event.markets ?? []
  if (markets.length === 0) return null

  if (markets.length === 1) {
    return (
      <SingleMarketCard
        event={event}
        market={markets[0]}
        onSelect={onSelect}
        selected={selectedMarketId === markets[0].marketId}
        onAskAI={onAskAI}
      />
    )
  }

  return (
    <MultiMarketEventCard
      event={event}
      onSelect={onSelect}
      selectedMarketId={selectedMarketId}
      onAskAI={onAskAI}
    />
  )
}

interface MarketBrowserProps {
  onSelectMarket: (marketId: string) => void
  selectedMarketId?: string | null
}

export function MarketBrowser({ onSelectMarket, selectedMarketId }: MarketBrowserProps) {
  const [activeCategory, setActiveCategory] = useState<EventCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [askingAbout, setAskingAbout] = useState<Market | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const eventsQuery = useQuery({
    queryKey: ['events', activeCategory],
    queryFn: () =>
      getEvents(predictionClient, {
        category: activeCategory === 'all' ? undefined : activeCategory,
        includeMarkets: true,
      }),
    enabled: debouncedSearch.length === 0,
    staleTime: 30_000,
  })

  const searchQuery = useQuery({
    queryKey: ['events', 'search', debouncedSearch],
    queryFn: () => searchEvents(predictionClient, debouncedSearch),
    enabled: debouncedSearch.length > 0,
    staleTime: 30_000,
  })

  const isSearching = debouncedSearch.length > 0
  const isLoading = isSearching ? searchQuery.isLoading : eventsQuery.isLoading
  const error = isSearching ? searchQuery.error : eventsQuery.error
  const events = isSearching
    ? (searchQuery.data?.events ?? [])
    : (eventsQuery.data?.events ?? [])

  return (
    <div
      className="lifi-panel flex flex-col overflow-hidden"
      style={{ flex: 1, minHeight: 0 }}
    >
      {/* Header: search + category pills */}
      <div
        style={{
          padding: '14px 16px 12px',
          flexShrink: 0,
          borderBottom: '1px solid var(--ink-300)',
        }}
      >
        <div
          className="lifi-field flex items-center gap-2"
          style={{ padding: '0 12px', height: 40, marginBottom: isSearching ? 0 : 10 }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            style={{ color: 'var(--ink-600)', flexShrink: 0 }}
          >
            <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M11 11l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            placeholder="Search markets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 0,
              outline: 'none',
              fontSize: 13,
              color: 'var(--ink-900)',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {!isSearching && (
          <div className="flex gap-1 overflow-x-auto scroll-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setActiveCategory(cat.value)}
                className={`cat-pill${activeCategory === cat.value ? ' active' : ''}`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable event list */}
      <div
        className="flex-1 min-h-0 overflow-y-auto scroll-none flex flex-col gap-2"
        style={{ padding: '12px 16px 16px' }}
      >
        {isLoading ? (
          Array.from({ length: 5 }, (_, i) => <SkeletonCard key={i} />)
        ) : error ? (
          <div
            className="flex items-center justify-center"
            style={{
              flex: 1,
              border: '1px solid var(--ink-300)',
              borderRadius: 12,
              fontSize: 12,
              color: 'var(--danger)',
              minHeight: 80,
            }}
          >
            Failed to load markets
          </div>
        ) : events.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{
              flex: 1,
              border: '1px dashed var(--ink-400)',
              borderRadius: 12,
              minHeight: 80,
            }}
          >
            <span className="eyebrow">no_markets</span>
          </div>
        ) : (
          events.map((event) => (
            <EventCard
              key={event.eventId}
              event={event}
              onSelect={onSelectMarket}
              selectedMarketId={selectedMarketId}
              onAskAI={setAskingAbout}
            />
          ))
        )}
      </div>
      {askingAbout && (
        <AskAIModal market={askingAbout} onClose={() => setAskingAbout(null)} />
      )}
    </div>
  )
}
