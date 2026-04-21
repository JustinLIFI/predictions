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
	PredictionClientConfig,
	TradingStatus,
} from './types.js'
import {
	DEFAULT_API_URL,
	type ResolvedConfig,
	claim,
	createOrder,
	createSellOrder,
	getClaimable,
	getEvent,
	getEvents,
	getHistory,
	getMarket,
	getOrderbook,
	getOrderStatus,
	getPositions,
	getSuggestedEvents,
	getTradingStatus,
	pollOrderStatus,
	searchEvents,
} from './providers/jupiter.js'

export class PredictionClient {
	readonly config: ResolvedConfig

	constructor(config: PredictionClientConfig) {
		this.config = {
			apiUrl: config.apiUrl ?? DEFAULT_API_URL,
			apiKey: config.apiKey,
			integrator: config.integrator,
		}
	}

	getEvents(params?: GetEventsParams): Promise<GetEventsResult> {
		return getEvents(this.config, params)
	}

	searchEvents(query: string, limit?: number): Promise<GetEventsResult> {
		return searchEvents(this.config, query, limit)
	}

	getEvent(eventId: string): Promise<Event> {
		return getEvent(this.config, eventId)
	}

	getSuggestedEvents(ownerPubkey: string): Promise<GetEventsResult> {
		return getSuggestedEvents(this.config, ownerPubkey)
	}

	getMarket(marketId: string): Promise<GetMarketResult> {
		return getMarket(this.config, marketId)
	}

	getOrderbook(marketId: string): Promise<GetOrderbookResult> {
		return getOrderbook(this.config, marketId)
	}

	getTradingStatus(): Promise<TradingStatus> {
		return getTradingStatus(this.config)
	}

	createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
		return createOrder(this.config, params)
	}

	getOrderStatus(orderPubkey: string): Promise<OrderStatus> {
		return getOrderStatus(this.config, orderPubkey)
	}

	pollOrderStatus(orderPubkey: string, options?: PollOrderStatusOptions): Promise<OrderStatus> {
		return pollOrderStatus(this.config, orderPubkey, options)
	}

	createSellOrder(params: CreateSellOrderParams): Promise<CreateOrderResult> {
		return createSellOrder(this.config, params)
	}

	getPositions(ownerPubkey: string): Promise<GetPositionsResult> {
		return getPositions(this.config, ownerPubkey)
	}

	getHistory(ownerPubkey: string): Promise<GetHistoryResult> {
		return getHistory(this.config, ownerPubkey)
	}

	getClaimable(ownerPubkey: string): Promise<GetClaimableResult> {
		return getClaimable(this.config, ownerPubkey)
	}

	claim(params: ClaimParams): Promise<ClaimResult> {
		return claim(this.config, params)
	}
}

export function createPredictionClient(config: PredictionClientConfig): PredictionClient {
	return new PredictionClient(config)
}
