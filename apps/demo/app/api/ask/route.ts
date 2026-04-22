import Anthropic from '@anthropic-ai/sdk'
import type { Market } from '@lifi/prediction-sdk'
import type { NextRequest } from 'next/server'
import { marketToContext } from '@/lib/ai-context'

export const runtime = 'nodejs'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AskRequestBody {
  market: Market
  messages: ChatMessage[]
}

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 1024
const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 4000
const MAX_WEB_SEARCHES = 3

const SYSTEM_PROMPT = `You are an expert analyst helping a trader understand a single prediction market. Ground every answer in the market context provided.

You have a web_search tool. Use it when the user asks about current facts, recent news, prices, scores, or anything that may have changed since the market was created — anything not already in the context. Do not search for things already in the context. Always cite sources for claims that come from search results.

Rules:
- Do NOT predict the outcome or tell the user how to bet.
- Do NOT invent facts. If search returns nothing relevant, say so.
- If the user asks something outside the context and not answerable by search, say so plainly.
- Prefer short paragraphs and bullet points.`

function validateBody(body: unknown): AskRequestBody | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const market = b.market as Market | undefined
  const messages = b.messages as ChatMessage[] | undefined
  if (!market || typeof market !== 'object' || typeof market.marketId !== 'string') {
    return null
  }
  if (!Array.isArray(messages) || messages.length === 0) return null
  if (messages.length > MAX_MESSAGES) return null
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null
    if (m.role !== 'user' && m.role !== 'assistant') return null
    if (typeof m.content !== 'string' || m.content.length === 0) return null
    if (m.content.length > MAX_CONTENT_LENGTH) return null
  }
  if (messages[messages.length - 1].role !== 'user') return null
  return { market, messages }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }

  let parsed: AskRequestBody | null
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

  const { market, messages } = parsed
  const system = `${SYSTEM_PROMPT}\n\n--- Market context ---\n${marketToContext(market)}`

  const client = new Anthropic({ apiKey })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

      // Track web_search server_tool_use blocks by index so we can emit
      // search_start / search_done around them and accumulate the query JSON.
      const searchBlocks = new Map<number, { queryBuffer: string }>()
      // Citation dedupe: url -> stable index across the turn.
      const citationIndexByUrl = new Map<string, number>()

      try {
        const anthropicStream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages,
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
                // Best effort — if the partial JSON never parses, just omit queries.
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
