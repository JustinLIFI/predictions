import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const UPSTREAM = 'https://api.jup.ag/prediction/v1'

const FORWARD_REQUEST_HEADERS = new Set([
  'content-type',
  'accept',
  'x-integrator',
])

const FORWARD_RESPONSE_HEADERS = new Set([
  'content-type',
  'cache-control',
  'content-language',
])

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const url = new URL(req.url)
  const target = `${UPSTREAM}/${path.join('/')}${url.search}`

  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    if (FORWARD_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = value
  })
  const apiKey = process.env.JUPITER_API_KEY
  if (apiKey) headers['x-api-key'] = apiKey

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const init: RequestInit = {
    method: req.method,
    headers,
    ...(hasBody ? { body: await req.arrayBuffer() } : {}),
  }

  const upstream = await fetch(target, init)

  if (!upstream.ok) {
    console.warn(
      `[prediction-proxy] ${req.method} ${target} → ${upstream.status}` +
        ` (apiKey: ${apiKey ? 'yes' : 'no'})`,
    )
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (FORWARD_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value)
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
