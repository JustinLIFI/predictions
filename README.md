# LI.FI Prediction SDK

TypeScript SDK for trading Solana prediction markets (Kalshi events via Jupiter) through LI.FI.

This is a pnpm monorepo:

- `packages/sdk/` — `@lifi/prediction-sdk`, headless TypeScript SDK
- `apps/demo/` — Next.js demo app showcasing the SDK

## Prerequisites

- Node 18+
- pnpm 10+

## Running locally

```bash
pnpm install
pnpm --filter @lifi/prediction-sdk build
cp apps/demo/.env.example apps/demo/.env.local   # then fill in values
pnpm --filter demo dev
```

Open http://localhost:3000.

The demo imports the SDK from its built output (`packages/sdk/dist`), so rebuild after SDK changes — or run `pnpm --filter @lifi/prediction-sdk dev` in a second terminal for watch mode.

## SDK usage

```ts
import { createPredictionClient, getEvents } from '@lifi/prediction-sdk'

const client = createPredictionClient({ integrator: 'my-app', apiKey: '...' })
const { events } = await getEvents(client, { category: 'crypto', filter: 'trending' })
```

See `packages/sdk/src/index.ts` for the full exported surface.

## License

MIT
