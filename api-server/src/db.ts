import { MongoClient, Db, ObjectId } from 'mongodb'
import type { OceanAnalysis } from '@bigfive-org/transcript-analyzer'

let cachedDb: Db | null = null

export async function connectToDatabase(): Promise<Db> {
  if (cachedDb) {
    return cachedDb
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set')
  }

  const client = new MongoClient(uri)
  await client.connect()

  const dbName = process.env.DB_NAME || 'bigfive'
  cachedDb = client.db(dbName)

  return cachedDb
}

interface SaveAnalysisInput {
  transcript: string
  language: string
  jobRole?: string
  interviewType?: string
  candidateName?: string
  analysis: OceanAnalysis
  metadata?: Record<string, any>
}

export async function saveAnalysis(input: SaveAnalysisInput): Promise<string> {
  const db = await connectToDatabase()
  const collection = db.collection(process.env.DB_COLLECTION || 'results')

  // Convert scores to answers array for compatibility
  const answers = []
  const domains = ['O', 'C', 'E', 'A', 'N'] as const

  for (const domain of domains) {
    const domainScores = input.analysis.scores[domain]
    if (domainScores && domainScores.facet) {
      for (const [facetNum, facetScore] of Object.entries(domainScores.facet)) {
        answers.push({
          domain,
          facet: parseInt(facetNum),
          score: facetScore.score
        })
      }
    }
  }

  const document = {
    // Original format for compatibility
    answers,
    dateStamp: Date.now(),
    lang: input.language,

    // Transcript-specific fields
    type: 'transcript',
    transcript: {
      text: input.transcript,
      jobRole: input.jobRole,
      interviewType: input.interviewType,
      candidateName: input.candidateName,
      length: input.transcript.length
    },

    // Analysis results
    analysis: {
      evidence: input.analysis.evidence,
      confidence: input.analysis.confidence,
      reasoning: input.analysis.reasoning,
      metadata: input.analysis.metadata
    },

    // Additional metadata
    metadata: input.metadata || {}
  }

  const result = await collection.insertOne(document)
  return result.insertedId.toString()
}

// ---------------------------------------------------------------------------
// Combined four-framework assessment persistence (ADDITIVE — saveAnalysis and
// the existing document shapes are untouched).
//
// Deliberate difference from saveAnalysis: the combined document stores the
// assessment RESULT only — never the transcript text (byall port-doc decision 4;
// the caller keeps its own transcript copy).

interface SaveCombinedAnalysisInput {
  language?: string
  jobRole?: string
  candidateName?: string
  transcriptLength: number
  confidence: number
  contentQuality: string
  frameworks: Record<string, any>
  analysisMetadata?: Record<string, any>
  metadata?: Record<string, any>
}

export async function saveCombinedAnalysis(input: SaveCombinedAnalysisInput): Promise<string> {
  const db = await connectToDatabase()
  const collection = db.collection(process.env.DB_COLLECTION || 'results')

  const document = {
    dateStamp: Date.now(),
    lang: input.language || 'en',
    type: 'combined',

    // Transcript INFO only — no transcript text is persisted.
    transcriptInfo: {
      length: input.transcriptLength,
      jobRole: input.jobRole,
      candidateName: input.candidateName
    },

    combined: {
      confidence: input.confidence,
      contentQuality: input.contentQuality,
      frameworks: input.frameworks,
      metadata: input.analysisMetadata || {}
    },

    metadata: input.metadata || {}
  }

  const result = await collection.insertOne(document)
  return result.insertedId.toString()
}

interface GetAnalysisOptions {
  includeEvidence?: boolean
  includeTranscript?: boolean
}

export async function getAnalysisById(
  id: string,
  options: GetAnalysisOptions = {}
): Promise<any | null> {
  const db = await connectToDatabase()
  const collection = db.collection(process.env.DB_COLLECTION || 'results')

  const document = await collection.findOne({ _id: new ObjectId(id) })

  if (!document) {
    return null
  }

  // Combined four-framework documents have their own shape (no answers array).
  // ADDITIVE branch: only 'combined'-type documents (new) take this path;
  // every pre-existing document type flows through the original code below.
  if (document.type === 'combined') {
    return {
      id: document._id.toString(),
      timestamp: document.dateStamp,
      language: document.lang,
      type: 'combined',
      confidence: document.combined?.confidence,
      contentQuality: document.combined?.contentQuality,
      frameworks: document.combined?.frameworks,
      analysisMetadata: document.combined?.metadata,
      transcriptInfo: document.transcriptInfo
    }
  }

  // Build response based on options
  const response: any = {
    id: document._id.toString(),
    timestamp: document.dateStamp,
    language: document.lang,
    type: document.type,
    scores: {}
  }

  // Add domain scores
  const domains = ['O', 'C', 'E', 'A', 'N']
  domains.forEach(domain => {
    const domainAnswers = document.answers.filter((a: any) => a.domain === domain)
    const domainScore = domainAnswers.reduce((sum: number, a: any) => sum + a.score, 0)
    const avgScore = domainScore / domainAnswers.length
    response.scores[domain] = {
      score: domainScore,
      average: avgScore,
      result: avgScore > 3.5 ? 'high' : avgScore < 2.5 ? 'low' : 'neutral'
    }
  })

  // Add analysis metadata
  if (document.analysis) {
    response.confidence = document.analysis.confidence
    response.reasoning = document.analysis.reasoning

    if (options.includeEvidence && document.analysis.evidence) {
      response.evidence = document.analysis.evidence
    }

    if (document.analysis.metadata) {
      response.analysisMetadata = document.analysis.metadata
    }
  }

  // Add transcript info
  if (document.transcript) {
    response.transcriptInfo = {
      length: document.transcript.length,
      jobRole: document.transcript.jobRole,
      interviewType: document.transcript.interviewType,
      candidateName: document.transcript.candidateName
    }

    if (options.includeTranscript) {
      response.transcript = document.transcript.text
    }
  }

  return response
}
