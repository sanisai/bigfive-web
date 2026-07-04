"use strict";
// Combined four-framework analyzer (OCEAN + SDT + JD-R + Spiral Dynamics).
// ADDITIVE module — the existing OCEAN-only TranscriptAnalyzer is untouched.
//
// One GPT call scores all four frameworks in the fork's analyzer style:
// temperature 0.1, deterministic content-hash seed, JSON response format,
// hard structural validation. On soft contract violations (non-verbatim
// ocean evidence, Spiral color labels in employer_view) it retries ONCE with
// a corrective message; if violations persist the response is sanitized
// (offending evidence dropped, offending employer_view strings stripped).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CombinedAnalyzer = exports.TranscriptQualityError = exports.SPIRAL_COLOR_PATTERN = void 0;
exports.findVerbatimEvidence = findVerbatimEvidence;
exports.scrubSpiralEmployerView = scrubSpiralEmployerView;
exports.validateCombinedOutput = validateCombinedOutput;
exports.analyzeCombinedTranscript = analyzeCombinedTranscript;
const openai_1 = __importDefault(require("openai"));
const crypto_1 = __importDefault(require("crypto"));
const transformer_1 = require("./transformer");
const combined_assessment_1 = require("./prompts/combined-assessment");
const content_validator_1 = require("./content-validator");
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OCEAN_DOMAINS = ['O', 'C', 'E', 'A', 'N'];
const REQUIRED_FACETS = ['1', '2', '3', '4', '5', '6'];
// vMEME color labels must never reach an employer-facing Spiral string.
// (No /g flag — a global regex is stateful across .test() calls.)
exports.SPIRAL_COLOR_PATTERN = /\b(blue|orange|green|yellow|turquoise|red|purple|beige)\b/i;
/** Thrown when the transcript fails the content-quality gate (a client error, not a server fault). */
class TranscriptQualityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TranscriptQualityError';
    }
}
exports.TranscriptQualityError = TranscriptQualityError;
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Return the exact transcript substring matching `quote`, or null.
 * Accepts whitespace-normalized matches but always returns the transcript's
 * own characters, so the result is verbatim by construction.
 */
function findVerbatimEvidence(transcript, quote) {
    const trimmed = quote.trim();
    if (!trimmed)
        return null;
    if (transcript.includes(trimmed))
        return trimmed;
    const tokens = trimmed.split(/\s+/).map(escapeRegExp);
    if (tokens.length === 0)
        return null;
    const match = transcript.match(new RegExp(tokens.join('\\s+')));
    return match ? match[0] : null;
}
/** Split employer-view strings into clean vs color-label violations. */
function scrubSpiralEmployerView(view) {
    const clean = [];
    const violations = [];
    for (const s of view) {
        if (exports.SPIRAL_COLOR_PATTERN.test(s))
            violations.push(s);
        else
            clean.push(s);
    }
    return { clean, violations };
}
function assertStringArray(value, label) {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
        throw new Error(`Invalid output: ${label} must be an array of strings`);
    }
}
function assertScore0to100(value, label) {
    const score = value?.score;
    if (typeof score !== 'number' || score < 0 || score > 100) {
        throw new Error(`Invalid output: ${label}.score must be a number between 0 and 100`);
    }
}
/** Hard structural validation — mirrors the existing analyzer's validateGPTOutput discipline. */
function validateCombinedOutput(output) {
    if (!output || typeof output !== 'object') {
        throw new Error('Invalid output: not a JSON object');
    }
    // OCEAN
    if (!output.ocean?.domains || typeof output.ocean.domains !== 'object') {
        throw new Error('Invalid output: missing ocean.domains object');
    }
    OCEAN_DOMAINS.forEach(domain => {
        const d = output.ocean.domains[domain];
        if (!d?.facets) {
            throw new Error(`Invalid output: missing facets for ocean domain ${domain}`);
        }
        REQUIRED_FACETS.forEach(facet => {
            const score = d.facets[facet];
            if (typeof score !== 'number' || score < 1 || score > 5) {
                throw new Error(`Invalid score for ${domain}-${facet}: ${score}`);
            }
        });
        if (d.reasoning !== undefined && typeof d.reasoning !== 'string') {
            throw new Error(`Invalid output: ocean.${domain}.reasoning must be a string`);
        }
        if (d.evidence !== undefined)
            assertStringArray(d.evidence, `ocean.${domain}.evidence`);
    });
    assertStringArray(output.ocean.employer_view, 'ocean.employer_view');
    // SDT
    if (!output.sdt || typeof output.sdt !== 'object') {
        throw new Error('Invalid output: missing sdt object');
    }
    assertScore0to100(output.sdt.autonomy, 'sdt.autonomy');
    assertScore0to100(output.sdt.competence, 'sdt.competence');
    assertScore0to100(output.sdt.relatedness, 'sdt.relatedness');
    if (output.sdt.dominant_drivers !== undefined) {
        assertStringArray(output.sdt.dominant_drivers, 'sdt.dominant_drivers');
    }
    assertStringArray(output.sdt.employer_view, 'sdt.employer_view');
    // JD-R
    if (!output.jdr || typeof output.jdr !== 'object') {
        throw new Error('Invalid output: missing jdr object');
    }
    assertScore0to100(output.jdr.demands, 'jdr.demands');
    assertScore0to100(output.jdr.resources, 'jdr.resources');
    if (output.jdr.sustainability !== undefined && typeof output.jdr.sustainability !== 'string') {
        throw new Error('Invalid output: jdr.sustainability must be a string');
    }
    assertStringArray(output.jdr.employer_view, 'jdr.employer_view');
    // Spiral
    if (!output.spiral?.profile || typeof output.spiral.profile !== 'object') {
        throw new Error('Invalid output: missing spiral.profile object');
    }
    assertStringArray(output.spiral.employer_view, 'spiral.employer_view');
    // Confidence
    if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
        throw new Error('Invalid output: confidence must be a number between 0 and 1');
    }
}
function levelFor(score) {
    if (score >= 65)
        return 'high';
    if (score <= 35)
        return 'low';
    return 'moderate';
}
class CombinedAnalyzer {
    constructor(apiKey, options) {
        this.client = options?.client || new openai_1.default({
            apiKey,
            baseURL: process.env.OPENAI_BASE_URL || undefined
        });
        this.model = options?.model || OPENAI_MODEL;
    }
    async analyze(input) {
        const startTime = Date.now();
        const quality = (0, content_validator_1.assessContentQuality)(input.text);
        const { proceed, reason } = (0, content_validator_1.shouldProceedWithAnalysis)(quality);
        if (!proceed) {
            throw new TranscriptQualityError(reason || 'Transcript quality is insufficient for analysis');
        }
        // Deterministic seed for repeatability (same recipe as the OCEAN analyzer)
        const transcriptHash = crypto_1.default.createHash('md5').update(input.text).digest('hex');
        const seed = parseInt(transcriptHash.substring(0, 8), 16) % 1000000;
        const baseMessages = [
            { role: 'system', content: combined_assessment_1.COMBINED_SYSTEM_PROMPT },
            {
                role: 'user',
                content: (0, combined_assessment_1.buildCombinedAnalysisPrompt)(input.text, {
                    candidateName: input.candidateName,
                    jobRole: input.jobRole
                })
            }
        ];
        let messages = baseMessages;
        let totalTokens = 0;
        let systemFingerprint;
        let raw = null;
        const maxAttempts = 2;
        let attempt = 0;
        while (attempt < maxAttempts) {
            attempt++;
            const response = await this.client.chat.completions.create({
                model: this.model,
                temperature: 0.1,
                response_format: { type: 'json_object' },
                seed,
                messages
            });
            totalTokens += response.usage?.total_tokens || 0;
            systemFingerprint = response.system_fingerprint || systemFingerprint;
            const content = response.choices[0]?.message?.content;
            if (!content) {
                if (attempt < maxAttempts)
                    continue;
                throw new Error('No content received from OpenAI');
            }
            let parsed;
            try {
                parsed = JSON.parse(content);
                validateCombinedOutput(parsed);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (attempt < maxAttempts) {
                    messages = [...baseMessages, {
                            role: 'user',
                            content: (0, combined_assessment_1.buildCorrectionPrompt)([`Structural problem: ${message}`])
                        }];
                    continue;
                }
                throw new Error(`Failed to analyze transcript (combined): ${message}`);
            }
            // Soft contract violations: non-verbatim evidence + Spiral color labels
            const violations = this.collectSoftViolations(parsed, input.text);
            if (violations.length === 0 || attempt >= maxAttempts) {
                raw = parsed;
                break;
            }
            messages = [...baseMessages, { role: 'user', content: (0, combined_assessment_1.buildCorrectionPrompt)(violations) }];
        }
        if (!raw) {
            throw new Error('Failed to analyze transcript (combined): no valid response');
        }
        // Sanitize any violations that survived the retry
        const { frameworks, evidenceDropped, spiralViewScrubbed } = this.toFrameworks(raw, input.text);
        return {
            frameworks,
            confidence: raw.confidence,
            metadata: {
                model: this.model,
                timestamp: new Date(),
                transcriptLength: input.text.length,
                tokensUsed: totalTokens,
                processingTime: Date.now() - startTime,
                contentQuality: quality.estimatedQuality,
                contentQualityScore: (0, content_validator_1.getQualityScore)(quality),
                deterministicSeed: seed,
                systemFingerprint,
                attempts: attempt,
                evidenceDropped,
                spiralViewScrubbed
            }
        };
    }
    collectSoftViolations(raw, transcript) {
        const violations = [];
        OCEAN_DOMAINS.forEach(domain => {
            const evidence = raw.ocean.domains[domain]?.evidence || [];
            evidence.forEach(quote => {
                if (!findVerbatimEvidence(transcript, quote)) {
                    violations.push(`ocean.${domain} evidence is not a verbatim transcript substring: "${quote.slice(0, 120)}"`);
                }
            });
        });
        const { violations: spiralViolations } = scrubSpiralEmployerView(raw.spiral.employer_view);
        spiralViolations.forEach(s => {
            violations.push(`spiral.employer_view contains a Spiral color label: "${s.slice(0, 120)}"`);
        });
        return violations;
    }
    toFrameworks(raw, transcript) {
        let evidenceDropped = 0;
        const oceanProfile = {};
        OCEAN_DOMAINS.forEach(domain => {
            const d = raw.ocean.domains[domain];
            const sum = REQUIRED_FACETS.reduce((acc, f) => acc + d.facets[f], 0);
            const evidence = [];
            for (const quote of d.evidence || []) {
                const verbatim = findVerbatimEvidence(transcript, quote);
                if (verbatim)
                    evidence.push(verbatim);
                else
                    evidenceDropped++;
            }
            oceanProfile[domain] = {
                score: sum, // 6-30
                average: Math.round((sum / 6) * 100) / 100, // 1-5
                level: (0, transformer_1.calculateResult)(sum, 6),
                reasoning: d.reasoning || '',
                evidence
            };
        });
        const { clean: spiralView, violations } = scrubSpiralEmployerView(raw.spiral.employer_view);
        const frameworks = {
            ocean: {
                profile: oceanProfile,
                employer_view: raw.ocean.employer_view
            },
            sdt: {
                profile: {
                    autonomy: { score: raw.sdt.autonomy.score, level: levelFor(raw.sdt.autonomy.score) },
                    competence: { score: raw.sdt.competence.score, level: levelFor(raw.sdt.competence.score) },
                    relatedness: { score: raw.sdt.relatedness.score, level: levelFor(raw.sdt.relatedness.score) },
                    dominant_drivers: raw.sdt.dominant_drivers || []
                },
                employer_view: raw.sdt.employer_view
            },
            jdr: {
                profile: {
                    demands: { score: raw.jdr.demands.score, level: levelFor(raw.jdr.demands.score) },
                    resources: { score: raw.jdr.resources.score, level: levelFor(raw.jdr.resources.score) },
                    sustainability: raw.jdr.sustainability || ''
                },
                employer_view: raw.jdr.employer_view
            },
            spiral: {
                profile: raw.spiral.profile,
                employer_view: spiralView
            }
        };
        return { frameworks, evidenceDropped, spiralViewScrubbed: violations.length };
    }
}
exports.CombinedAnalyzer = CombinedAnalyzer;
async function analyzeCombinedTranscript(input, apiKey) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
        throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey parameter.');
    }
    const analyzer = new CombinedAnalyzer(key);
    return analyzer.analyze(input);
}
