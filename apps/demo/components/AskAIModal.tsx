'use client'

import { useEffect, useRef, useState } from 'react'
import { formatProbability, type Market } from '@lifi/prediction-sdk'

interface AskAIModalProps {
  market: Market
  onClose: () => void
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Summarise this market in plain English.',
  'What do the resolution rules actually require?',
  'What would make YES resolve?',
  'What key dates matter for this market?',
]

export function AskAIModal({ market, onClose }: AskAIModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
  }, [messages])

  async function sendMessage(prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed || isStreaming) return

    const next: ChatMessage[] = [
      ...messages,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '' },
    ]
    setMessages(next)
    setInput('')
    setError(null)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          market,
          messages: next
            .filter((m, i) => !(i === next.length - 1 && m.role === 'assistant'))
            .map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const copy = prev.slice()
          const last = copy[copy.length - 1]
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, content: buffer }
          }
          return copy
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      setMessages((prev) => {
        const copy = prev.slice()
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant' && last.content === '') {
          copy.pop()
        }
        return copy
      })
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  const yesPct = formatProbability(market.pricing.buyYesPriceUsd)
  const noPct = formatProbability(market.pricing.buyNoPriceUsd)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI about this market"
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
          maxWidth: 560,
          maxHeight: '85vh',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="section-label">ASK_AI</span>
              <span className="badge-yes" style={{ fontSize: 10, padding: '1px 6px' }}>
                YES {yesPct}
              </span>
              <span className="badge-no" style={{ fontSize: 10, padding: '1px 6px' }}>
                NO {noPct}
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink-900)',
                lineHeight: 1.45,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {market.title}
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

        {/* Messages */}
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
            gap: 10,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="eyebrow">suggested_questions</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="lifi-summary"
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--ink-900)',
                    fontFamily: 'inherit',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
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
        </div>

        {/* Input */}
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
              placeholder="Ask about this market…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isStreaming}
              autoFocus
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
            disabled={isStreaming || input.trim().length === 0}
            className="btn-accent"
            style={{ padding: '0 16px', height: 40 }}
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '9px 12px',
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--ink-900)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: isUser ? 'var(--ink-300)' : 'var(--ink-100)',
          border: isUser ? 'none' : '1px solid var(--ink-300)',
        }}
      >
        {message.content || <span style={{ color: 'var(--ink-600)' }}>…</span>}
      </div>
    </div>
  )
}
