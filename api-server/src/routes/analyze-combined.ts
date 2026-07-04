import { Router } from 'express'
import { z } from 'zod'
import {
  analyzeCombinedTranscript,
  assessContentQuality,
  TranscriptQualityError,
  SPIRAL_COLOR_PATTERN
} from '@bigfive-org/transcript-analyzer'
import { saveCombinedAnalysis } from '../db'

// POST /api/analyze-combined — four-framework assessment (OCEAN + SDT + JD-R +
// Spiral Dynamics) in ONE model call, with the profile/employer_view privacy
// split. ADDITIVE route: /api/analyze and its behavior are untouched.

export const analyzeCombinedRouter = Router()

const CombinedRequestSchema = z.object({
  transcript: z.string().min(100, 'Transcript must be at least 100 characters'),
  candidateName: z.string().optional(),
  jobRole: z.string().optional(),
  language: z.string().optional().default('en'),
  metadata: z.record(z.any()).optional()
})

analyzeCombinedRouter.post('/', async (req, res) => {
  try {
    const validatedData = CombinedRequestSchema.parse(req.body)

    const quality = assessContentQuality(validatedData.transcript)
    if (quality.warnings.length > 0) {
      console.warn('Quality warnings (combined):', quality.warnings)
    }

    const analysis = await analyzeCombinedTranscript({
      text: validatedData.transcript,
      language: validatedData.language,
      candidateName: validatedData.candidateName,
      jobRole: validatedData.jobRole
    })

    // RESPONSE-LAYER Spiral privacy enforcement (defense in depth on top of the
    // analyzer's own retry+scrub): no vMEME color label ever leaves this route
    // in an employer-facing string.
    analysis.frameworks.spiral.employer_view =
      analysis.frameworks.spiral.employer_view.filter(s => !SPIRAL_COLOR_PATTERN.test(s))

    // Persist the RESULT only — the transcript text is NOT stored.
    const resultId = await saveCombinedAnalysis({
      language: validatedData.language,
      jobRole: validatedData.jobRole,
      candidateName: validatedData.candidateName,
      transcriptLength: validatedData.transcript.length,
      confidence: analysis.confidence,
      contentQuality: quality.estimatedQuality,
      frameworks: analysis.frameworks,
      analysisMetadata: analysis.metadata as unknown as Record<string, any>,
      metadata: validatedData.metadata
    })

    res.json({
      id: resultId,
      confidence: analysis.confidence,
      contentQuality: quality.estimatedQuality,
      frameworks: analysis.frameworks
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      })
    }

    if (error instanceof TranscriptQualityError) {
      return res.status(400).json({
        error: 'Validation error',
        details: [{ message: error.message }]
      })
    }

    console.error('Combined analysis error:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Combined analysis failed'
    })
  }
})
