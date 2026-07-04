// Self-contained route test for POST /api/analyze-combined.
// Run: npm test (= npx tsx test/combined-route.test.ts) from api-server/.
// No network, no Mongo, no OpenAI key needed:
//   - OpenAI is a local canned stub served on 127.0.0.1 (via OPENAI_BASE_URL)
//   - the db module is stubbed through require.cache before the route loads
// Exits non-zero on the first failed assertion.

import http from 'http'
import assert from 'assert'
import express from 'express'

// --- Stub OpenAI (canned chat.completions) --------------------------------

let cannedPayload: any = null
let openaiCalls = 0

const openaiStub = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    openaiCalls++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(cannedPayload) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 32, total_tokens: 42 },
      system_fingerprint: 'fp_stub'
    }))
  })
})

// --- Stub the db module BEFORE the route is loaded -------------------------

let savedDocs: any[] = []
const dbPath = require.resolve('../src/db')
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    saveCombinedAnalysis: async (input: any) => {
      savedDocs.push(input)
      return 'a1b2c3d4e5f6a7b8c9d0e1f2'
    },
    saveAnalysis: async () => { throw new Error('saveAnalysis must not be called by the combined route') },
    getAnalysisById: async () => null,
    connectToDatabase: async () => { throw new Error('no db in tests') }
  }
} as any

// --- Fixtures ---------------------------------------------------------------

const TRANSCRIPT = `Interviewer: Tell me about a challenging project you worked on recently.

Candidate: I led a team of five developers to migrate our legacy system to microservices. The biggest challenge was managing stakeholder expectations while maintaining quality. I organized weekly sync meetings and created detailed documentation to keep everyone aligned. When conflicts arose, I brought everyone together to discuss concerns openly.

Interviewer: How do you handle pressure and tight deadlines?

Candidate: I stay calm under pressure by breaking the work into small, clear steps. I genuinely enjoy learning new technologies and I am always curious about better ways to solve problems. Repetitive tasks drain me, but collaborative problem solving gives me a lot of energy. I ask for feedback early and often because it helps me improve quickly.`

const FACETS = { '1': 4, '2': 3, '3': 4, '4': 3, '5': 5, '6': 3 }
const domain = (evidence: string[]) => ({ facets: { ...FACETS }, reasoning: 'Consistent pattern across answers.', evidence })

function validPayload() {
  return {
    ocean: {
      domains: {
        O: domain(['I genuinely enjoy learning new technologies']),
        C: domain(['I organized weekly sync meetings and created detailed documentation']),
        E: domain(['I brought everyone together to discuss concerns openly']),
        A: domain(['collaborative problem solving gives me a lot of energy']),
        N: domain(['I stay calm under pressure'])
      },
      employer_view: ['Organized and detail-oriented', 'Curious and eager to learn', 'Calm under pressure']
    },
    sdt: {
      autonomy: { score: 70 }, competence: { score: 82 }, relatedness: { score: 55 },
      dominant_drivers: ['competence', 'autonomy'],
      employer_view: ['Motivated by mastery and growth', 'Works well independently', 'Values regular feedback']
    },
    jdr: {
      demands: { score: 68 }, resources: { score: 74 },
      sustainability: 'Sustainable in collaborative environments with variety.',
      employer_view: ['Energized by collaborative problem solving', 'Repetitive tasks drain energy', 'Handles deadline pressure well']
    },
    spiral: {
      profile: {
        structure_oriented: 45, achievement_oriented: 72, people_oriented: 60, systems_oriented: 50,
        dominant_orientation: 'achievement_oriented', secondary_orientation: 'people_oriented',
        communication_style: 'Data-driven and collaborative',
        culture_fit_indicators: ['thrives in meritocratic environments'],
        internal_tags: ['orange_primary', 'green_secondary'],
        summary: 'Results-driven with a collaborative streak.'
      },
      employer_view: ['Driven by results and efficiency', 'Prioritizes team collaboration', 'Adapts approach to the situation']
    },
    confidence: 0.78
  }
}

// --- Runner -----------------------------------------------------------------

async function main() {
  const openaiPort = await new Promise<number>(resolve => {
    openaiStub.listen(0, '127.0.0.1', () => resolve((openaiStub.address() as any).port))
  })
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${openaiPort}/v1`

  // Load the route AFTER env + db stub are in place
  const { analyzeCombinedRouter } = require('../src/routes/analyze-combined')
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/analyze-combined', analyzeCombinedRouter)

  const server = http.createServer(app)
  const port = await new Promise<number>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port))
  })
  const url = `http://127.0.0.1:${port}/api/analyze-combined`
  const post = (body: any) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

  // 1. 400 — transcript under 100 chars (zod validation)
  {
    const res = await post({ transcript: 'too short' })
    assert.equal(res.status, 400)
    const body: any = await res.json()
    assert.equal(body.error, 'Validation error')
    assert.equal(openaiCalls, 0)
    console.log('PASS 400 on short transcript (zod)')
  }

  // 2. 400 — >=100 chars but fails the content-quality gate (<100 words)
  {
    const res = await post({ transcript: 'word '.repeat(30).trim() + ' end of this very short transcript text.' })
    assert.equal(res.status, 400)
    const body: any = await res.json()
    assert.equal(body.error, 'Validation error')
    assert.equal(openaiCalls, 0)
    console.log('PASS 400 on quality-gate failure')
  }

  // 3. 200 — clean canned payload: contract shape + result-only persistence
  {
    cannedPayload = validPayload()
    openaiCalls = 0
    savedDocs = []
    const res = await post({ transcript: TRANSCRIPT, candidateName: 'Jane Doe', jobRole: 'Software Engineer', metadata: { referralId: 'r-1' } })
    assert.equal(res.status, 200)
    const body: any = await res.json()

    assert.equal(body.id, 'a1b2c3d4e5f6a7b8c9d0e1f2')
    assert.ok(body.confidence > 0 && body.confidence <= 1)
    assert.equal(typeof body.contentQuality, 'string')
    assert.deepEqual(Object.keys(body.frameworks).sort(), ['jdr', 'ocean', 'sdt', 'spiral'])

    for (const d of ['O', 'C', 'E', 'A', 'N']) {
      const p = body.frameworks.ocean.profile[d]
      assert.ok(p.score >= 6 && p.score <= 30)
      assert.ok(p.average >= 1 && p.average <= 5)
      assert.ok(['low', 'neutral', 'high'].includes(p.level))
      assert.equal(typeof p.reasoning, 'string')
      for (const q of p.evidence) assert.ok(TRANSCRIPT.includes(q), `evidence verbatim: ${q}`)
    }
    assert.ok(Array.isArray(body.frameworks.ocean.employer_view))
    assert.deepEqual(body.frameworks.sdt.profile.autonomy, { score: 70, level: 'high' })
    assert.deepEqual(body.frameworks.sdt.profile.dominant_drivers, ['competence', 'autonomy'])
    assert.deepEqual(body.frameworks.jdr.profile.demands, { score: 68, level: 'high' })
    assert.equal(typeof body.frameworks.jdr.profile.sustainability, 'string')
    assert.equal(body.frameworks.spiral.profile.dominant_orientation, 'achievement_orientated'.replace('orientated', 'oriented'))
    assert.equal(openaiCalls, 1)

    // Persistence: ONE result doc, and the transcript text is NOT in it
    assert.equal(savedDocs.length, 1)
    const savedStr = JSON.stringify(savedDocs[0])
    assert.ok(!savedStr.includes('migrate our legacy system'), 'transcript text must not be persisted')
    assert.equal(savedDocs[0].transcriptLength, TRANSCRIPT.length)
    assert.equal(savedDocs[0].candidateName, 'Jane Doe')
    assert.ok(savedDocs[0].frameworks?.ocean?.profile?.O)
    console.log('PASS 200 contract shape + result-only persistence')
  }

  // 4. 200 — persistent Spiral color label: one retry, then stripped at the response layer
  {
    cannedPayload = validPayload()
    cannedPayload.spiral.employer_view = ['Strongly Orange in outlook', 'Prioritizes team collaboration']
    openaiCalls = 0
    savedDocs = []
    const res = await post({ transcript: TRANSCRIPT })
    assert.equal(res.status, 200)
    const body: any = await res.json()
    assert.equal(openaiCalls, 2, 'one retry expected on Spiral violation')
    assert.deepEqual(body.frameworks.spiral.employer_view, ['Prioritizes team collaboration'])
    // Internal profile keeps its vMEME data (allowed — profile is internal-only)
    assert.deepEqual(body.frameworks.spiral.profile.internal_tags, ['orange_primary', 'green_secondary'])
    // The persisted employer_view is scrubbed too
    assert.deepEqual(savedDocs[0].frameworks.spiral.employer_view, ['Prioritizes team collaboration'])
    console.log('PASS Spiral color label retried then stripped (response + store)')
  }

  server.close()
  openaiStub.close()
  console.log('ALL ROUTE TESTS PASSED')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
