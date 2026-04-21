export { PredictionClient, createPredictionClient } from './client.js'
export { PredictionApiError } from './providers/jupiter.js'
export { formatPrice, formatProbability } from './utils.js'
export type {
	ClaimParams,
	ClaimResult,
	ClaimablePosition,
	CreateOrderParams,
	CreateOrderResult,
	CreateSellOrderParams,
	Event,
	EventCategory,
	EventMetadata,
	EventsPagination,
	GetClaimableResult,
	GetEventsParams,
	GetEventsResult,
	GetHistoryResult,
	GetMarketResult,
	GetOrderbookResult,
	GetPositionsResult,
	HistoryEvent,
	Market,
	MarketPricing,
	Order,
	OrderStatus,
	Orderbook,
	OrderbookLevel,
	PollOrderStatusOptions,
	Position,
	PredictionClientConfig,
	SearchEventsParams,
	TradingStatus,
	TxMeta,
} from './types.js'

// Functional API — preferred for tree-shaking
import type { PredictionClient } from './client.js'
import type {
	ClaimParams,
	ClaimResult,
	CreateOrderParams,
	CreateOrderResult,
	CreateSellOrderParams,
	Event,
	GetClaimableResult,
	GetEventsParams,
	GetEventsResult,
	GetHistoryResult,
	GetMarketResult,
	GetOrderbookResult,
	GetPositionsResult,
	OrderStatus,
	PollOrderStatusOptions,
	TradingStatus,
} from './types.js'

export const getEvents = (
	client: PredictionClient,
	params?: GetEventsParams,
): Promise<GetEventsResult> => client.getEvents(params)

export const searchEvents = (
	client: PredictionClient,
	query: string,
	limit?: number,
): Promise<GetEventsResult> => client.searchEvents(query, limit)

export const getEvent = (client: PredictionClient, eventId: string): Promise<Event> =>
	client.getEvent(eventId)

export const getSuggestedEvents = (
	client: PredictionClient,
	ownerPubkey: string,
): Promise<GetEventsResult> => client.getSuggestedEvents(ownerPubkey)

export const getMarket = (
	client: PredictionClient,
	marketId: string,
): Promise<GetMarketResult> => client.getMarket(marketId)

export const getOrderbook = (
	client: PredictionClient,
	marketId: string,
): Promise<GetOrderbookResult> => client.getOrderbook(marketId)

export const getTradingStatus = (client: PredictionClient): Promise<TradingStatus> =>
	client.getTradingStatus()

export const createOrder = (
	client: PredictionClient,
	params: CreateOrderParams,
): Promise<CreateOrderResult> => client.createOrder(params)

export const getOrderStatus = (
	client: PredictionClient,
	orderPubkey: string,
): Promise<OrderStatus> => client.getOrderStatus(orderPubkey)

export const pollOrderStatus = (
	client: PredictionClient,
	orderPubkey: string,
	options?: PollOrderStatusOptions,
): Promise<OrderStatus> => client.pollOrderStatus(orderPubkey, options)

export const createSellOrder = (
	client: PredictionClient,
	params: CreateSellOrderParams,
): Promise<CreateOrderResult> => client.createSellOrder(params)

export const getPositions = (
	client: PredictionClient,
	ownerPubkey: string,
): Promise<GetPositionsResult> => client.getPositions(ownerPubkey)

export const getHistory = (
	client: PredictionClient,
	ownerPubkey: string,
): Promise<GetHistoryResult> => client.getHistory(ownerPubkey)

export const getClaimable = (
	client: PredictionClient,
	ownerPubkey: string,
): Promise<GetClaimableResult> => client.getClaimable(ownerPubkey)

export const claimPayout = (
	client: PredictionClient,
	params: ClaimParams,
): Promise<ClaimResult> => client.claim(params)
