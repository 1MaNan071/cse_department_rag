import { supabase, supabaseAdmin } from './supabase';
import { getEmbedding } from './embeddings';

export interface RetrievedChunk {
    id: string;
    content: string;
    metadata: {
        fileName: string;
        storagePath?: string;
        chunkIndex: number;
        totalChunks: number;
        uploadedAt: string;
        // New metadata fields for richer similarity search
        folderPath?: string;
        folderName?: string;
        section?: string;
        fileType?: string;
        // Excel-specific
        sheetNames?: string[];
        sheetCount?: number;
        columnHeaders?: string[];
        totalRows?: number;
        // SCHEDX7-specific
        sectionCount?: number;
        detectedDates?: string[];
        detectedTimes?: string[];
        // PDF-specific
        pageCount?: number;
    };
    similarity: number;
}

// ── Generic Abbreviation Expander ─────────────────────────────────────────────
// Only truly universal academic abbreviations — nothing institution specific
const ABBREVIATION_MAP: Record<string, string> = {
    'gpa': 'grade point average',
    'cgpa': 'cumulative grade point average',
    'hod': 'head of department',
    'dept': 'department',
    'sem': 'semester',
    'yr': 'year',
    'pct': 'percentage',
    'prac': 'practical',
    'lec': 'lecture',
    'subj': 'subject',
    'prof': 'professor',
    'asst': 'assistant',
    'assoc': 'associate',
    'btech': 'bachelor technology',
    'mtech': 'master technology',
    'be': 'bachelor engineering',
    'mst': 'mid semester test',
    'th': 'theory',
    'enroll': 'enrollment',
};

function expandAbbreviations(query: string): string {
    return query
        .toLowerCase()
        .split(/\s+/)
        .map((word) => {
            const clean = word.replace(/[^a-z0-9]/g, '');
            return ABBREVIATION_MAP[clean] ? `${word} ${ABBREVIATION_MAP[clean]}` : word;
        })
        .join(' ');
}

// ── Generic ID Detector ───────────────────────────────────────────────────────
// Detects ANY alphanumeric identifier pattern — does not assume any format
function detectIds(text: string): string[] {
    const ids: string[] = [];

    // Any token that mixes letters + numbers and is 5+ characters long
    // Covers: 0801CS231074, ENG2021001, STU-2024-001, CS/2021/042 etc.
    const mixed = [...text.matchAll(/\b([A-Z0-9]{2,}[0-9]{2,}[A-Z0-9]*)\b/gi)];
    mixed.forEach((m) => {
        const id = m[0].toUpperCase();
        if (id.length >= 5 && /[A-Z]/i.test(id) && /[0-9]/.test(id)) {
            ids.push(id);
        }
    });

    // Pure numeric IDs that are 5-10 digits (roll numbers, employee codes etc.)
    const numeric = [...text.matchAll(/\b(\d{5,10})\b/g)].map((m) => m[0]);
    ids.push(...numeric);

    return [...new Set(ids)];
}

// ── Generic Numeric Suffix Extractor ─────────────────────────────────────────
// Extracts the trailing numeric portion from any ID for range comparison
// Works for 0801CS231074 → 231074, ENG2021001 → 2021001, STU001 → 1
function getNumericSuffix(id: string): number | null {
    const match = id.match(/(\d+)(?:[A-Z]*)$/i);
    return match ? parseInt(match[1], 10) : null;
}

function getIdPrefix(id: string): string {
    // Everything before the trailing numeric block
    const match = id.match(/^(.*?)(\d+)(?:[A-Z]*)$/i);
    return match ? match[1] : id;
}

// ── Entity Extractor ──────────────────────────────────────────────────────────
export interface ExtractedEntities {
    ids: string[];
    names: string[];
    percentages: number[];
    thresholds: { value: number; operator: 'above' | 'below' | 'equal' }[];
    dates: string[];
    codePatterns: string[];
    keywords: string[];
    sections: string[];
}

export function extractEntities(query: string): ExtractedEntities {
    const ids = detectIds(query);

    // Generic code patterns like CO34802P, MA24554, HU24005
    const codePatterns = [...query.matchAll(/\b([A-Z]{2,4}\d{3,6}[A-Z]?)\b/gi)].map(
        (m) => m[0].toUpperCase()
    );

    // Section / division / batch identifiers
    const sections = [
        ...[...query.matchAll(/\b(?:section|sec|div(?:ision)?|group|batch|class)\s*[:\-]?\s*([A-Z0-9])\b/gi)].map(
            (m) => m[1].toUpperCase()
        ),
        ...[...query.matchAll(/\bin\s+([A-Z])\s+(?:section|div|batch|group|class)\b/gi)].map(
            (m) => m[1].toUpperCase()
        ),
    ];

    // Percentages as numbers
    const percentages = [
        ...[...query.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*(?:%|percent(?:age)?)\b/gi)].map(
            (m) => parseFloat(m[1])
        ),
    ];

    // Threshold operators — fully generic
    const thresholds: ExtractedEntities['thresholds'] = [];
    const thresholdDefs: { pattern: RegExp; op: 'above' | 'below' | 'equal' }[] = [
        {
            pattern: /\b(?:above|more than|greater than|over|at least|minimum|min)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)?\b/gi,
            op: 'above',
        },
        {
            pattern: /\b(?:below|less than|under|at most|maximum|max|not more than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)?\b/gi,
            op: 'below',
        },
        {
            pattern: /\b(?:exactly|equal to)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)?\b/gi,
            op: 'equal',
        },
    ];
    for (const { pattern, op } of thresholdDefs) {
        [...query.matchAll(pattern)].forEach((m) =>
            thresholds.push({ value: parseFloat(m[1]), operator: op })
        );
    }

    // Dates — multiple formats
    const dates = [
        ...[...query.matchAll(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g)].map((m) => m[0]),
        ...[...query.matchAll(/\b\d{4}-\d{4}\b/g)].map((m) => m[0]),
        ...[
            ...query.matchAll(
                /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?\b/gi
            ),
        ].map((m) => m[0]),
    ];

    // Names from explicit patterns
    const names: string[] = [];
    const namePatterns = [
        /(?:my name is|i am|for student|student named?|name\s*[:\-])\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    ];
    for (const p of namePatterns) {
        [...query.matchAll(p)].forEach((m) => names.push(m[1]));
    }
    // Multi-word capitalized sequences that are not detected IDs
    [...query.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+)\b/g)].forEach((m) => {
        if (!ids.includes(m[0].toUpperCase())) names.push(m[0]);
    });

    const stopWords = new Set([
        'i', 'my', 'me', 'the', 'is', 'are', 'was', 'what', 'want', 'to',
        'know', 'a', 'an', 'in', 'of', 'for', 'and', 'or', 'hi', 'hello',
        'can', 'you', 'please', 'how', 'do', 'does', 'it', 'this', 'that',
        'have', 'has', 'be', 'been', 'will', 'would', 'could', 'should',
        'tell', 'show', 'give', 'find', 'get', 'check', 'see', 'look',
        'about', 'with', 'from', 'at', 'by', 'on', 'up', 'out', 'as',
        'but', 'not', 'so', 'if', 'then', 'than', 'too', 'very', 'also',
        'which', 'where', 'when', 'who', 'why', 'any', 'all', 'just',
    ]);

    const keywords = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

    return {
        ids,
        names: [...new Set(names)],
        percentages,
        thresholds,
        dates,
        codePatterns,
        keywords,
        sections,
    };
}

// ── Query Type Detector ───────────────────────────────────────────────────────
export type QueryType =
    | 'tabular_lookup'
    | 'eligibility_check'
    | 'aggregate_list'
    | 'cross_document'
    | 'date_schedule'
    | 'comparison'
    | 'document_structure'
    | 'subject_specific'
    | 'negative_query'
    | 'ambiguous'
    | 'factual'
    | 'general';

export function detectQueryType(query: string, entities: ExtractedEntities): QueryType {
    const lower = query.toLowerCase();

    if (/\b(eligible|eligibility|qualify|qualified|allowed|permitted|can i (?:give|appear|attend|sit|write)|detention|detained)\b/i.test(query))
        return 'eligibility_check';

    if (entities.thresholds.length > 0 && /\b(list|show|all|students|who|which|find|give)\b/i.test(query))
        return 'aggregate_list';

    if (/\b(not eligible|absent|missing|didn.t attend|did not|not present|failed|defaulter|detained|short)\b/i.test(lower))
        return 'negative_query';

    if (/\b(both|and also|as well as|in all|across|multiple documents?)\b/i.test(lower))
        return 'cross_document';

    if (/\b(difference|compare|versus|vs\.?|between|section.+section|better|worse|higher|lower)\b/i.test(lower))
        return 'comparison';

    if (/\b(when|date|schedule|timetable|time.?table|upcoming|next|deadline|last date|due date|exam date|exam time)\b/i.test(lower))
        return 'date_schedule';

    // Has ID + specific subject/column = subject specific lookup
    if (
        entities.ids.length > 0 &&
        (entities.codePatterns.length > 0 ||
            entities.keywords.some((k) =>
                ['attendance', 'marks', 'score', 'percentage', 'subject', 'course', 'paper', 'theory', 'practical'].includes(k)
            ))
    )
        return 'subject_specific';

    if (entities.ids.length > 0 || /\b(my attendance|my marks|my score|my percentage|my result|for me)\b/i.test(lower))
        return 'tabular_lookup';

    if (/\b(how to|how do i|how should|format|structure|template|make the|prepare|fill|complete|submit)\b/i.test(lower))
        return 'document_structure';

    if (/\b(list|show all|all students|everyone|give me all|find all|who (?:has|have|is|are))\b/i.test(lower))
        return 'aggregate_list';

    // Ambiguous if very few meaningful keywords and no IDs or names
    const meaningful = entities.keywords.filter(
        (w) => !['what', 'when', 'where', 'which', 'tell', 'show', 'give', 'find', 'about', 'some'].includes(w)
    );
    if (meaningful.length < 2 && entities.ids.length === 0 && entities.names.length === 0)
        return 'ambiguous';

    if (/\b(what is|when is|who is|where is|define|explain|describe|tell me about)\b/i.test(lower))
        return 'factual';

    return 'general';
}

// ── Vector Search ─────────────────────────────────────────────────────────────
async function vectorSearch(query: string, matchCount: number, matchThreshold: number): Promise<RetrievedChunk[]> {
    try {
        const expanded = expandAbbreviations(query);
        const embedding = await getEmbedding(expanded);
        const { data, error } = await supabase.rpc('match_documents', {
            query_embedding: embedding,
            match_threshold: matchThreshold,
            match_count: matchCount,
        });
        if (error) { console.error('Vector search error:', error); return []; }
        return (data as RetrievedChunk[]) || [];
    } catch (err) {
        console.error('Vector search failed:', err);
        return [];
    }
}

// ── Keyword Search ────────────────────────────────────────────────────────────
async function keywordSearch(query: string, matchCount: number, entities: ExtractedEntities): Promise<RetrievedChunk[]> {
    const priorityTerms = [
        ...entities.ids,
        ...entities.codePatterns,
        ...entities.names,
        ...entities.dates,
        ...entities.sections.map((s) => `Section ${s}`),
    ];

    const regularTerms = entities.keywords.filter(
        (k) => k.length > 3 && !entities.ids.some((id) => id.toLowerCase().includes(k))
    );

    const allTerms = [...new Set([...priorityTerms, ...regularTerms])].slice(0, 8);
    if (allTerms.length === 0) return [];

    console.log(`🔍 Keyword terms:`, allTerms);

    const seenIds = new Set<string>();
    const chunkScores = new Map<string, { chunk: RetrievedChunk; score: number }>();

    // Fire all keyword queries in parallel instead of sequentially
    const termResults = await Promise.all(
        allTerms.map(async (term) => {
            const { data, error } = await supabaseAdmin
                .from('documents')
                .select('id, content, metadata')
                .ilike('content', `%${term}%`)
                .limit(matchCount * 2);
            if (error) { console.warn(`Keyword error for "${term}":`, error); return { term, data: [] }; }
            return { term, data: data || [] };
        })
    );

    for (const { term, data } of termResults) {
        const isPriority = priorityTerms.includes(term);

        for (const row of data) {
            const baseScore = isPriority ? 0.75 : 0.55;

            // Boost chunks that have section/sheet metadata matching the term
            const meta = row.metadata || {};
            let metaBoost = 0;
            if (meta.section && typeof meta.section === 'string' &&
                meta.section.toLowerCase().includes(term.toLowerCase())) {
                metaBoost += 0.1;
            }
            if (meta.folderPath && typeof meta.folderPath === 'string' &&
                meta.folderPath.toLowerCase().includes(term.toLowerCase())) {
                metaBoost += 0.05;
            }
            if (meta.columnHeaders && Array.isArray(meta.columnHeaders) &&
                meta.columnHeaders.some((h: string) => h.toLowerCase().includes(term.toLowerCase()))) {
                metaBoost += 0.08;
            }

            if (seenIds.has(row.id)) {
                const existing = chunkScores.get(row.id);
                if (existing) existing.score = Math.min(0.99, existing.score + 0.1 + metaBoost);
            } else {
                seenIds.add(row.id);
                chunkScores.set(row.id, {
                    chunk: { id: row.id, content: row.content, metadata: row.metadata, similarity: baseScore + metaBoost },
                    score: baseScore + metaBoost,
                });
            }
        }
    }

    return Array.from(chunkScores.values())
        .sort((a, b) => b.score - a.score)
        .map(({ chunk, score }) => ({ ...chunk, similarity: score }));
}

// ── Neighbor Chunk Fetcher ────────────────────────────────────────────────────
async function fetchNeighborChunks(chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    const seenIds = new Set(chunks.map((c) => c.id));

    // Build all neighbor fetch requests upfront, then fire in parallel
    const fetchRequests: { fileName: string; idx: number; parentSimilarity: number }[] = [];
    for (const chunk of chunks.slice(0, 4)) {
        const { chunkIndex, totalChunks, fileName } = chunk.metadata;
        const neighborIndexes = [chunkIndex - 1, chunkIndex + 1].filter((i) => i >= 0 && i < totalChunks);
        for (const idx of neighborIndexes) {
            fetchRequests.push({ fileName, idx, parentSimilarity: chunk.similarity });
        }
    }

    const results = await Promise.all(
        fetchRequests.map(async ({ fileName, idx, parentSimilarity }) => {
            const { data } = await supabaseAdmin
                .from('documents')
                .select('id, content, metadata')
                .eq('metadata->>fileName', fileName)
                .eq('metadata->>chunkIndex', idx.toString())
                .limit(1);
            if (data?.[0] && !seenIds.has(data[0].id)) {
                return {
                    id: data[0].id,
                    content: data[0].content,
                    metadata: data[0].metadata,
                    similarity: parentSimilarity * 0.85,
                } as RetrievedChunk;
            }
            return null;
        })
    );

    // Deduplicate
    const neighbors: RetrievedChunk[] = [];
    for (const r of results) {
        if (r && !seenIds.has(r.id)) {
            seenIds.add(r.id);
            neighbors.push(r);
        }
    }
    return neighbors;
}

// ── Main Retriever ────────────────────────────────────────────────────────────
export interface RetrievalResult {
    chunks: RetrievedChunk[];
    queryType: QueryType;
    entities: ExtractedEntities;
    isAmbiguous: boolean;
    suggestedClarification?: string;
}

export async function retrieveWithMetadata(query: string, matchCount = 5, matchThreshold = 0.25): Promise<RetrievalResult> {
    const entities = extractEntities(query);
    const queryType = detectQueryType(query, entities);

    console.log(`🎯 Query type: ${queryType}`);
    console.log(`🔎 Entities:`, JSON.stringify(entities));

    if (queryType === 'ambiguous') {
        return {
            chunks: [], queryType, entities, isAmbiguous: true,
            suggestedClarification: 'Could you provide more details? For example your ID number, document name, subject, or what specifically you are looking for.',
        };
    }

    let effectiveThreshold = matchThreshold;
    let effectiveCount = matchCount;

    switch (queryType) {
        case 'tabular_lookup':
        case 'eligibility_check':
        case 'subject_specific':
            effectiveThreshold = 0.1; effectiveCount = matchCount * 2; break;
        case 'aggregate_list':
        case 'negative_query':
            effectiveThreshold = 0.1; effectiveCount = 15; break;
        case 'document_structure':
            effectiveThreshold = 0.15; effectiveCount = 10; break;
        case 'cross_document':
        case 'comparison':
            effectiveThreshold = 0.2; effectiveCount = 12; break;
        case 'date_schedule':
            effectiveThreshold = 0.2; effectiveCount = 8; break;
    }

    const [vectorResults, keywordResults] = await Promise.all([
        vectorSearch(query, effectiveCount, effectiveThreshold),
        keywordSearch(query, effectiveCount, entities),
    ]);

    console.log(`📊 Vector: ${vectorResults.length}, Keyword: ${keywordResults.length}`);

    const keywordFirstTypes: QueryType[] = ['tabular_lookup', 'eligibility_check', 'subject_specific', 'aggregate_list', 'negative_query'];
    const orderedResults = keywordFirstTypes.includes(queryType)
        ? [...keywordResults, ...vectorResults]
        : [...vectorResults, ...keywordResults];

    const seen = new Set<string>();
    const merged: RetrievedChunk[] = [];
    for (const chunk of orderedResults) {
        if (!seen.has(chunk.id)) { seen.add(chunk.id); merged.push(chunk); }
    }
    merged.sort((a, b) => b.similarity - a.similarity);
    const topChunks = merged.slice(0, effectiveCount);

    const needsNeighbors: QueryType[] = ['tabular_lookup', 'eligibility_check', 'subject_specific', 'document_structure', 'aggregate_list', 'negative_query'];
    let finalChunks = topChunks;

    if (needsNeighbors.includes(queryType)) {
        const neighbors = await fetchNeighborChunks(topChunks);
        const allChunks = [...topChunks, ...neighbors];
        const finalSeen = new Set<string>();
        finalChunks = [];
        for (const chunk of allChunks.sort((a, b) => b.similarity - a.similarity)) {
            if (!finalSeen.has(chunk.id)) { finalSeen.add(chunk.id); finalChunks.push(chunk); }
        }
    }

    console.log(`📦 Final: ${finalChunks.length} chunks (type: ${queryType})`);
    return { chunks: finalChunks, queryType, entities, isAmbiguous: false };
}

export async function retrieveRelevantChunks(query: string, matchCount = 5, matchThreshold = 0.25): Promise<RetrievedChunk[]> {
    return (await retrieveWithMetadata(query, matchCount, matchThreshold)).chunks;
}