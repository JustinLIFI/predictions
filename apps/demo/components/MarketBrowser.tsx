'use client'

import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  formatProbability,
  formatPrice,
  getEvents,
  searchEvents,
} from '@lifi/prediction-sdk'
import type { Event, EventCategory, Market } from '@lifi/prediction-sdk'
import { predictionClient } from '../lib/client'
import { AskAIButton } from './AskAIButton'
import { AskAIModal } from './AskAIModal'

const CATEGORIES: { label: string; value: EventCategory | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Crypto', value: 'crypto' },
  { label: 'Sports', value: 'sports' },
  { label: 'Politics', value: 'politics' },
  { label: 'Economics', value: 'economics' },
  { label: 'Tech', value: 'tech' },
]

type SortOption = 'volume' | 'closing' | 'markets' | 'yes-pct' | 'newest'

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: 'Volume', value: 'volume' },
  { label: 'Closing soon', value: 'closing' },
  { label: 'Most markets', value: 'markets' },
  { label: 'Highest YES%', value: 'yes-pct' },
  { label: 'Newest', value: 'newest' },
]

// Four structural event types that drive display logic
type EventType = 'binary' | 'multi-candidate' | 'date-series' | 'price-series'

// volumeUsd is the actual API field name; totalVolume is the SDK type alias
type EventExt = Event & { volumeUsd?: number | string; metadata?: { title?: string } }

function getEventVolume(event: Event): number {
  const e = event as EventExt
  return Number(e.volumeUsd ?? event.totalVolume ?? 0)
}

// An event is "active" if at least one market is open and unsettled
function hasActiveMarket(event: Event): boolean {
  return (event.markets ?? []).some(
    (m) => m.status === 'open' && (m.result === '' || m.result == null),
  )
}

// ---- Event sort helpers ----

function getEarliestCloseTime(event: Event): number {
  const open = (event.markets ?? []).filter((m) => m.status === 'open')
  if (open.length === 0) return Infinity
  return Math.min(...open.map((m) => m.closeTime))
}

function getBestYes(event: Event): number {
  const markets = event.markets ?? []
  if (markets.length === 0) return 0
  return Math.max(...markets.map((m) => m.pricing.buyYesPriceUsd))
}

function getLatestOpenTime(event: Event): number {
  const markets = event.markets ?? []
  if (markets.length === 0) return 0
  return Math.max(...markets.map((m) => m.openTime ?? 0))
}

function sortEvents(events: Event[], sort: SortOption): Event[] {
  return [...events].sort((a, b) => {
    switch (sort) {
      case 'volume':
        return getEventVolume(b) - getEventVolume(a)
      case 'closing':
        return getEarliestCloseTime(a) - getEarliestCloseTime(b)
      case 'markets':
        return (b.markets?.length ?? 0) - (a.markets?.length ?? 0)
      case 'yes-pct':
        return getBestYes(b) - getBestYes(a)
      case 'newest':
        return getLatestOpenTime(b) - getLatestOpenTime(a)
    }
  })
}

// ---- Event type detection ----

// Matches titles whose primary meaning is a date/deadline milestone
const DATE_SERIES_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|Q[1-4]\s+20\d{2}|by\s+20\d{2}|before\s+20\d{2}|end\s+of\s+20\d{2})\b/i

// Matches titles that are primarily a price threshold — $80k, $100,000, 200M, etc.
// Excluded when the same title also has a date pattern (e.g. "hit $150k by December")
const PRICE_ONLY_RE = /\$[\d,]+[kKmMbB]?|\b\d+\s*[kKmMbB]\b/

function detectEventType(markets: Market[]): EventType {
  if (markets.length === 1) return 'binary'

  const dateCount = markets.filter((m) => DATE_SERIES_RE.test(m.title)).length
  if (dateCount >= markets.length * 0.6) return 'date-series'

  // Price-series: titles are price thresholds with no date qualifiers
  const priceCount = markets.filter(
    (m) => PRICE_ONLY_RE.test(m.title) && !DATE_SERIES_RE.test(m.title),
  ).length
  if (priceCount >= markets.length * 0.6) return 'price-series'

  return 'multi-candidate'
}

// ---- Market sorting by type ----

const MONTH_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
}

function dateSortKey(title: string): number {
  const t = title.toLowerCase()
  const y = t.match(/\b(20\d{2})\b/)
  const m = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/,
  )
  const year = y ? parseInt(y[1]) : 9999
  const month = m ? (MONTH_INDEX[m[1]] ?? 0) : 0
  return year * 100 + month
}

function parseTitleDateKey(title: string): number {
  const t = title.toLowerCase()
  // Q-notation: Q1 2025, Q4 2026
  const q = t.match(/\bq([1-4])\s+(20\d{2})\b/)
  if (q) return new Date(parseInt(q[2]), (parseInt(q[1]) - 1) * 3, 1).getTime()
  // Month + Day (+ optional ordinal suffix) + optional Year — year defaults to current
  const m = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})?\b/,
  )
  if (m) {
    const year = m[3] ? parseInt(m[3]) : new Date().getFullYear()
    const d = new Date(year, MONTH_INDEX[m[1]] ?? 0, parseInt(m[2]))
    if (!isNaN(d.getTime())) return d.getTime()
  }
  return dateSortKey(title) * 86_400_000
}

function priceSortKey(title: string): number {
  const m = title.match(/\$?([\d,]+)\s*([kmb])?/i)
  if (!m) return 0
  const base = parseFloat(m[1].replace(/,/g, ''))
  const mult: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }
  return base * (mult[m[2]?.toLowerCase() ?? ''] ?? 1)
}

function sortMarketsForType(markets: Market[], type: EventType): Market[] {
  if (markets.length <= 1) return markets
  const now = Date.now()
  return [...markets].sort((a, b) => {
    // Effectively open = status open AND closeTime hasn't passed
    const aOpen = a.status === 'open' && a.closeTime * 1000 > now ? 0 : 1
    const bOpen = b.status === 'open' && b.closeTime * 1000 > now ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    if (type === 'multi-candidate') return b.pricing.buyYesPriceUsd - a.pricing.buyYesPriceUsd
    if (type === 'date-series') return parseTitleDateKey(a.title) - parseTitleDateKey(b.title)
    if (type === 'price-series') return priceSortKey(a.title) - priceSortKey(b.title)
    return 0
  })
}

// ---- Formatting ----

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

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
}

// ---- Sub-components ----

// marginBottom controlled by caller
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

const GRADIENT_BORDER_CARD: React.CSSProperties = {
  background:
    'linear-gradient(#1A1A1D, #1A1A1D) padding-box, linear-gradient(135deg, #F7C2FF 0%, #5C67FF 100%) border-box',
  border: '1px solid transparent',
}

// Standard binary/date-series expanded row
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
  const isClosed = market.status !== 'open'
  return (
    <button
      type="button"
      className={`market-sub-row${selected ? ' market-sub-row-selected' : ''}`}
      onClick={() => onSelect(market.marketId)}
      style={isClosed ? { opacity: 0.5 } : undefined}
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
        <AskAIButton
            compact
            ariaLabel="Ask AI about this market"
            onClick={() => onAskAI(market)}
          />
        {isClosed ? (
          <span
            style={{
              ...MONO,
              fontSize: 10,
              color: 'var(--ink-600)',
              background: 'var(--ink-400)',
              borderRadius: 4,
              padding: '2px 7px',
            }}
          >
            Closed
          </span>
        ) : (
          <>
            <span className="badge-yes">
              <span className="badge-dot" style={{ background: 'var(--success)' }} />
              {formatProbability(market.pricing.buyYesPriceUsd)}
            </span>
            <span className="badge-no">
              <span className="badge-dot" style={{ background: 'var(--danger)' }} />
              {formatProbability(market.pricing.buyNoPriceUsd)}
            </span>
            <span style={{ ...MONO, fontSize: 10, color: 'var(--ink-600)', minWidth: 36, textAlign: 'right' }}>
              {timeToClose(market.closeTime)}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

// Multi-candidate expanded row: name + win probability bar + single %
function MultiCandidateSubRow({
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
  const isClosed = market.status !== 'open'
  const winPct = market.pricing.buyYesPriceUsd / 10_000
  return (
    <button
      type="button"
      className={`market-sub-row${selected ? ' market-sub-row-selected' : ''}`}
      onClick={() => onSelect(market.marketId)}
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 0,
        ...(isClosed ? { opacity: 0.5 } : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isClosed ? 0 : 5,
        }}
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
            marginRight: 8,
          }}
        >
          {market.title}
        </span>
        <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
          <AskAIButton
            compact
            ariaLabel="Ask AI about this market"
            onClick={() => onAskAI(market)}
          />
          {isClosed ? (
            <span
              style={{
                ...MONO,
                fontSize: 10,
                color: 'var(--ink-600)',
                background: 'var(--ink-400)',
                borderRadius: 4,
                padding: '2px 7px',
              }}
            >
              Closed
            </span>
          ) : (
            <span style={{ ...MONO, fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>
              {formatProbability(market.pricing.buyYesPriceUsd)}
            </span>
          )}
        </div>
      </div>
      {!isClosed && (
        <div
          style={{
            height: 3,
            borderRadius: 999,
            background: 'var(--ink-400)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${winPct}%`,
              background: 'linear-gradient(90deg, #34D399, rgba(52,211,153,0.35))',
            }}
          />
        </div>
      )}
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
      <div style={{ height: 3, borderRadius: 999, background: 'var(--ink-300)', marginBottom: 8 }} />
      <div style={{ height: 10, borderRadius: 4, background: 'var(--ink-300)', width: '48%' }} />
    </div>
  )
}

// Type A: single binary market — whole card is a button
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
  const title = (event as EventExt).metadata?.title ?? event.title ?? '—'
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
        <AskAIButton ariaLabel="Ask AI about this market" onClick={() => onAskAI(market)} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <ProbabilityBar
          yesMicro={market.pricing.buyYesPriceUsd}
          noMicro={market.pricing.buyNoPriceUsd}
        />
      </div>

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
          ...MONO,
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

// Types B + C: multi-market event with full card visual weight collapsed
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
  const title = (event as EventExt).metadata?.title ?? event.title ?? '—'
  const rawMarkets = event.markets ?? []
  const eventType = detectEventType(rawMarkets)
  const markets = sortMarketsForType(rawMarkets, eventType)
  const hasSelected = markets.some((m) => m.marketId === selectedMarketId)
  const [open, setOpen] = useState(hasSelected)

  const now = Date.now()
  const openMarkets = markets.filter((m) => m.status === 'open' && m.closeTime * 1000 > now)
  const eventVolMicro = getEventVolume(event)
  const earliestClose = getEarliestCloseTime(event)

  // Pick a representative market to display in the collapsed YES/NO bar.
  // date-series: nearest open market (soonest deadline = most current near-term signal)
  // price-series: open market closest to 50% probability (pivot point = highest uncertainty)
  // multi-candidate: not used for bar — top 2 shown as candidate list instead
  const refMarket = (() => {
    if (openMarkets.length === 0) return markets[0]
    if (eventType === 'date-series') {
      return openMarkets.reduce((min, m) => (m.closeTime < min.closeTime ? m : min), openMarkets[0])
    }
    if (eventType === 'price-series') {
      const MID = 500_000 // 50% in micro-USDC
      return openMarkets.reduce((closest, m) => {
        const dThis = Math.abs(m.pricing.buyYesPriceUsd - MID)
        const dBest = Math.abs(closest.pricing.buyYesPriceUsd - MID)
        return dThis < dBest ? m : closest
      }, openMarkets[0])
    }
    return openMarkets[0]
  })()
  const refYesMicro = refMarket?.pricing.buyYesPriceUsd ?? 0
  const refNoMicro = refMarket?.pricing.buyNoPriceUsd ?? 0

  // Top 2 candidates for multi-candidate preview
  const topCandidates = [...openMarkets]
    .sort((a, b) => b.pricing.buyYesPriceUsd - a.pricing.buyYesPriceUsd)
    .slice(0, 2)

  const typeLabel =
    eventType === 'multi-candidate' ? 'outcomes'
    : eventType === 'price-series' ? 'price levels'
    : 'dates'

  return (
    <div className="lifi-card lifi-card-btn" style={{ padding: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: 16,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          textAlign: 'left',
        }}
      >
        {/* Title + chevron */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
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
          <div style={{ flexShrink: 0, marginTop: 2 }}>
            <Chevron open={open} />
          </div>
        </div>

        {/* Type B: top 2 candidates with win% */}
        {eventType === 'multi-candidate' && (
          <div style={{ marginBottom: 10 }}>
            {topCandidates.map((m) => (
              <div
                key={m.marketId}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    color: 'var(--ink-700)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.title}
                </span>
                <span
                  style={{
                    ...MONO,
                    fontSize: 11,
                    color: 'var(--success)',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {formatProbability(m.pricing.buyYesPriceUsd)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Types C + D: threshold series — YES/NO bar for the representative market */}
        {(eventType === 'date-series' || eventType === 'price-series') && (
          <>
            <div style={{ marginBottom: 10 }}>
              <ProbabilityBar yesMicro={refYesMicro} noMicro={refNoMicro} />
            </div>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <span className="badge-yes">
                <span className="badge-dot" style={{ background: 'var(--success)' }} />
                YES {formatProbability(refYesMicro)}
              </span>
              <span className="badge-no">
                <span className="badge-dot" style={{ background: 'var(--danger)' }} />
                NO {formatProbability(refNoMicro)}
              </span>
            </div>
          </>
        )}

        {/* Footer: count · vol | close time */}
        <div
          style={{
            ...MONO,
            fontSize: 10,
            color: 'var(--ink-600)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>
            {markets.length} {typeLabel} · vol {fmtVol(eventVolMicro)}
          </span>
          <span>{earliestClose < Infinity ? timeToClose(earliestClose) : '—'}</span>
        </div>
      </button>

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
            {markets.map((market) =>
              eventType === 'multi-candidate' ? (
                <MultiCandidateSubRow
                  key={market.marketId}
                  market={market}
                  onSelect={onSelect}
                  selected={selectedMarketId === market.marketId}
                  onAskAI={onAskAI}
                />
              ) : (
                <MarketSubRow
                  key={market.marketId}
                  market={market}
                  onSelect={onSelect}
                  selected={selectedMarketId === market.marketId}
                  onAskAI={onAskAI}
                />
              ),
            )}
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
  const [sortBy, setSortBy] = useState<SortOption>('volume')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [askingAbout, setAskingAbout] = useState<Market | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const eventsQuery = useInfiniteQuery({
    queryKey: ['events', activeCategory],
    initialPageParam: 0,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      getEvents(predictionClient, {
        category: activeCategory === 'all' ? undefined : activeCategory,
        includeMarkets: true,
        start: pageParam,
        end: pageParam + 10,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasNext ? lastPage.pagination.end : undefined,
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

  const rawEventsAll = eventsQuery.data?.pages.flatMap((p) => p.events) ?? []
  const apiTotal = eventsQuery.data?.pages[0]?.pagination.total ?? 0
  const hasNextPage = eventsQuery.data?.pages.at(-1)?.pagination.hasNext ?? false

  const rawEvents = isSearching ? (searchQuery.data?.events ?? []) : rawEventsAll
  const events = sortEvents(rawEvents.filter(hasActiveMarket), sortBy)

  return (
    <div
      className="lifi-panel flex flex-col overflow-hidden"
      style={{ flex: 1, minHeight: 0 }}
    >
      {/* Header: search + category pills + sort bar */}
      <div
        style={{
          padding: '14px 16px 12px',
          flexShrink: 0,
          borderBottom: '1px solid var(--ink-300)',
        }}
      >
        <div
          className="lifi-field flex items-center gap-2"
          style={{ padding: '0 12px', height: 40, marginBottom: isSearching ? 0 : 12 }}
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
          <>
            <div
              className="flex gap-1 overflow-x-auto scroll-none"
              style={{
                paddingBottom: 10,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                marginBottom: 10,
              }}
            >
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
            <div className="flex gap-1 overflow-x-auto scroll-none">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSortBy(opt.value)}
                  className={`sort-pill${sortBy === opt.value ? ' active' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
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
          <>
            {events.map((event) => (
              <EventCard
                key={event.eventId}
                event={event}
                onSelect={onSelectMarket}
                selectedMarketId={selectedMarketId}
                onAskAI={setAskingAbout}
              />
            ))}

            {/* Pagination */}
            {!isSearching && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0 2px',
                }}
              >
                {hasNextPage && (
                  <button
                    type="button"
                    onClick={() => eventsQuery.fetchNextPage()}
                    disabled={eventsQuery.isFetchingNextPage}
                    className="btn-secondary"
                    style={{ padding: '7px 24px' }}
                  >
                    {eventsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                )}
                {apiTotal > 0 && (
                  <span style={{ ...MONO, fontSize: 10, color: 'var(--ink-600)' }}>
                    Showing {events.length} of {apiTotal} markets
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {askingAbout && (
        <AskAIModal market={askingAbout} onClose={() => setAskingAbout(null)} />
      )}
    </div>
  )
}
