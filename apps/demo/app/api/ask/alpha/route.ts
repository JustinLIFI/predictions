import Anthropic from '@anthropic-ai/sdk'
import {
  createPredictionClient,
  formatProbability,
  getEvents,
  type Position,
} from '@lifi/prediction-sdk'
import type { NextRequest } from 'next/server'
import { buildCandidateCatalog } from '@/lib/ai-context'

export const runtime = 'nodejs'

interface AlphaRequestBody {
  criterion: string
  positions?: Position[]
}

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 1536
const MAX_CRITERION_LENGTH = 500
const MAX_POSITIONS = 100
const MAX_CANDIDATES = 40
const MAX_WEB_SEARCHES = 2

const SYSTEM_PROMPT = `You are an investment advisor for Solana prediction markets. Given a catalog of live markets and a user criterion, recommend 3-5 specific plays.

Output format (strict, one block per pick, blank line between picks):
  **Buy {YES|NO} at {price}¢** on [n]. <one sentence rationale>.

Rules:
- Always recommend a side (YES or NO) and cite the current price from the catalog in cents (e.g. 62¢).
- Refer to markets ONLY by their bracket tag [n]. Do not repeat titles.
- Use web_search when recency matters; cite with superscript footnotes¹ ² ³.
- Skip markets tagged · HELD unless the user is explicitly adding to a position.
- Stay within the provided catalog. If nothing fits the criterion, say so plainly.
- End with a single "Sources:" line listing numbered hosts if you used web_search.`

function validateBody(body: unknown): AlphaRequestBody | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const criterionRaw = b.criterion
  const criterion =
    typeof criterionRaw === 'string' && criterionRaw.trim().length > 0
      ? criterionRaw.trim()
      : "What's most interesting right now?"
  if (criterion.length > MAX_CRITERION_LENGTH) return null

  const positionsRaw = b.positions
  let positions: Position[] | undefined
  if (positionsRaw !== undefined) {
    if (!Array.isArray(positionsRaw) || positionsRaw.length > MAX_POSITIONS) return null
    for (const p of positionsRaw) {
      if (!p || typeof p !== 'object') return null
      const pp = p as Record<string, unknown>
      if (typeof pp.positionPubkey !== 'string' || typeof pp.marketId !== 'string') return null
    }
    positions = positionsRaw as Position[]
  }

  return { criterion, positions }
}

function summarizePositions(positions: Position[]): string {
  const lines = positions.map((p, i) => {
    const avg = formatProbability(p.avgPriceUsd)
    const mark = formatProbability(p.markPriceUsd)
    return `  ${i + 1}. ${p.marketId} · ${p.side.toUpperCase()} · ${p.contracts} contracts · avg ${avg} → mark ${mark}`
  })
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }

  let parsed: AlphaRequestBody | null
  try {
    const body = (await req.json()) as unknown
    parsed = validateBody(body)
  } catch {
    parsed = null
  }
  if (!parsed) {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const { criterion, positions } = parsed

  const server = createPredictionClient({
    integrator: 'lifi-prediction-demo',
    apiUrl: 'https://api.jup.ag/prediction/v1',
  })

  let candidatesBlock: string
  let catalogEvent: {
    type: 'catalog'
    candidates: { n: number; marketId: string; title: string; buyYesPriceUsd: number; buyNoPriceUsd: number }[]
  }
  try {
    const [trending, live] = await Promise.all([
      getEvents(server, { filter: 'trending', includeMarkets: true }),
      getEvents(server, { filter: 'live', includeMarkets: true }),
    ])
    const events = [...trending.events, ...live.events]
    const heldMarketIds = new Set((positions ?? []).map((p) => p.marketId))
    const { candidates, contextString } = buildCandidateCatalog(
      events,
      MAX_CANDIDATES,
      heldMarketIds,
    )
    candidatesBlock = contextString
    catalogEvent = { type: 'catalog', candidates }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch candidate markets.'
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (catalogEvent.candidates.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No open markets available right now.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )
  }

  const positionsBlock =
    positions && positions.length > 0
      ? `\n\n--- Your positions ---\n${summarizePositions(positions)}`
      : ''
  const system = `${SYSTEM_PROMPT}\n\n--- Catalog ---\n${candidatesBlock}${positionsBlock}\n\n--- Criterion ---\n${criterion}`

  const client = new Anthropic({ apiKey })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

      emit(catalogEvent)

      const searchBlocks = new Map<number, { queryBuffer: string }>()
      const citationIndexByUrl = new Map<string, number>()

      try {
        const anthropicStream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [
            {
              role: 'user',
              content: `Recommend the best picks from the catalog for this criterion: ${criterion}`,
            },
          ],
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: MAX_WEB_SEARCHES,
            },
          ],
        })

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block
            if (block.type === 'server_tool_use' && block.name === 'web_search') {
              searchBlocks.set(event.index, { queryBuffer: '' })
              emit({ type: 'search_start' })
            }
            continue
          }

          if (event.type === 'content_block_delta') {
            const delta = event.delta
            if (delta.type === 'text_delta') {
              emit({ type: 'text', delta: delta.text })
            } else if (delta.type === 'input_json_delta') {
              const entry = searchBlocks.get(event.index)
              if (entry) entry.queryBuffer += delta.partial_json
            } else if (delta.type === 'citations_delta') {
              const citation = delta.citation
              if (citation.type === 'web_search_result_location') {
                let index = citationIndexByUrl.get(citation.url)
                if (index === undefined) {
                  index = citationIndexByUrl.size + 1
                  citationIndexByUrl.set(citation.url, index)
                  emit({
                    type: 'citation',
                    index,
                    url: citation.url,
                    title: citation.title ?? citation.url,
                  })
                }
              }
            }
            continue
          }

          if (event.type === 'content_block_stop') {
            const entry = searchBlocks.get(event.index)
            if (entry) {
              searchBlocks.delete(event.index)
              const queries: string[] = []
              try {
                const parsedQuery = JSON.parse(entry.queryBuffer) as { query?: unknown }
                if (typeof parsedQuery.query === 'string') queries.push(parsedQuery.query)
              } catch {
                // Best effort.
              }
              emit({ type: 'search_done', queries })
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        emit({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}
