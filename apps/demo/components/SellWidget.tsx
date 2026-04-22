'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import {
  createSellOrder,
  formatPrice,
  getMarket,
  pollOrderStatus,
} from '@lifi/prediction-sdk'
import type { Position } from '@lifi/prediction-sdk'
import { predictionClient } from '../lib/client'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

type SellState = 'idle' | 'confirming' | 'pending' | 'filled' | 'failed'

function estimateFee(priceUsd: number, contracts: number): number {
  if (priceUsd <= 0 || contracts <= 0) return 0
  const feePerContract = priceUsd < 0.15 ? 0.01 : 0.02
  return contracts * feePerContract
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="field-label" style={{ marginBottom: 0 }}>
        {label}
      </span>
      <span className="field-value">{value}</span>
    </div>
  )
}

interface SellWidgetProps {
  position: Position
  onSuccess?: (orderPubkey: string) => void
  onCancel?: () => void
}

export function SellWidget({ position, onSuccess, onCancel }: SellWidgetProps) {
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const queryClient = useQueryClient()

  const [contractsInput, setContractsInput] = useState(String(position.contracts))
  const [sellState, setSellState] = useState<SellState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const { data: marketData, isLoading } = useQuery({
    queryKey: ['market', position.marketId],
    queryFn: () => getMarket(predictionClient, position.marketId),
    staleTime: 30_000,
  })

  const market = marketData?.market

  const sellPriceMicro = market
    ? position.side === 'yes'
      ? market.pricing.sellYesPriceUsd
      : market.pricing.sellNoPriceUsd
    : 0
  const sellPriceUsd = formatPrice(sellPriceMicro)

  const parsedContracts = Math.floor(Number(contractsInput) || 0)
  const clampedContracts = Math.max(
    0,
    Math.min(parsedContracts, position.contracts),
  )

  const avgPriceUsd = formatPrice(position.avgPriceUsd)
  const estProceeds = sellPriceUsd * clampedContracts
  const estCostBasis = avgPriceUsd * clampedContracts
  const estRealizedPnl = estProceeds - estCostBasis
  const estFee = estimateFee(sellPriceUsd, clampedContracts)

  const marketClosed = market ? market.status !== 'open' : false
  const noLiquidity = !!market && sellPriceMicro <= 0

  const isSelling = sellState === 'confirming' || sellState === 'pending'
  const canSell =
    !!publicKey &&
    !!signTransaction &&
    !!market &&
    !marketClosed &&
    !noLiquidity &&
    clampedContracts > 0 &&
    !isSelling

  async function handleSell() {
    if (!publicKey || !signTransaction || !market) return
    setErrorMessage('')
    setSellState('confirming')

    try {
      const { transaction, order, txMeta } = await createSellOrder(
        predictionClient,
        {
          ownerPubkey: publicKey.toString(),
          positionPubkey: position.positionPubkey,
          isYes: position.side === 'yes',
          contracts: clampedContracts,
          depositMint: USDC_MINT,
        },
      )

      const tx = VersionedTransaction.deserialize(
        Buffer.from(transaction, 'base64'),
      )
      const signedTx = await signTransaction(tx)

      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
        { maxRetries: 3 },
      )

      setSellState('pending')

      await connection.confirmTransaction(
        {
          signature,
          blockhash: txMeta.blockhash,
          lastValidBlockHeight: txMeta.lastValidBlockHeight,
        },
        'confirmed',
      )

      const status = await pollOrderStatus(predictionClient, order.orderPubkey, {
        intervalMs: 2_000,
        timeoutMs: 60_000,
      })

      if (status.status === 'filled') {
        setSellState('filled')
        queryClient.invalidateQueries({
          queryKey: ['positions', publicKey.toString()],
        })
        onSuccess?.(order.orderPubkey)
      } else {
        setSellState('failed')
        setErrorMessage('Sell order failed to fill. Please try again.')
      }
    } catch (err) {
      setSellState('failed')
      setErrorMessage(err instanceof Error ? err.message : 'Transaction failed')
    }
  }

  if (isLoading) {
    return (
      <div
        className="lifi-summary animate-pulse"
        style={{ padding: 12, marginTop: 10, height: 120 }}
      />
    )
  }

  if (!market) return null

  if (sellState === 'filled') {
    return (
      <div
        className="lifi-summary flex items-center justify-between"
        style={{ padding: '10px 14px', marginTop: 10 }}
      >
        <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
          ✓ Sold {clampedContracts} contract{clampedContracts === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
          style={{ padding: '4px 12px', fontSize: 11 }}
        >
          Close
        </button>
      </div>
    )
  }

  return (
    <div
      className="lifi-summary"
      style={{
        padding: 12,
        marginTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Contracts input */}
      <div
        className="lifi-field flex items-center gap-2"
        style={{ padding: '0 12px', height: 44 }}
      >
        <input
          type="number"
          min="0"
          step="1"
          max={position.contracts}
          value={contractsInput}
          onChange={(e) => setContractsInput(e.target.value)}
          disabled={isSelling}
          style={{
            flex: 1,
            background: 'transparent',
            border: 0,
            outline: 'none',
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--ink-900)',
            fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
            minWidth: 0,
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--ink-600)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.04em',
          }}
        >
          / {position.contracts}
        </span>
        <button
          type="button"
          onClick={() => setContractsInput(String(position.contracts))}
          disabled={isSelling}
          className="btn-secondary"
          style={{ padding: '3px 10px', fontSize: 10, borderRadius: 6 }}
        >
          Max
        </button>
      </div>

      {/* Summary */}
      {clampedContracts > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SummaryRow
            label="Sell price"
            value={`$${sellPriceUsd.toFixed(2)}`}
          />
          <SummaryRow
            label="Est. proceeds"
            value={`$${estProceeds.toFixed(2)}`}
          />
          <SummaryRow
            label="Est. realised P&L"
            value={`${estRealizedPnl >= 0 ? '+' : ''}$${estRealizedPnl.toFixed(2)}`}
          />
          <SummaryRow label="Est. fee" value={`~$${estFee.toFixed(3)}`} />
        </div>
      )}

      {/* Inline status / error */}
      {noLiquidity && (
        <p
          style={{
            fontSize: 11,
            color: 'var(--ink-600)',
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.04)',
          }}
        >
          No bid available right now.
        </p>
      )}

      {marketClosed && (
        <p style={{ fontSize: 11, color: 'var(--ink-600)' }}>
          Market is closed — waiting for settlement.
        </p>
      )}

      {errorMessage && (
        <p
          style={{
            fontSize: 11,
            color: 'var(--danger)',
            padding: '6px 10px',
            background: 'rgba(248,113,113,0.08)',
            borderRadius: 6,
            border: '1px solid rgba(248,113,113,0.2)',
          }}
        >
          {errorMessage}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSelling}
          className="btn-secondary"
          style={{ padding: '8px 14px', fontSize: 11, flex: 1 }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSell}
          disabled={!canSell}
          className="btn-accent"
          style={{ padding: '8px 14px', fontSize: 11, flex: 2 }}
        >
          {sellState === 'confirming'
            ? 'Sign in wallet…'
            : sellState === 'pending'
              ? 'Waiting for fill…'
              : clampedContracts === position.contracts
                ? `Sell all (${clampedContracts})`
                : `Sell ${clampedContracts}`}
        </button>
      </div>
    </div>
  )
}
