'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Position } from '@lifi/prediction-sdk'

interface AlphaModalProps {
  onClose: () => void
  onSelectMarket: (marketId: string, side: 'yes' | 'no') => void
  positions?: Position[]
}

interface Candidate {
  n: number
  marketId: string
  title: string
  buyYesPriceUsd: number
  buyNoPriceUsd: number
}

interface Citation {
  index: number
  url: string
  title: string
}

type StreamEvent =
  | { type: 'catalog'; candidates: Candidate[] }
  | { type: 'text'; delta: string }
  | { type: 'search_start' }
  | { type: 'search_done'; queries?: string[] }
  | { type: 'citation'; index: number; url: string; title: string }
  | { type: 'error'; message: string }

interface Pick {
  n: number
  side: 'yes' | 'no'
  priceCents: string
  rationale: string
  marketId: string
  title: string
}

const PRESETS = [
  'Find me value bets',
  'Closing this week',
  'Contrarian plays',
  'Sports edges',
]

const PICK_REGEX =
  /\*\*Buy (YES|NO) at ([\d.]+)¢\*\* on \[(\d+)\]\.\s*([^\n]+)/gi

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function extractPicks(text: string, catalog: Map<number, Candidate>): Pick[] {
  const picks: Pick[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(PICK_REGEX)) {
    const side = match[1].toLowerCase() as 'yes' | 'no'
    const priceCents = match[2]
    const n = parseInt(match[3], 10)
    const rationale = match[4].trim()
    const candidate = catalog.get(n)
    if (!candidate) continue
    const key = `${n}:${side}`
    if (seen.has(key)) continue
    seen.add(key)
    picks.push({
      n,
      side,
      priceCents,
      rationale,
      marketId: candidate.marketId,
      title: candidate.title,
    })
  }
  return picks
}

export function AlphaModal({ onClose, onSelectMarket, positions }: AlphaModalProps) {
  const [criterion, setCriterion] = useState('')
  const [submittedCriterion, setSubmittedCriterion] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [catalog, setCatalog] = useState<Map<number, Candidate>>(new Map())
  const [citations, setCitations] = useState<Citation[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streamText])

  const picks = useMemo(
    () => (streamText ? extractPicks(streamText, catalog) : []),
    [streamText, catalog],
  )

  async function runAlpha(inputCriterion: string) {
    const trimmed = inputCriterion.trim()
    if (isStreaming) return

    setSubmittedCriterion(trimmed || "What's most interesting right now?")
    setStreamText('')
    setCatalog(new Map())
    setCitations([])
    setError(null)
    setIsStreaming(true)
    setIsSearching(false)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/ask/alpha', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          criterion: trimmed,
          positions: positions && positions.length > 0 ? positions : undefined,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        let message = `Request failed (${res.status})`
        try {
          const parsed = JSON.parse(text) as { error?: string }
          if (parsed.error) message = parsed.error
        } catch {
          if (text) message = text
        }
        throw new Error(message)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const applyEvent = (event: StreamEvent): void => {
        if (event.type === 'catalog') {
          const next = new Map<number, Candidate>()
          for (const c of event.candidates) next.set(c.n, c)
          setCatalog(next)
        } else if (event.type === 'text') {
          setStreamText((prev) => prev + event.delta)
          setIsSearching(false)
        } else if (event.type === 'search_start') {
          setIsSearching(true)
        } else if (event.type === 'search_done') {
          setIsSearching(false)
        } else if (event.type === 'citation') {
          setCitations((prev) =>
            prev.some((c) => c.index === event.index)
              ? prev
              : [...prev, { index: event.index, url: event.url, title: event.title }],
          )
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (line) {
            try {
              applyEvent(JSON.parse(line) as StreamEvent)
            } catch {
              // Ignore malformed lines — likely a stream artifact.
            }
          }
          newlineIndex = buffer.indexOf('\n')
        }
      }
      const tail = buffer.trim()
      if (tail) {
        try {
          applyEvent(JSON.parse(tail) as StreamEvent)
        } catch {
          // Ignore.
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
    } finally {
      setIsStreaming(false)
      setIsSearching(false)
      abortRef.current = null
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    runAlpha(criterion)
  }

  function reset() {
    abortRef.current?.abort()
    setSubmittedCriterion(null)
    setStreamText('')
    setCatalog(new Map())
    setCitations([])
    setError(null)
    setIsStreaming(false)
    setIsSearching(false)
  }

  function selectPick(pick: Pick) {
    onSelectMarket(pick.marketId, pick.side)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alpha — investment picks"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="lifi-panel"
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--ink-300)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--warning, #FBBF24)',
                  background: 'rgba(251, 191, 36, 0.1)',
                  border: '1px solid rgba(251, 191, 36, 0.3)',
                  borderRadius: 999,
                  letterSpacing: '0.04em',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              >
                <span aria-hidden="true">✦</span>
                ALPHA
              </span>
              {submittedCriterion && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--ink-600)',
                    fontFamily: "'JetBrains Mono', monospace",
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  · {submittedCriterion}
                </span>
              )}
            </div>
            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink-900)',
                lineHeight: 1.4,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              What should I look at right now?
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-600)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Disclaimer banner */}
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(251, 191, 36, 0.08)',
            borderBottom: '1px solid rgba(251, 191, 36, 0.2)',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: '0.04em',
            color: 'var(--warning, #FBBF24)',
            textAlign: 'center',
          }}
        >
          demo_only · not_financial_advice · for hackathon only
        </div>

        {/* Body */}
        <div
          ref={scrollRef}
          className="scroll-none"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {!submittedCriterion ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="eyebrow">preset_theses</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => runAlpha(p)}
                    className="lifi-summary"
                    disabled={isStreaming}
                    style={{
                      padding: '10px 12px',
                      textAlign: 'left',
                      cursor: isStreaming ? 'wait' : 'pointer',
                      fontSize: 13,
                      color: 'var(--ink-900)',
                      fontFamily: 'inherit',
                      border: '1px solid var(--ink-300)',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Picks */}
              {picks.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span className="eyebrow">picks</span>
                  {picks.map((pick) => (
                    <PickCard key={`${pick.n}-${pick.side}`} pick={pick} onSelect={selectPick} />
                  ))}
                </div>
              ) : (
                streamText &&
                !isStreaming && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--ink-700)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {streamText}
                  </div>
                )
              )}

              {/* Streaming status */}
              {isStreaming && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--ink-600)',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <span style={{ animation: 'pulse 1.4s ease-in-out infinite' }}>✦</span>
                  <span>
                    {isSearching
                      ? 'Searching the web…'
                      : picks.length > 0
                        ? 'Ranking more picks…'
                        : 'Scanning catalog…'}
                  </span>
                </div>
              )}

              {/* Citations */}
              {citations.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    paddingTop: 8,
                    borderTop: '1px dashed var(--ink-300)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <span className="eyebrow" style={{ fontSize: 10 }}>
                    sources
                  </span>
                  {citations
                    .slice()
                    .sort((a, b) => a.index - b.index)
                    .map((c) => (
                      <a
                        key={c.index}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={c.title}
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-600)',
                          textDecoration: 'none',
                          wordBreak: 'break-all',
                        }}
                      >
                        <span style={{ color: 'var(--warning, #FBBF24)' }}>[{c.index}]</span>{' '}
                        {hostFromUrl(c.url)}
                      </a>
                    ))}
                </div>
              )}

              {/* Error */}
              {error && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--danger)',
                    border: '1px solid rgba(248, 113, 113, 0.3)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: 'rgba(248, 113, 113, 0.08)',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Done */}
              {!isStreaming && (
                <button
                  type="button"
                  onClick={reset}
                  className="btn-secondary"
                  style={{ alignSelf: 'flex-start', padding: '7px 16px', fontSize: 12 }}
                >
                  New search
                </button>
              )}
            </>
          )}
        </div>

        {/* Input */}
        {!submittedCriterion && (
          <form
            onSubmit={onSubmit}
            style={{
              padding: 12,
              borderTop: '1px solid var(--ink-300)',
              display: 'flex',
              gap: 8,
            }}
          >
            <div
              className="lifi-field"
              style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 12px', height: 40 }}
            >
              <input
                type="text"
                placeholder="…or describe a thesis"
                value={criterion}
                onChange={(e) => setCriterion(e.target.value)}
                disabled={isStreaming}
                maxLength={500}
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
            <button
              type="submit"
              disabled={isStreaming}
              className="btn-accent"
              style={{ padding: '0 16px', height: 40 }}
            >
              {isStreaming ? '…' : 'Run alpha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function PickCard({ pick, onSelect }: { pick: Pick; onSelect: (pick: Pick) => void }) {
  const isYes = pick.side === 'yes'
  return (
    <div
      className="lifi-card"
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span
          className={isYes ? 'badge-yes' : 'badge-no'}
          style={{ flexShrink: 0, fontSize: 11 }}
        >
          <span
            className="badge-dot"
            style={{ background: isYes ? 'var(--success)' : 'var(--danger)' }}
          />
          Buy {pick.side.toUpperCase()} at {pick.priceCents}¢
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-600)',
            fontFamily: "'JetBrains Mono', monospace",
            marginTop: 3,
          }}
        >
          [{pick.n}]
        </span>
      </div>
      <p
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink-900)',
          lineHeight: 1.4,
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        {pick.title}
      </p>
      <p
        style={{
          fontSize: 12,
          color: 'var(--ink-700)',
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {pick.rationale}
      </p>
      <button
        type="button"
        onClick={() => onSelect(pick)}
        className="btn-accent"
        style={{
          alignSelf: 'flex-start',
          padding: '6px 14px',
          fontSize: 12,
        }}
      >
        Trade this pick →
      </button>
    </div>
  )
}
