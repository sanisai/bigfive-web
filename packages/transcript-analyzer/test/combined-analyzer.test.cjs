// Unit tests for the combined four-framework analyzer.
// Run: node --test test/  (from packages/transcript-analyzer, after `npm run build`)
// The OpenAI call is mocked via the CombinedAnalyzer's injectable client — no network.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const {
  CombinedAnalyzer,
  TranscriptQualityError,
  SPIRAL_COLOR_PATTERN,
  scrubSpiralEmployerView,
  findVerbatimEvidence
} = require('../dist/combined-analyzer')

// ---------------------------------------------------------------------------
// Fixtures

// >100 words so the content-quality gate passes; contains quotable sentences.
const TRANSCRIPT = `Interviewer: Tell me about a challenging project you worked on recently.

Candidate: I led a team of five developers to migrate our legacy system to microservices. The biggest challenge was managing stakeholder expectations while maintaining quality. I organized weekly sync meetings and created detailed documentation to keep everyone aligned. When conflicts arose, I brought everyone together to discuss concerns openly.

Interviewer: How do you handle pressure and tight deadlines?

Candidate: I stay calm under pressure by breaking the work into small, clear steps. I genuinely enjoy learning new technologies and I am always curious about better ways to solve problems. Repetitive tasks drain me, but collaborative problem solving gives me a lot of energy. I ask for feedback early and often because it helps me improve quickly.`

const FACETS = { '1': 4, '2': 3, '3': 4, '4': 3, '5': 5, '6': 3 }

function makeDomain(evidence) {
  return {
    facets: { ...FACETS },
    reasoning: 'Pattern of curiosity and structured delivery across answers.',
    evidence
  }
}

function makeValidOutput(overrides = {}) {
  const base = {
    ocean: {
      domains: {
        O: makeDomain(['I genuinely enjoy learning new technologies']),
        C: makeDomain(['I organized weekly sync meetings and created detailed documentation']),
        E: makeDomain(['I brought everyone together to discuss concerns openly']),
        A: makeDomain(['collaborative problem solving gives me a lot of energy']),
        N: makeDomain(['I stay calm under pressure'])
      },
      employer_view: ['Organized and detail-oriented', 'Curious and eager to learn', 'Calm under pressure']
    },
    sdt: {
      autonomy: { score: 70 },
      competence: { score: 82 },
      relatedness: { score: 55 },
      dominant_drivers: ['competence', 'autonomy'],
      employer_view: ['Motivated by mastery and growth', 'Works well with independence', 'Values regular feedback']
    },
    jdr: {
      demands: { score: 68 },
      resources: { score: 74 },
      sustainability: 'Sustainable in collaborative environments with variety; repetitive work depletes energy.',
      employer_view: ['Energized by collaborative problem solving', 'Repetitive tasks drain energy', 'Handles deadline pressure well']
    },
    spiral: {
      profile: {
        structure_oriented: 45,
        achievement_oriented: 72,
        people_oriented: 60,
        systems_oriented: 50,
        dominant_orientation: 'achievement_oriented',
        secondary_orientation: 'people_oriented',
        communication_style: 'Data-driven discussions with collaborative decisions',
        culture_fit_indicators: ['thrives in meritocratic environments'],
        internal_tags: ['orange_primary', 'green_secondary'],
        summary: 'Results-driven with a strong collaborative streak.'
      },
      employer_view: ['Driven by results and efficiency', 'Prioritizes team collaboration', 'Adapts approach to the situation']
    },
    confidence: 0.78
  }
  return JSON.parse(JSON.stringify({ ...base, ...overrides }))
}

class FakeClient {
  constructor(responses) {
    // Each entry: an object to be JSON.stringified as the completion content
    this.responses = responses
    this.calls = []
  }
  get chat() {
    const self = this
    return {
      completions: {
        async create(params) {
          self.calls.push(params)
          const payload = self.responses[Math.min(self.calls.length - 1, self.responses.length - 1)]
          return {
            choices: [{ message: { content: JSON.stringify(payload) } }],
            usage: { total_tokens: 42 },
            system_fingerprint: 'fp_test'
          }
        }
      }
    }
  }
}

function analyzerWith(responses) {
  const client = new FakeClient(responses)
  const analyzer = new CombinedAnalyzer('test-key', { client, model: 'gpt-4o' })
  return { client, analyzer }
}

// ---------------------------------------------------------------------------
// Happy path

test('happy path: contract shape, one call, deterministic seed', async () => {
  const { client, analyzer } = analyzerWith([makeValidOutput()])
  const result = await analyzer.analyze({ text: TRANSCRIPT, candidateName: 'Jane', jobRole: 'Engineer' })

  assert.equal(client.calls.length, 1)
  const params = client.calls[0]
  assert.equal(params.model, 'gpt-4o')
  assert.equal(params.temperature, 0.1)
  assert.deepEqual(params.response_format, { type: 'json_object' })

  // Deterministic content-hash seed (same recipe as the OCEAN analyzer)
  const hash = crypto.createHash('md5').update(TRANSCRIPT).digest('hex')
  assert.equal(params.seed, parseInt(hash.substring(0, 8), 16) % 1000000)

  // OCEAN per-domain: score 6-30, average 1-5, level, reasoning, evidence[]
  for (const d of ['O', 'C', 'E', 'A', 'N']) {
    const p = result.frameworks.ocean.profile[d]
    assert.equal(p.score, 22) // 4+3+4+3+5+3
    assert.equal(p.average, 3.67)
    assert.equal(p.level, 'high') // 22/6 = 3.67 > 3.5
    assert.ok(p.reasoning.length > 0)
    assert.equal(p.evidence.length, 1)
    assert.ok(TRANSCRIPT.includes(p.evidence[0]), `evidence must be verbatim: ${p.evidence[0]}`)
  }
  assert.equal(result.frameworks.ocean.employer_view.length, 3)

  // SDT: 0-100 scores with derived levels + dominant drivers
  assert.deepEqual(result.frameworks.sdt.profile.autonomy, { score: 70, level: 'high' })
  assert.deepEqual(result.frameworks.sdt.profile.relatedness, { score: 55, level: 'moderate' })
  assert.deepEqual(result.frameworks.sdt.profile.dominant_drivers, ['competence', 'autonomy'])

  // JD-R: demands/resources + sustainability
  assert.deepEqual(result.frameworks.jdr.profile.demands, { score: 68, level: 'high' })
  assert.deepEqual(result.frameworks.jdr.profile.resources, { score: 74, level: 'high' })
  assert.ok(result.frameworks.jdr.profile.sustainability.length > 0)

  // Spiral: internal profile passthrough; employer view clean
  assert.equal(result.frameworks.spiral.profile.dominant_orientation, 'achievement_oriented')
  for (const s of result.frameworks.spiral.employer_view) {
    assert.ok(!SPIRAL_COLOR_PATTERN.test(s), `no color labels allowed: ${s}`)
  }

  assert.equal(result.confidence, 0.78)
  assert.equal(result.metadata.attempts, 1)
  assert.equal(result.metadata.evidenceDropped, 0)
  assert.equal(result.metadata.spiralViewScrubbed, 0)
})

// ---------------------------------------------------------------------------
// Evidence verbatim enforcement

test('non-verbatim evidence triggers exactly one retry, second response used', async () => {
  const bad = makeValidOutput()
  bad.ocean.domains.O.evidence = ['This sentence is definitely not in the transcript at all']
  const { client, analyzer } = analyzerWith([bad, makeValidOutput()])

  const result = await analyzer.analyze({ text: TRANSCRIPT })
  assert.equal(client.calls.length, 2)
  // The retry carries a corrective message naming the violation
  const retryMessages = client.calls[1].messages
  const correction = retryMessages[retryMessages.length - 1].content
  assert.match(correction, /not a verbatim transcript substring/)
  assert.equal(result.metadata.attempts, 2)
  assert.equal(result.metadata.evidenceDropped, 0)
  assert.ok(TRANSCRIPT.includes(result.frameworks.ocean.profile.O.evidence[0]))
})

test('evidence violation persisting after retry is dropped from the response', async () => {
  const bad = makeValidOutput()
  bad.ocean.domains.O.evidence = [
    'This sentence is definitely not in the transcript at all',
    'I genuinely enjoy learning new technologies' // this one IS verbatim, must survive
  ]
  const { client, analyzer } = analyzerWith([bad, bad])

  const result = await analyzer.analyze({ text: TRANSCRIPT })
  assert.equal(client.calls.length, 2)
  assert.deepEqual(result.frameworks.ocean.profile.O.evidence, ['I genuinely enjoy learning new technologies'])
  assert.equal(result.metadata.evidenceDropped, 1)
})

test('whitespace-mangled evidence is normalized to the exact transcript substring (no retry)', async () => {
  const out = makeValidOutput()
  out.ocean.domains.C.evidence = ['I organized   weekly\nsync meetings'] // whitespace differs
  const { client, analyzer } = analyzerWith([out])

  const result = await analyzer.analyze({ text: TRANSCRIPT })
  assert.equal(client.calls.length, 1)
  const ev = result.frameworks.ocean.profile.C.evidence[0]
  assert.ok(TRANSCRIPT.includes(ev), 'normalized evidence must be an exact transcript substring')
  assert.match(ev, /^I organized weekly sync meetings/)
})

// ---------------------------------------------------------------------------
// Spiral employer_view scrub

test('spiral color label triggers a retry; persistent violation is stripped', async () => {
  const bad = makeValidOutput()
  bad.spiral.employer_view = [
    'Strongly Orange in outlook', // violation
    'Prioritizes team collaboration' // clean
  ]
  const { client, analyzer } = analyzerWith([bad, bad])

  const result = await analyzer.analyze({ text: TRANSCRIPT })
  assert.equal(client.calls.length, 2)
  assert.deepEqual(result.frameworks.spiral.employer_view, ['Prioritizes team collaboration'])
  assert.equal(result.metadata.spiralViewScrubbed, 1)
  // Internal profile keeps its vMEME data
  assert.deepEqual(result.frameworks.spiral.profile.internal_tags, ['orange_primary', 'green_secondary'])
})

test('scrubSpiralEmployerView catches all eight vMEME color words, case-insensitive', () => {
  const colors = ['Blue', 'orange', 'GREEN', 'Yellow', 'turquoise', 'Red', 'Purple', 'beige']
  const view = colors.map(c => `Shows a ${c} tendency`)
  view.push('Values clear processes and procedures')
  const { clean, violations } = scrubSpiralEmployerView(view)
  assert.equal(violations.length, 8)
  assert.deepEqual(clean, ['Values clear processes and procedures'])
})

// ---------------------------------------------------------------------------
// Hard validation + quality gate

test('structurally invalid output on both attempts throws', async () => {
  const bad = makeValidOutput()
  bad.ocean.domains.O.facets['3'] = 9 // out of 1-5 range
  const { client, analyzer } = analyzerWith([bad, bad])

  await assert.rejects(
    () => analyzer.analyze({ text: TRANSCRIPT }),
    /Invalid score for O-3/
  )
  assert.equal(client.calls.length, 2)
})

test('too-short transcript fails the quality gate without any API call', async () => {
  const { client, analyzer } = analyzerWith([makeValidOutput()])
  // >100 chars (passes route-level zod) but <100 words (fails quality gate)
  const short = 'word '.repeat(30).trim() + ' end of this very short transcript text.'
  assert.ok(short.length >= 100)

  await assert.rejects(
    () => analyzer.analyze({ text: short }),
    TranscriptQualityError
  )
  assert.equal(client.calls.length, 0)
})

test('findVerbatimEvidence returns null for absent text and exact substring for present text', () => {
  assert.equal(findVerbatimEvidence(TRANSCRIPT, 'completely absent phrase'), null)
  assert.equal(findVerbatimEvidence(TRANSCRIPT, '  I stay calm under pressure  '), 'I stay calm under pressure')
})
