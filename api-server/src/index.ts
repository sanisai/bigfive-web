import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { analyzeRouter } from './routes/analyze'
import { analyzeCombinedRouter } from './routes/analyze-combined'
import { resultsRouter } from './routes/results'
import { healthRouter } from './routes/health'
import { optionalApiKey, AuthRequest } from './middleware/auth'

dotenv.config()

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

// Security middleware
app.use(helmet())
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}))

// API Key authentication (optional - tracks authenticated vs public requests)
app.use(optionalApiKey)

// Rate limiting - different limits for authenticated vs public
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.PUBLIC_RATE_LIMIT ? parseInt(process.env.PUBLIC_RATE_LIMIT) : 20,
  skip: (req) => (req as AuthRequest).isAuthenticated, // Skip for authenticated requests
  message: 'Too many requests. Please provide an API key for higher limits.',
  standardHeaders: true,
  legacyHeaders: false,
})

const authenticatedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.AUTHENTICATED_RATE_LIMIT ? parseInt(process.env.AUTHENTICATED_RATE_LIMIT) : 200,
  skip: (req) => !(req as AuthRequest).isAuthenticated, // Skip for public requests
  message: 'Rate limit exceeded for authenticated requests.',
  standardHeaders: true,
  legacyHeaders: false,
})

app.use(publicLimiter)
app.use(authenticatedLimiter)
app.use(express.json({ limit: '10mb' }))

// Routes
app.use('/health', healthRouter)
app.use('/api/analyze', analyzeRouter)
app.use('/api/analyze-combined', analyzeCombinedRouter)
app.use('/api/results', resultsRouter)

// Root endpoint
app.get('/', (req, res) => {
  const authReq = req as AuthRequest
  const apiKeysConfigured = !!(process.env.API_KEYS && process.env.API_KEYS.length > 0)

  res.json({
    name: 'BigFive Interview Transcript Analysis API',
    version: '1.0.0',
    authenticated: authReq.isAuthenticated || false,
    authentication: {
      enabled: apiKeysConfigured,
      method: 'API Key (X-API-Key header or apiKey query param)',
      publicAccess: apiKeysConfigured ? 'Limited (20 req/15min)' : 'Enabled (100 req/15min)',
      authenticatedAccess: apiKeysConfigured ? 'Full (200 req/15min)' : 'N/A'
    },
    endpoints: {
      health: '/health',
      analyze: 'POST /api/analyze',
      analyzeCombined: 'POST /api/analyze-combined',
      results: 'GET /api/results/:id',
      docs: '/api/docs'
    },
    documentation: 'https://github.com/sailorsinc/bigfive-web#api-documentation'
  })
})

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      status: err.status || 500
    }
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BigFive API Server running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
  console.log(`🔬 Analyze endpoint: http://localhost:${PORT}/api/analyze`)
})

export default app
