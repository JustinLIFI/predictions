'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import {
  claimPayout,
  formatPrice,
  formatProbability,
  getMarket,
  getPositions,
} from '@lifi/prediction-sdk'
import type { Position } from '@lifi/prediction-sdk'
import { predictionClient } from '../lib/client'

function StatField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="field-value">{value}</div>
    </div>
  )
}

function PositionRow({
  position,
  onClaim,
  claiming,
}: {
  position: Position
  onClaim: (positionPubkey: string) => void
  claiming: boolean
}) {
  const { data: marketData } = useQuery({
    queryKey: ['market', position.marketId],
    queryFn: () => getMarket(predictionClient, position.marketId),
    staleTime: 30_000,
  })

  const pnl = formatPrice(position.unrealizedPnl)
  const value = formatPrice(position.valueUsd)
  const payout = formatPrice(position.payoutUsd ?? 0)
  const pnlPositive = pnl >= 0

  return (
    <div className="lifi-card" style={{ padding: 14 }}>
      {/* Title + side badge */}
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 10 }}>
        <p
          className="line-clamp-2"
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--ink-900)',
            lineHeight: 1.45,
            letterSpacing: '-0.01em',
            flex: 1,
          }}
        >
          {marketData?.market.title ?? (
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: 'var(--ink-600)',
              }}
            >
              {position.marketId.slice(0, 20)}…
            </span>
          )}
        </p>
        <span
          className={position.side === 'yes' ? 'badge-yes' : 'badge-no'}
          style={{ flexShrink: 0 }}
        >
          <span
            className="badge-dot"
            style={{ background: position.side === 'yes' ? 'var(--success)' : 'var(--danger)' }}
          />
          {position.side.toUpperCase()}
        </span>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px 8px',
          marginBottom: 10,
        }}
      >
        <StatField label="Contracts" value={String(position.contracts)} />
        <StatField label="Avg price" value={formatProbability(position.avgPriceUsd)} />
        <StatField label="Value" value={`$${value.toFixed(2)}`} />
      </div>

      {/* P&L + claim */}
      <div className="flex items-center justify-between">
        {position.claimable && !position.claimed ? (
          <span style={{ fontSize: 11, color: 'var(--ink-600)' }}>Settled</span>
        ) : (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: pnlPositive ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {pnlPositive ? '+' : ''}${pnl.toFixed(2)} P&amp;L
          </span>
        )}

        {position.claimable && !position.claimed && (
          <button
            type="button"
            onClick={() => onClaim(position.positionPubkey)}
            disabled={claiming}
            className="btn-accent"
            style={{ padding: '6px 14px', fontSize: 11, borderRadius: 8 }}
          >
            {claiming ? 'Claiming…' : `Claim $${payout.toFixed(2)}`}
          </button>
        )}

        {position.claimed && (
          <span style={{ fontSize: 11, color: 'var(--ink-500)', fontStyle: 'italic' }}>Claimed</span>
        )}
      </div>
    </div>
  )
}

export function PositionTracker() {
  const { publicKey, signTransaction, connected } = useWallet()
  const { connection } = useConnection()
  const [claimingPubkey, setClaimingPubkey] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['positions', publicKey?.toString()],
    queryFn: () => getPositions(predictionClient, publicKey!.toString()),
    enabled: !!publicKey,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  async function handleClaim(positionPubkey: string) {
    if (!publicKey || !signTransaction) return
    setClaimingPubkey(positionPubkey)
    try {
      const { transaction } = await claimPayout(predictionClient, {
        ownerPubkey: publicKey.toString(),
        positionPubkeys: [positionPubkey],
      })
      const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'))
      const signedTx = await signTransaction(tx)
      await connection.sendRawTransaction(signedTx.serialize(), {
        maxRetries: 0,
        skipPreflight: true,
      })
      await refetch()
    } catch (err) {
      console.error('Claim failed:', err)
    } finally {
      setClaimingPubkey(null)
    }
  }

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
          {[0, 1].map((i) => (
            <div
              key={i}
              className="lifi-card animate-pulse"
              style={{ height: 96 }}
            />
          ))}
        </div>
      </div>
    )
  }

  const positions = data?.positions ?? []

  if (positions.length === 0) {
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
          <span className="eyebrow">no_positions</span>
        </div>
      </div>
    )
  }

  return (
    <div className="lifi-panel" style={{ padding: 14 }}>
      <div className="flex flex-col gap-2">
        {positions.map((position) => (
          <PositionRow
            key={position.positionPubkey}
            position={position}
            onClaim={handleClaim}
            claiming={claimingPubkey === position.positionPubkey}
          />
        ))}
      </div>
    </div>
  )
}
