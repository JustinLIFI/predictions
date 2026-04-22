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
	HistoryEvent,
	GetMarketResult,
	GetOrderbookResult,
	GetPositionsResult,
	Market,
	OrderStatus,
	Position,
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

interface RawOrder {
	pubkey: string
	status: 'pending' | 'filled' | 'failed'
	filledContracts?: string
	avgFillPriceUsd?: string
	filledAt?: number
}

function mapOrderToStatus(raw: RawOrder): OrderStatus {
	const filled =
		raw.filledContracts !== undefined ? Number(raw.filledContracts) : undefined
	const avg =
		raw.avgFillPriceUsd !== undefined ? Number(raw.avgFillPriceUsd) : undefined
	return {
		status: raw.status,
		filledContracts: filled,
		avgFillPrice: avg,
	}
}

export async function getOrderStatus(
	config: ResolvedConfig,
	orderPubkey: string,
): Promise<OrderStatus> {
	const raw = await request<RawOrder>(
		config,
		`/orders/${encodeURIComponent(orderPubkey)}`,
	)
	return mapOrderToStatus(raw)
}

function isOrderGoneError(err: PredictionApiError): boolean {
	if (err.status === 404) return true
	if (err.status !== 400) return false
	try {
		const parsed = JSON.parse(err.body) as { code?: unknown }
		return parsed.code === 'get_order_failed'
	} catch {
		return false
	}
}

export async function pollOrderStatus(
	config: ResolvedConfig,
	orderPubkey: string,
	options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<OrderStatus> {
	const { intervalMs = 2000, timeoutMs = 60000 } = options
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		try {
			const status = await getOrderStatus(config, orderPubkey)
			if (status.status !== 'pending') return status
		} catch (err) {
			// Jupiter closes the order account on-chain after a successful fill,
			// at which point GET /orders/{pubkey} stops finding it. Older versions
			// returned 404; the current API returns 400 with code "get_order_failed".
			// Both mean the same thing: the order is gone because it was filled —
			// a failed order would still be queryable.
			if (err instanceof PredictionApiError && isOrderGoneError(err)) {
				return { status: 'filled' }
			}
			throw err
		}
		await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
	}

	throw new Error(`Order ${orderPubkey} did not fill within ${timeoutMs}ms`)
}

export async function createSellOrder(
	config: ResolvedConfig,
	params: CreateSellOrderParams,
): Promise<CreateOrderResult> {
	// Jupiter exposes sells via the same POST /orders endpoint with isBuy=false
	// and a positionPubkey instead of a marketId.
	return request<CreateOrderResult>(config, '/orders', {
		method: 'POST',
		body: JSON.stringify({ ...params, isBuy: false }),
	})
}

interface RawPosition {
	pubkey: string
	owner: string
	marketId: string
	isYes: boolean
	contracts: string
	totalCostUsd: string
	avgPriceUsd: string
	valueUsd: string
	markPriceUsd: string
	pnlUsd: string
	claimable: boolean
	claimed: boolean
	payoutUsd?: string
}

function mapPosition(raw: RawPosition): Position {
	return {
		positionPubkey: raw.pubkey,
		owner: raw.owner,
		marketId: raw.marketId,
		side: raw.isYes ? 'yes' : 'no',
		contracts: Number(raw.contracts),
		totalCostUsd: Number(raw.totalCostUsd),
		avgPriceUsd: Number(raw.avgPriceUsd),
		valueUsd: Number(raw.valueUsd),
		markPriceUsd: Number(raw.markPriceUsd),
		unrealizedPnl: Number(raw.pnlUsd),
		claimable: raw.claimable,
		claimed: raw.claimed,
		payoutUsd: raw.payoutUsd !== undefined ? Number(raw.payoutUsd) : undefined,
	}
}

export async function getPositions(
	config: ResolvedConfig,
	ownerPubkey: string,
): Promise<GetPositionsResult> {
	const raw = await request<{ data: RawPosition[] }>(
		config,
		`/positions?ownerPubkey=${encodeURIComponent(ownerPubkey)}`,
	)
	return { positions: raw.data.map(mapPosition) }
}

export async function getHistory(
	config: ResolvedConfig,
	ownerPubkey: string,
): Promise<GetHistoryResult> {
	const raw = await request<{ data: HistoryEvent[] }>(
		config,
		`/history?ownerPubkey=${encodeURIComponent(ownerPubkey)}`,
	)
	return { events: raw.data }
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
