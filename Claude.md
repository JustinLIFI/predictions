# LI.FI Prediction SDK

## What this project is
A TypeScript SDK for trading Solana prediction markets (Kalshi events via Jupiter)
through a unified interface — to be published as @lifi/prediction-sdk on npm.
Built for the LI.FI hackathon POC. Mirrors the conventions of @lifi/perps-sdk.

DFlow is explicitly OUT OF SCOPE for this POC due to Kalshi KYC compliance requirements.
Jupiter only.

---

## Repo structure

```
lifi-prediction-sdk/
├── packages/sdk/           ← @lifi/prediction-sdk (pure TypeScript, NO UI)
│   └── src/
│       ├── client.ts       ← createPredictionClient() factory + PredictionClient class
│       ├── types.ts        ← all exported TypeScript interfaces
│       ├── utils.ts        ← formatPrice(), formatProbability(), helpers
│       ├── providers/
│       │   └── jupiter.ts  ← all Jupiter API calls
│       └── index.ts        ← public exports
├── apps/demo/              ← Next.js 16 demo app with React UI
│   ├── app/                ← Next.js App Router
│   └── components/
│       ├── MarketBrowser.tsx
│       ├── TradeWidget.tsx
│       └── PositionTracker.tsx
├── pnpm-workspace.yaml
└── CLAUDE.md
```

---

## SDK design — mirror @lifi/perps-sdk exactly

The SDK package is HEADLESS. Zero UI components inside packages/sdk.
All React components live in apps/demo/components only.

### Two levels of API (same as perps-sdk):

**1. Functional (preferred for tree-shaking):**
```ts
import { createPredictionClient, getEvents, getMarket, createOrder } from '@lifi/prediction-sdk'

const client = createPredictionClient({ integrator: 'my-app', apiKey: 'your-api-key' })
const { events } = await getEvents(client, { category: 'crypto', filter: 'trending' })
const { market } = await getMarket(client, { marketId: 'market-123' })
```

**2. Class-based (convenience):**
```ts
import { PredictionClient } from '@lifi/prediction-sdk'

const prediction = new PredictionClient({ integrator: 'my-app', apiKey: 'your-api-key' })
await prediction.getEvents({ category: 'crypto' })
await prediction.createOrder({ marketId, side: 'yes', depositAmount: '2000000', ownerPubkey })
```

### Config interface:
```ts
interface PredictionClientConfig {
  integrator: string      // required — identifies the partner (e.g. 'my-wallet-app')
  apiKey?: string         // optional — LI.FI Partner Portal key for higher rate limits
  apiUrl?: string         // optional — defaults to develop.li.quest/v1/prediction
}
```

---

## Backend API

ALL Jupiter Prediction API calls are proxied through LI.FI's own backend.
Do NOT call Jupiter directly from the SDK or demo app.

Base URL: `develop.li.quest/v1/prediction`
(This is the alpha endpoint — mirrors Jupiter's API shape but routes through LI.FI)

The SDK should use this base URL by default, overridable via config.apiUrl.

Upstream (for reference only, never called directly by SDK):
  Jupiter Prediction API: https://api.jup.ag/prediction/v1
  Jupiter Auth: x-api-key header

---

## Jupiter API — full reference

### Endpoints (as proxied through develop.li.quest/v1/prediction)

**Discovery:**
- GET /events                          — list events
- GET /events/search?query=&limit=     — search events by keyword
- GET /events/:eventId                 — single event with all markets
- GET /events/suggested/:pubkey        — personalised recommendations
- GET /markets/:marketId               — market details + current pricing
- GET /orderbook/:marketId             — bid/ask depth
- GET /trading-status                  — is exchange active?

**Query params for GET /events:**
- category: crypto | sports | politics | esports | culture | economics | tech
- subcategory: string
- filter: new | live | trending
- includeMarkets: boolean
- sortBy, sortDirection: asc | desc
- start, end: pagination

**Trading:**
- POST /orders                         — create buy OR sell order, returns unsigned tx
- GET /orders/:orderPubkey             — fetch order data (status, filledContracts, avgFillPriceUsd…)
- GET /positions/:ownerPubkey          — all open positions for wallet
- DELETE /positions/:positionPubkey    — close entire position (convenience, full-size sell)
- GET /history/:ownerPubkey            — full trading history

Note: there is NO `/orders/sell` endpoint. Sells go through `POST /orders` with
`isBuy: false` and a `positionPubkey` instead of a `marketId`.

**Payouts:**
- GET /vault/claimable/:ownerPubkey    — positions ready to claim
- POST /vault/claim                    — claim winning payout

### POST /orders request body (buy):
```ts
{
  ownerPubkey: string       // wallet public key (base58)
  marketId: string          // from market data
  isYes: boolean            // true = buy YES, false = buy NO
  isBuy: true               // true when opening/adding to a position
  depositAmount: string     // in micro-USDC (e.g. "2000000" = $2.00)
  depositMint: string       // JupUSD or USDC mint address
}
```

### POST /orders request body (sell):
```ts
{
  ownerPubkey: string       // wallet public key (base58)
  positionPubkey: string    // from GET /positions — identifies what to sell
  isYes: boolean            // must match position.side
  isBuy: false              // false = closing / reducing a position
  contracts: number         // integer, how many contracts to sell
  depositMint: string       // USDC mint address
}
```

### POST /orders response:
```ts
{
  transaction: string       // base64-encoded unsigned Solana VersionedTransaction
  txMeta: {
    blockhash: string
    lastValidBlockHeight: number
  }
  order: {
    orderPubkey: string     // use this to poll status
    positionPubkey: string
    contracts: number
  }
}
```

### GET /orders/:orderPubkey response (relevant fields):
```ts
{
  pubkey: string
  status: 'pending' | 'filled' | 'failed'
  filledContracts: string       // u64 — call Number() before use
  avgFillPriceUsd: string       // u64 micro-USDC — Number() then formatPrice()
  filledAt: number              // unix seconds; 0 while pending
  // …plus market/event metadata
}
```

NOTE: there is NO `/orders/status/:pubkey` endpoint. Use `/orders/:pubkey`.

The order account is closed on-chain after a successful fill, so this endpoint
returns 404 once the keeper completes the order. The SDK's `pollOrderStatus`
treats a 404 as `{ status: 'filled' }` for that reason.

---

## CRITICAL: Price format

ALL prices from Jupiter are in micro-USDC: 1,000,000 = $1.00

```ts
// Raw from API:
buyYesPriceUsd: 650000    // means $0.65 or 65% probability

// Always convert before use:
export const formatPrice = (microUsdc: number): number => microUsdc / 1_000_000
export const formatProbability = (microUsdc: number): string =>
  `${(microUsdc / 10_000).toFixed(1)}%`

// Display:
buyYesPriceUsd: 650000  →  "$0.65"  or  "65%"
buyNoPriceUsd:  380000  →  "$0.38"  or  "38%"
```

NEVER expose raw micro-USDC values to consumers of the SDK or to UI users.
Export formatPrice() and formatProbability() as named exports from the SDK.

### Market pricing fields:
```ts
interface MarketPricing {
  buyYesPriceUsd: number    // cost to buy 1 YES contract (micro-USDC)
  sellYesPriceUsd: number   // proceeds from selling 1 YES contract
  buyNoPriceUsd: number     // cost to buy 1 NO contract
  sellNoPriceUsd: number    // proceeds from selling 1 NO contract
  volume: number            // total trading volume (micro-USDC)
}
```

---

## Transaction lifecycle — full flow

```ts
import { VersionedTransaction } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'

// Step 1: Create order via SDK (routes through develop.li.quest)
const { transaction, order } = await prediction.createOrder({
  ownerPubkey: wallet.publicKey.toString(),
  marketId,
  isYes: true,
  isBuy: true,
  depositAmount: '2000000',   // $2.00 in micro-USDC
  depositMint: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
})

// Step 2: Deserialise the unsigned transaction
const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'))

// Step 3: User signs via wallet adapter
const signedTx = await wallet.signTransaction(tx)

// Step 4: Broadcast to Solana
const signature = await connection.sendRawTransaction(signedTx.serialize(), {
  maxRetries: 0,
  skipPreflight: true,
})

// Step 5: Poll order status (Jupiter keepers fill the order async)
// Do NOT assume instant fill. Poll every 2s, timeout after 60s.
const status = await prediction.pollOrderStatus(order.orderPubkey, {
  intervalMs: 2000,
  timeoutMs: 60000,
})
// status.status === 'filled' | 'failed' | 'pending'
```

### Order flow on-chain:
1. User signs tx → creates order account on Solana
2. Jupiter keeper network picks up the order
3. Keeper fills against Kalshi liquidity
4. Position account updated with filled contracts
5. Order account closed

Keepers are async — a tx confirmation does NOT mean the order is filled.
Always poll /orders/status/:orderPubkey after broadcast.

---

## Fee structure

Fees are charged on executed trades only (not on resting orders, not on claims).
Fee formula (for display/estimation in UI):

```ts
// Price is in USD decimal (after formatPrice conversion)
// Approximate fee table:
// $0.10/contract → ~$0.01 fee per contract
// $0.25/contract → ~$0.02 fee per contract  
// $0.50/contract → ~$0.02 fee per contract (highest uncertainty = highest fee)

// For UI estimation, show: "~$X.XX in fees" based on price + size
// Exact fees are returned in order fill response
```

No fees on:
- Resting/unfilled orders
- Claiming payouts (winning contracts settle at $1.00 flat)

---

## Market data types — full TypeScript interfaces

```ts
interface Event {
  eventId: string
  title: string
  subtitle?: string
  category: 'crypto' | 'sports' | 'politics' | 'esports' | 'culture' | 'economics' | 'tech'
  subcategory?: string
  series?: string
  markets: Market[]
  totalTvl: number        // micro-USDC
  totalVolume: number     // micro-USDC
  closeConditions?: string
}

interface Market {
  marketId: string
  eventId: string
  title: string
  description?: string
  status: 'open' | 'closed' | 'cancelled'
  result: '' | 'pending' | 'yes' | 'no'
  openTime: number        // unix timestamp
  closeTime: number       // unix timestamp
  resolveAt?: number
  pricing: MarketPricing
  rulesPrimary?: string   // resolution criteria
}

interface Position {
  positionPubkey: string
  owner: string
  marketId: string
  side: 'yes' | 'no'
  contracts: number
  totalCostUsd: number    // micro-USDC
  avgPriceUsd: number     // micro-USDC
  valueUsd: number        // current mark-to-market (micro-USDC)
  markPriceUsd: number    // micro-USDC
  unrealizedPnl: number   // micro-USDC
  claimable: boolean
  claimed: boolean
  payoutUsd?: number      // micro-USDC, set after settlement
}
```

---

## Demo app UI components

These live in apps/demo/components/ — NOT in the SDK.

### MarketBrowser.tsx
- Fetches events via SDK on mount
- Category filter tabs: All, Crypto, Sports, Politics, Economics, Tech
- Market cards showing: title, YES% probability, NO% probability, volume, time to close
- Search input wired to /events/search
- onSelectMarket(marketId: string) callback prop
- Loading skeleton while fetching
- Uses TanStack Query for caching (staleTime: 30s)

### TradeWidget.tsx
- Props: marketId: string, onSuccess?: (orderPubkey: string) => void
- Shows market title, current YES/NO prices as probabilities
- YES / NO toggle selector
- USDC amount input (converts to micro-USDC internally)
- Fee estimate display
- "Connect Wallet" if no wallet connected
- Confirm button → runs full tx lifecycle (create → sign → broadcast → poll)
- Shows states: idle → confirming → pending (keeper filling) → filled | failed
- Uses @solana/wallet-adapter-react for wallet

### PositionTracker.tsx
- Fetches positions for connected wallet pubkey
- Shows: market title, side (YES/NO), contracts, avg price, current value, P&L
- "Claim" button for settled winning positions
- Polls every 30s for updates
- Empty state when no positions

---

## Tooling — match @lifi/perps-sdk exactly

- Language: TypeScript strict mode (`"strict": true` in tsconfig)
- Linter/formatter: **Biome** (NOT ESLint, NOT Prettier)
- Tests: **Vitest**
- Package manager: **pnpm**
- Build: tsup (outputs CJS + ESM)
- Node: v18+

### No `any` types — ever.
Define interfaces for all API responses. If unsure of shape, use `unknown` and narrow.

---

## Geo-restriction (important for testing)

Jupiter Prediction API blocks US and South Korea IPs.
The li.quest backend proxy handles this — SDK consumers do not need to worry about it.
Do not add any geo-checking logic in the SDK itself.

---

## Environment variables (apps/demo only)

```
NEXT_PUBLIC_LIFI_API_KEY=        ← from portal.li.fi, passed as apiKey to createPredictionClient
NEXT_PUBLIC_SOLANA_RPC=          ← RPC endpoint (default: https://api.mainnet-beta.solana.com)
NEXT_PUBLIC_API_URL=             ← defaults to develop.li.quest/v1/prediction
```

---

## Do NOT

- Put any React/UI code inside packages/sdk (headless SDK only)
- Call https://api.jup.ag directly — always go through develop.li.quest
- Use ESLint or Prettier (use Biome)
- Use `any` types anywhere
- Display raw micro-USDC values to users — always call formatPrice() first
- Assume order fill is synchronous — always poll /orders/status after broadcast
- Use sudo npm install
- Hardcode API keys (use .env.local)
- Include DFlow, Kalshi KYC, or Proof integration (explicitly out of scope)
EOF