import type { CombinedTranscriptInput, CombinedAnalysis, CombinedGPTRawOutput, ChatCompletionsClient } from './combined-types';
export declare const SPIRAL_COLOR_PATTERN: RegExp;
/** Thrown when the transcript fails the content-quality gate (a client error, not a server fault). */
export declare class TranscriptQualityError extends Error {
    constructor(message: string);
}
/**
 * Return the exact transcript substring matching `quote`, or null.
 * Accepts whitespace-normalized matches but always returns the transcript's
 * own characters, so the result is verbatim by construction.
 */
export declare function findVerbatimEvidence(transcript: string, quote: string): string | null;
/** Split employer-view strings into clean vs color-label violations. */
export declare function scrubSpiralEmployerView(view: string[]): {
    clean: string[];
    violations: string[];
};
/** Hard structural validation — mirrors the existing analyzer's validateGPTOutput discipline. */
export declare function validateCombinedOutput(output: any): asserts output is CombinedGPTRawOutput;
export declare class CombinedAnalyzer {
    private client;
    private model;
    constructor(apiKey: string, options?: {
        client?: ChatCompletionsClient;
        model?: string;
    });
    analyze(input: CombinedTranscriptInput): Promise<CombinedAnalysis>;
    private collectSoftViolations;
    private toFrameworks;
}
export declare function analyzeCombinedTranscript(input: CombinedTranscriptInput, apiKey?: string): Promise<CombinedAnalysis>;
