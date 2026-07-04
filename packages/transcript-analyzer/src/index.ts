export { analyzeTranscript, TranscriptAnalyzer } from './analyzer'
export type {
  TranscriptInput,
  OceanAnalysis,
  Evidence,
  Scores,
  DomainScore,
  FacetScore,
  AnalysisMetadata
} from './types'
export { FACET_NAMES } from './prompts/ocean-assessment'
export { assessContentQuality, shouldProceedWithAnalysis, getQualityScore } from './content-validator'
export type { ContentQualityMetrics } from './content-validator'

// Combined four-framework assessment (additive — OCEAN-only API above is unchanged)
export {
  CombinedAnalyzer,
  analyzeCombinedTranscript,
  TranscriptQualityError,
  SPIRAL_COLOR_PATTERN,
  scrubSpiralEmployerView,
  findVerbatimEvidence,
  validateCombinedOutput
} from './combined-analyzer'
export type {
  CombinedTranscriptInput,
  CombinedAnalysis,
  CombinedFrameworks,
  CombinedAnalysisMetadata,
  CombinedGPTRawOutput,
  ChatCompletionsClient,
  OceanDomainProfile,
  OceanDomainKey,
  ScoreLevel
} from './combined-types'
export { COMBINED_SYSTEM_PROMPT, buildCombinedAnalysisPrompt } from './prompts/combined-assessment'
