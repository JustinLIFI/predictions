'use client'

interface AlphaButtonProps {
  onClick: () => void
  disabled?: boolean
}

export function AlphaButton({ onClick, disabled = false }: AlphaButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Alpha — investment picks"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--warning, #FBBF24)',
        background: 'rgba(251, 191, 36, 0.08)',
        border: '1px solid rgba(251, 191, 36, 0.3)',
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        letterSpacing: '0.04em',
        lineHeight: 1.2,
        transition: 'background 150ms, border-color 150ms',
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = 'rgba(251, 191, 36, 0.16)'
        e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.5)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = 'rgba(251, 191, 36, 0.08)'
        e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.3)'
      }}
    >
      <span aria-hidden="true">✦</span>
      ALPHA
    </button>
  )
}
