import OpenAI from 'openai'
import type { TranscriptInput, OceanAnalysis, GPTRawOutput } from './types'
import { transformToScoreFormat, enrichEvidence } from './transformer'
import { OCEAN_SYSTEM_PROMPT, buildTranscriptAnalysisPrompt } from './prompts/ocean-assessment'
import { assessContentQuality, shouldProceedWithAnalysis, getQualityScore } from './content-validator'
import crypto from 'crypto'

// gpt-4-turbo-preview was removed by OpenAI ("model does not exist"), which broke
// every /api/analyze call. Env-configurable so the next deprecation is an env
// change on Railway, not a code fix.
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'

export class TranscriptAnalyzer {
  private openai: OpenAI

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey })
  }

  async analyze(input: TranscriptInput): Promise<OceanAnalysis> {
    const startTime = Date.now()

    // Validate content quality before analysis
    const quality = assessContentQuality(input.text)
    const { proceed, reason } = shouldProceedWithAnalysis(quality)

    if (!proceed) {
      throw new Error(reason || 'Transcript quality is insufficient for analysis')
    }

    // Generate deterministic seed for repeatability
    const transcriptHash = crypto.createHash('md5').update(input.text).digest('hex')
    const seed = parseInt(transcriptHash.substring(0, 8), 16) % 1000000

    try {
      const response = await this.openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.1, // Very low temperature for consistency (was 0.3)
        response_format: { type: 'json_object' },
        seed: seed, // Deterministic seed based on content hash
        messages: [
          {
            role: 'system',
            content: OCEAN_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: buildTranscriptAnalysisPrompt(input.text, {
              jobRole: input.jobRole,
              interviewType: input.interviewType
            })
          }
        ]
      })

      const content = response.choices[0].message.content
      if (!content) {
        throw new Error('No content received from OpenAI')
      }

      const gptOutput: GPTRawOutput = JSON.parse(content)

      // Validate the output structure
      this.validateGPTOutput(gptOutput)

      // Transform to existing score format
      const scores = transformToScoreFormat(gptOutput)
      const evidence = enrichEvidence(gptOutput.evidence)

      const processingTime = Date.now() - startTime

      return {
        scores,
        evidence,
        confidence: gptOutput.confidence,
        reasoning: gptOutput.reasoning,
        metadata: {
          model: OPENAI_MODEL,
          timestamp: new Date(),
          transcriptLength: input.text.length,
          tokensUsed: response.usage?.total_tokens || 0,
          processingTime,
          contentQuality: quality.estimatedQuality,
          contentQualityScore: getQualityScore(quality),
          deterministicSeed: seed,
          systemFingerprint: response.system_fingerprint || undefined
        }
      }
    } catch (error) {
      console.error('Transcript analysis failed:', error)
      throw new Error(`Failed to analyze transcript: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private validateGPTOutput(output: any): asserts output is GPTRawOutput {
    const domains = ['O', 'C', 'E', 'A', 'N']
    const requiredFacets = ['1', '2', '3', '4', '5', '6']

    if (!output.scores || typeof output.scores !== 'object') {
      throw new Error('Invalid output: missing scores object')
    }

    domains.forEach(domain => {
      if (!output.scores[domain]?.facets) {
        throw new Error(`Invalid output: missing facets for domain ${domain}`)
      }

      requiredFacets.forEach(facet => {
        const score = output.scores[domain].facets[facet]
        if (typeof score !== 'number' || score < 1 || score > 5) {
          throw new Error(`Invalid score for ${domain}-${facet}: ${score}`)
        }
      })
    })

    if (!Array.isArray(output.evidence)) {
      throw new Error('Invalid output: evidence must be an array')
    }

    if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
      throw new Error('Invalid output: confidence must be a number between 0 and 1')
    }
  }
}

export async function analyzeTranscript(input: TranscriptInput, apiKey?: string): Promise<OceanAnalysis> {
  const key = apiKey || process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey parameter.')
  }

  const analyzer = new TranscriptAnalyzer(key)
  return analyzer.analyze(input)
}
