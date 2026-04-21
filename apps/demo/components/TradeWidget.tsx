'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { VersionedTransaction } from '@solana/web3.js'
import {
  createOrder,
  formatProbability,
  getMarket,
  pollOrderStatus,
} from '@lifi/prediction-sdk'
import { predictionClient } from '../lib/client'

const JUP_USD_MINT = 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD'

type TradeState = 'idle' | 'confirming' | 'pending' | 'filled' | 'failed'

function estimateFee(priceUsd: number, depositUsd: number): number {
  if (priceUsd <= 0 || depositUsd <= 0) return 0
  const contracts = depositUsd / priceUsd
  const feePerContract = priceUsd < 0.15 ? 0.01 : 0.02
  return contracts * feePerContract
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="field-label" style={{ marginBottom: 0 }}>{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

interface TradeWidgetProps {
  marketId: string
  onSuccess?: (orderPubkey: string) => void
}

export function TradeWidget({ marketId, onSuccess }: TradeWidgetProps) {
  const { publicKey, signTransaction, connected } = useWallet()
  const { connection } = useConnection()

  const [side, setSide] = useState<'yes' | 'no'>('yes')
  const [amountInput, setAmountInput] = useState('')
  const [tradeState, setTradeState] = useState<TradeState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [filledOrderPubkey, setFilledOrderPubkey] = useState('')

  const { data: marketData, isLoading, isError, error } = useQuery({
    queryKey: ['market', marketId],
    queryFn: async () => {
      const result = await getMarket(predictionClient, marketId)
      console.log('[TradeWidget] getMarket result:', result)
      return result
    },
    staleTime: 30_000,
    retry: 1,
  })

  const market = marketData?.market
  const depositUsd = parseFloat(amountInput) || 0
  const depositMicroUsdc = Math.round(depositUsd * 1_000_000)

  const buyPriceMicro = market
    ? side === 'yes'
      ? market.pricing.buyYesPriceUsd
      : market.pricing.buyNoPriceUsd
    : 0
  const buyPriceUsd = buyPriceMicro / 1_000_000
  const estimatedFee = estimateFee(buyPriceUsd, depositUsd)
  const estimatedContracts =
    buyPriceUsd > 0 && depositUsd > 0 ? (depositUsd / buyPriceUsd).toFixed(1) : '—'

  const isTrading = tradeState === 'confirming' || tradeState === 'pending'
  const canTrade = connected && depositUsd > 0 && !isTrading

  async function handleTrade() {
    if (!publicKey || !signTransaction || !market) return
    setErrorMessage('')
    setTradeState('confirming')

    try {
      const { transaction, order } = await createOrder(predictionClient, {
        ownerPubkey: publicKey.toString(),
        marketId,
        isYes: side === 'yes',
        isBuy: true,
        depositAmount: depositMicroUsdc.toString(),
        depositMint: JUP_USD_MINT,
      })

      const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'))
      const signedTx = await signTransaction(tx)

      await connection.sendRawTransaction(signedTx.serialize(), {
        maxRetries: 0,
        skipPreflight: true,
      })

      setTradeState('pending')

      const status = await pollOrderStatus(predictionClient, order.orderPubkey, {
        intervalMs: 2_000,
        timeoutMs: 60_000,
      })

      if (status.status === 'filled') {
        setTradeState('filled')
        setFilledOrderPubkey(order.orderPubkey)
        onSuccess?.(order.orderPubkey)
      } else {
        setTradeState('failed')
        setErrorMessage('Order failed to fill. Please try again.')
      }
    } catch (err) {
      setTradeState('failed')
      setErrorMessage(err instanceof Error ? err.message : 'Transaction failed')
    }
  }

  function reset() {
    setTradeState('idle')
    setErrorMessage('')
    setFilledOrderPubkey('')
    setAmountInput('')
  }

  if (isLoading) {
    return (
      <div className="lifi-panel animate-pulse" style={{ padding: 20 }}>
        <div style={{ height: 13, borderRadius: 6, background: 'var(--ink-300)', width: '80%', marginBottom: 18 }} />
        <div style={{ height: 44, borderRadius: 10, background: 'var(--ink-300)', marginBottom: 10 }} />
        <div style={{ height: 52, borderRadius: 12, background: 'var(--ink-300)', marginBottom: 10 }} />
        <div style={{ height: 48, borderRadius: 12, background: 'var(--ink-300)' }} />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="lifi-panel" style={{ padding: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>
          Failed to load market
        </p>
        <p
          style={{
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--ink-600)',
            wordBreak: 'break-all',
            lineHeight: 1.5,
          }}
        >
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  if (!market) return null

  if (tradeState === 'filled') {
    return (
      <div
        className="lifi-panel flex flex-col items-center text-center gap-4"
        style={{ padding: 28 }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'rgba(52,211,153,0.12)',
            border: '1px solid rgba(52,211,153,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--success)',
            fontSize: 18,
          }}
        >
          ✓
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 6 }}>
            Order filled
          </p>
          <p
            style={{
              fontSize: 10,
              color: 'var(--ink-600)',
              fontFamily: "'JetBrains Mono', monospace",
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}
          >
            {filledOrderPubkey}
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="btn-secondary"
          style={{ padding: '8px 20px' }}
        >
          Trade again
        </button>
      </div>
    )
  }

  return (
    <div className="lifi-panel" style={{ padding: 16 }}>
      {/* Market title */}
      <p
        className="line-clamp-2"
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink-900)',
          lineHeight: 1.45,
          letterSpacing: '-0.01em',
          marginBottom: 14,
        }}
      >
        {market.title}
      </p>

      {/* YES / NO toggle */}
      <div className="side-toggle" style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setSide('yes')}
          className={`side-btn ${side === 'yes' ? 'side-btn-yes' : 'side-btn-inactive'}`}
        >
          YES {formatProbability(market.pricing.buyYesPriceUsd)}
        </button>
        <button
          type="button"
          onClick={() => setSide('no')}
          className={`side-btn ${side === 'no' ? 'side-btn-no' : 'side-btn-inactive'}`}
        >
          NO {formatProbability(market.pricing.buyNoPriceUsd)}
        </button>
      </div>

      {/* Amount input */}
      <div
        className="lifi-field flex items-center gap-2"
        style={{ padding: '0 14px', height: 52, marginBottom: 10 }}
      >
        <span
          style={{
            fontSize: 20,
            fontWeight: 500,
            color: 'var(--ink-600)',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          $
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 0,
            outline: 'none',
            fontSize: 20,
            fontWeight: 500,
            color: 'var(--ink-900)',
            fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
            minWidth: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink-600)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          USDC
        </span>
      </div>

      {/* Order summary */}
      {depositUsd > 0 && (
        <div
          className="lifi-summary"
          style={{ padding: '10px 14px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 7 }}
        >
          <SummaryRow label="Est. contracts" value={estimatedContracts} />
          <SummaryRow label="Est. fee" value={`~$${estimatedFee.toFixed(3)}`} />
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--danger)',
            marginBottom: 10,
            padding: '8px 12px',
            background: 'rgba(248,113,113,0.08)',
            borderRadius: 8,
            border: '1px solid rgba(248,113,113,0.2)',
          }}
        >
          {errorMessage}
        </p>
      )}

      {/* CTA */}
      {!connected ? (
        <WalletMultiButton className="!w-full !justify-center" />
      ) : (
        <button
          type="button"
          onClick={handleTrade}
          disabled={!canTrade}
          className="btn-accent w-full"
          style={{ padding: '13px 0' }}
        >
          {tradeState === 'confirming'
            ? 'Sign in wallet…'
            : tradeState === 'pending'
              ? 'Waiting for fill…'
              : `Buy ${side.toUpperCase()}`}
        </button>
      )}
    </div>
  )
}
