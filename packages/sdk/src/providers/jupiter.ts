import type {
	ClaimParams,
	ClaimResult,
	CreateOrderParams,
	CreateOrderResult,
	CreateSellOrderParams,
	Event,
	EventsPagination,
	GetClaimableResult,
	GetEventsParams,
	GetEventsResult,
	GetHistoryResult,
	GetMarketResult,
	GetOrderbookResult,
	GetPositionsResult,
	Market,
	OrderStatus,
	TradingStatus,
} from '../types.js'

interface RawEventsResponse {
	data: Event[]
	pagination: EventsPagination
}

function mapEventsResponse(raw: RawEventsResponse): GetEventsResult {
	return { events: raw.data, pagination: raw.pagination }
}


export const DEFAULT_API_URL = 'https://develop.li.quest/v1/prediction'

export interface ResolvedConfig {
	apiUrl: string
	apiKey?: string
	integrator: string
}

export class PredictionApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
	) {
		super(`Prediction API error ${status}: ${body}`)
		this.name = 'PredictionApiError'
	}
}

async function request<T>(
	config: ResolvedConfig,
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const url = `${config.apiUrl}${path}`
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'x-integrator': config.integrator,
	}
	if (config.apiKey) {
		headers['x-api-key'] = config.apiKey
	}
	const response = await fetch(url, {
		...init,
		headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
	})
	if (!response.ok) {
		throw new PredictionApiError(response.status, await response.text())
	}
	return response.json() as Promise<T>
}

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined)
	if (entries.length === 0) return ''
	const qs = new URLSearchParams(
		entries.map(([k, v]) => [k, String(v)] as [string, string]),
	)
	return `?${qs.toString()}`
}

export async function getEvents(
	config: ResolvedConfig,
	params: GetEventsParams = {},
): Promise<GetEventsResult> {
	const qs = toQueryString(params as Record<string, string | number | boolean | undefined>)
	const raw = await request<RawEventsResponse>(config, `/events${qs}`)
	return mapEventsResponse(raw)
}

export async function searchEvents(
	config: ResolvedConfig,
	query: string,
	limit?: number,
): Promise<GetEventsResult> {
	const qs = toQueryString({ query, limit })
	const raw = await request<RawEventsResponse>(config, `/events/search${qs}`)
	return mapEventsResponse(raw)
}

export async function getEvent(config: ResolvedConfig, eventId: string): Promise<Event> {
	return request<Event>(config, `/events/${encodeURIComponent(eventId)}`)
}

export async function getSuggestedEvents(
	config: ResolvedConfig,
	ownerPubkey: string,
): Promise<GetEventsResult> {
	const raw = await request<RawEventsResponse>(
		config,
		`/events/suggested/${encodeURIComponent(ownerPubkey)}`,
	)
	return mapEventsResponse(raw)
}

export async function getMarket(
	config: ResolvedConfig,
	marketId: string,
): Promise<GetMarketResult> {
	const market = await request<Market>(config, `/markets/${encodeURIComponent(marketId)}`)
	console.log('[prediction-sdk] getMarket:', marketId, Object.keys(market))
	return { market }
}

export async function getOrderbook(
	config: ResolvedConfig,
	marketId: string,
): Promise<GetOrderbookResult> {
	return request<GetOrderbookResult>(config, `/orderbook/${encodeURIComponent(marketId)}`)
}

export async function getTradingStatus(config: ResolvedConfig): Promise<TradingStatus> {
	return request<TradingStatus>(config, '/trading-status')
}

export async function createOrder(
	config: ResolvedConfig,
	params: CreateOrderParams,
): Promise<CreateOrderResult> {
	return request<CreateOrderResult>(config, '/orders', {
		method: 'POST',
		body: JSON.stringify(params),
	})
}

export async function getOrderStatus(
	config: ResolvedConfig,
	orderPubkey: string,
): Promise<OrderStatus> {
	return request<OrderStatus>(config, `/orders/status/${encodeURIComponent(orderPubkey)}`)
}

export async function pollOrderStatus(
	config: ResolvedConfig,
	orderPubkey: string,
	options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<OrderStatus> {
	const { intervalMs = 2000, timeoutMs = 60000 } = options
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		const status = await getOrderStatus(config, orderPubkey)
		if (status.status !== 'pending') return status
		await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
	}

	throw new Error(`Order ${orderPubkey} did not fill within ${timeoutMs}ms`)
}

export async function createSellOrder(
	config: ResolvedConfig,
	params: CreateSellOrderParams,
): Promise<CreateOrderResult> {
	return request<CreateOrderResult>(config, '/orders/sell', {
		method: 'POST',
		body: JSON.stringify(params),
	})
}

export async function getPositions(
	config: ResolvedConfig,
	ownerPubkey: string,
): Promise<GetPositionsResult> {
	return request<GetPositionsResult>(
		config,
		`/positions/${encodeURIComponent(ownerPubkey)}`,
	)
}

export async function getHistory(
	config: ResolvedConfig,
	ownerPubkey: string,
): Promise<GetHistoryResult> {
	return request<GetHistoryResult>(config, `/history/${encodeURIComponent(ownerPubkey)}`)
}

export async function getClaimable(
	config: ResolvedConfig,
	ownerPubkey: string,
): Promise<GetClaimableResult> {
	return request<GetClaimableResult>(
		config,
		`/vault/claimable/${encodeURIComponent(ownerPubkey)}`,
	)
}

export async function claim(
	config: ResolvedConfig,
	params: ClaimParams,
): Promise<ClaimResult> {
	return request<ClaimResult>(config, '/vault/claim', {
		method: 'POST',
		body: JSON.stringify(params),
	})
}
