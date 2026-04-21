export const formatPrice = (microUsdc: number): number => microUsdc / 1_000_000

export const formatProbability = (microUsdc: number): string =>
	`${(microUsdc / 10_000).toFixed(1)}%`
