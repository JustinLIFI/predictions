export interface PredictionClientConfig {
	integrator: string
	apiKey?: string
	apiUrl?: string
}

export type EventCategory =
	| 'crypto'
	| 'sports'
	| 'politics'
	| 'esports'
	| 'culture'
	| 'economics'
	| 'tech'

export interface MarketPricing {
	buyYesPriceUsd: number
	sellYesPriceUsd: number
	buyNoPriceUsd: number
	sellNoPriceUsd: number
	volume: number
}

export interface Market {
	marketId: string
	eventId: string
	title: string
	description?: string
	status: 'open' | 'closed' | 'cancelled'
	result: '' | 'pending' | 'yes' | 'no'
	openTime: number
	closeTime: number
	resolveAt?: number
	pricing: MarketPricing
	rulesPrimary?: string
}

export interface EventMetadata {
	title: string
}

export interface Event {
	eventId: string
	title?: string
	metadata?: EventMetadata
	subtitle?: string
	category: EventCategory
	subcategory?: string
	series?: string
	markets: Market[]
	totalTvl: number
	totalVolume: number
	closeConditions?: string
}

export interface Position {
	positionPubkey: string
	owner: string
	marketId: string
	side: 'yes' | 'no'
	contracts: number
	totalCostUsd: number
	avgPriceUsd: number
	valueUsd: number
	markPriceUsd: number
	unrealizedPnl: number
	claimable: boolean
	claimed: boolean
	payoutUsd?: number
}

export interface Order {
	orderPubkey: string
	positionPubkey: string
	contracts: number
}

export interface TxMeta {
	blockhash: string
	lastValidBlockHeight: number
}

export interface OrderStatus {
	status: 'pending' | 'filled' | 'failed'
	filledContracts?: number
	avgFillPrice?: number
	fees?: number
}

export interface OrderbookLevel {
	price: number
	size: number
}

export interface Orderbook {
	marketId: string
	bids: OrderbookLevel[]
	asks: OrderbookLevel[]
}

export interface TradingStatus {
	active: boolean
}

export interface ClaimablePosition {
	positionPubkey: string
	marketId: string
	contracts: number
	payoutUsd: number
}

// Request param types

export interface GetEventsParams {
	category?: EventCategory
	subcategory?: string
	filter?: 'new' | 'live' | 'trending'
	includeMarkets?: boolean
	sortBy?: string
	sortDirection?: 'asc' | 'desc'
	start?: number
	end?: number
}

export interface SearchEventsParams {
	query: string
	limit?: number
}

export interface GetMarketParams {
	marketId: string
}

export interface GetOrderbookParams {
	marketId: string
}

export interface CreateOrderParams {
	ownerPubkey: string
	marketId: string
	isYes: boolean
	isBuy: boolean
	depositAmount: string
	depositMint: string
}

export interface CreateSellOrderParams {
	ownerPubkey: string
	positionPubkey: string
	isYes: boolean
	contracts: number
	depositMint: string
}

export interface PollOrderStatusOptions {
	intervalMs?: number
	timeoutMs?: number
}

export interface ClaimParams {
	ownerPubkey: string
	positionPubkeys: string[]
}

// Result types

export interface EventsPagination {
	start: number
	end: number
	total: number
	hasNext: boolean
}

export interface GetEventsResult {
	events: Event[]
	pagination: EventsPagination
}

export interface GetMarketResult {
	market: Market
}

export interface GetOrderbookResult {
	orderbook: Orderbook
}

export interface CreateOrderResult {
	transaction: string
	txMeta: TxMeta
	order: Order
}

export interface GetPositionsResult {
	positions: Position[]
}

export interface HistoryEvent {
	id: number
	eventType: string
	signature: string
	slot: string
	timestamp: number
	orderPubkey: string
	positionPubkey: string
	marketId: string
	ownerPubkey: string
	isBuy: boolean
	isYes: boolean
	contracts: string
	filledContracts: string
	avgFillPriceUsd: string
	totalCostUsd: string
	feeUsd: string
	realizedPnl: string | null
	payoutAmountUsd: string
	eventId: string
}

export interface GetHistoryResult {
	events: HistoryEvent[]
}

export interface GetClaimableResult {
	claimable: ClaimablePosition[]
}

export interface ClaimResult {
	transaction: string
	txMeta: TxMeta
}
