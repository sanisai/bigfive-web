export interface CombinedTranscriptInput {
    text: string;
    language?: string;
    candidateName?: string;
    jobRole?: string;
}
export interface ScoreLevel {
    score: number;
    level: 'low' | 'moderate' | 'high';
}
export interface OceanDomainProfile {
    score: number;
    average: number;
    level: 'low' | 'neutral' | 'high';
    reasoning: string;
    evidence: string[];
}
export type OceanDomainKey = 'O' | 'C' | 'E' | 'A' | 'N';
export interface CombinedFrameworks {
    ocean: {
        profile: Record<OceanDomainKey, OceanDomainProfile>;
        employer_view: string[];
    };
    sdt: {
        profile: {
            autonomy: ScoreLevel;
            competence: ScoreLevel;
            relatedness: ScoreLevel;
            dominant_drivers: string[];
        };
        employer_view: string[];
    };
    jdr: {
        profile: {
            demands: ScoreLevel;
            resources: ScoreLevel;
            sustainability: string;
        };
        employer_view: string[];
    };
    spiral: {
        profile: Record<string, unknown>;
        employer_view: string[];
    };
}
export interface CombinedAnalysisMetadata {
    model: string;
    timestamp: Date;
    transcriptLength: number;
    tokensUsed: number;
    processingTime: number;
    contentQuality?: 'poor' | 'fair' | 'good' | 'excellent';
    contentQualityScore?: number;
    deterministicSeed?: number;
    systemFingerprint?: string;
    attempts: number;
    evidenceDropped: number;
    spiralViewScrubbed: number;
}
export interface CombinedAnalysis {
    frameworks: CombinedFrameworks;
    confidence: number;
    metadata: CombinedAnalysisMetadata;
}
export interface CombinedGPTRawOutput {
    ocean: {
        domains: Record<string, {
            facets: Record<string, number>;
            reasoning: string;
            evidence: string[];
        }>;
        employer_view: string[];
    };
    sdt: {
        autonomy: {
            score: number;
        };
        competence: {
            score: number;
        };
        relatedness: {
            score: number;
        };
        dominant_drivers: string[];
        employer_view: string[];
    };
    jdr: {
        demands: {
            score: number;
        };
        resources: {
            score: number;
        };
        sustainability: string;
        employer_view: string[];
    };
    spiral: {
        profile: Record<string, unknown>;
        employer_view: string[];
    };
    confidence: number;
}
export interface ChatCompletionsClient {
    chat: {
        completions: {
            create(params: Record<string, unknown>): Promise<{
                choices: Array<{
                    message: {
                        content: string | null;
                    };
                }>;
                usage?: {
                    total_tokens?: number;
                };
                system_fingerprint?: string;
            }>;
        };
    };
}
