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

const SYSTEM_PROMPT = `You are an expert analyst helping a trader understand a single prediction market. Use only the market context provided. Keep answers concise, factual, and grounded in the context.

Rules:
- Do NOT predict the outcome or tell the user how to bet.
- Do NOT invent facts that aren't in the context.
- If the user asks something outside the context, say so plainly and suggest what would be needed to answer.
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
      try {
        const anthropicStream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages,
        })
        for await (const event of anthropicStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`\n\n[error] ${message}`))
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
