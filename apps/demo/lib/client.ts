import { createPredictionClient } from '@lifi/prediction-sdk'

export const predictionClient = createPredictionClient({
  integrator: 'lifi-prediction-demo',
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
})
