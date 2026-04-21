import { createPredictionClient } from '@lifi/prediction-sdk'

export const predictionClient = createPredictionClient({
  integrator: 'lifi-prediction-demo',
  apiKey: process.env.NEXT_PUBLIC_LIFI_API_KEY,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
})
