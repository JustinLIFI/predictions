'use client'

import { useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { ClientOnly } from '../components/ClientOnly'
import { HistoryPanel } from '../components/HistoryPanel'
import { MarketBrowser } from '../components/MarketBrowser'
import { PositionTracker } from '../components/PositionTracker'
import { TradeWidget } from '../components/TradeWidget'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="section-label">{children}</span>
}

export default function Home() {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null)

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--ink-0)' }}>
      {/* Ambient halo */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background:
            'radial-gradient(ellipse 60% 40% at 15% 5%, rgba(247,194,255,0.07) 0%, transparent 70%), ' +
            'radial-gradient(ellipse 50% 35% at 85% 90%, rgba(92,103,255,0.07) 0%, transparent 70%)',
        }}
      />

      {/* Header */}
      <header
        className="shrink-0 flex items-center justify-between px-6"
        style={{
          height: 60,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--ink-200)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_lifi_dark_horizontal.svg" alt="LI.FI" style={{ height: 22 }} />
        <ClientOnly>
          <WalletMultiButton />
        </ClientOnly>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0" style={{ position: 'relative', zIndex: 1 }}>
        <div className="h-full flex gap-6 p-6 mx-auto" style={{ maxWidth: 1200 }}>
          {/* Left: market browser (scrolls internally) */}
          <section className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
            <SectionLabel>Markets</SectionLabel>
            <MarketBrowser onSelectMarket={setSelectedMarketId} selectedMarketId={selectedMarketId} />
          </section>

          {/* Right sidebar: trade + positions */}
          <aside
            className="shrink-0 flex flex-col gap-5 overflow-y-auto scroll-none"
            style={{ width: 320 }}
          >
            <div className="flex flex-col gap-3">
              <SectionLabel>Trade</SectionLabel>
              {selectedMarketId ? (
                <TradeWidget marketId={selectedMarketId} />
              ) : (
                <div
                  className="lifi-panel flex items-center justify-center"
                  style={{ padding: 32, minHeight: 120 }}
                >
                  <span className="eyebrow">select_market</span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <SectionLabel>Positions</SectionLabel>
              <PositionTracker />
            </div>

            <div className="flex flex-col gap-3">
              <SectionLabel>History</SectionLabel>
              <HistoryPanel />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
