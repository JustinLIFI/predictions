'use client'

interface AskAIButtonProps {
  onClick: () => void
  compact?: boolean
  ariaLabel?: string
  disabled?: boolean
}

export function AskAIButton({
  onClick,
  compact = false,
  ariaLabel = 'Ask AI',
  disabled = false,
}: AskAIButtonProps) {
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        onClick()
      }}
      onKeyDown={(e) => {
        if (disabled) return
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
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        letterSpacing: '0.02em',
        lineHeight: 1.2,
        transition: 'background 150ms, border-color 150ms',
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = 'rgba(247, 194, 255, 0.15)'
        e.currentTarget.style.borderColor = 'rgba(247, 194, 255, 0.45)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = 'rgba(247, 194, 255, 0.08)'
        e.currentTarget.style.borderColor = 'rgba(247, 194, 255, 0.25)'
      }}
    >
      <span aria-hidden="true">✦</span>
      ASK_AI
    </span>
  )
}
