import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { retrieveWithMetadata, ExtractedEntities } from '@/lib/retriever';
import { getSignedUrl, supabaseAdmin } from '@/lib/supabase';
import { ChatRequest, ChatResponse, Source, DownloadLink } from '@/types';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const FILE_GENERATE_PATTERNS = [
    /\b(generate|create|make|build|draft|write|produce)\s+(a\s+)?(new\s+)?(file|document|doc|report|sheet|list|pdf|docx|spreadsheet)\b/i,
    /\b(give me|i need|i want)\s+(a\s+)?(file|document|report|list)\s+(with|containing|showing|of)\b/i,
    /\b(generate|create|make)\s+.{0,40}\s+(file|document|report|list)\b/i,
    /\b(file|document|report|list)\s+(containing|with|showing|of)\s+(all|every|only)\b/i,
];

const FILE_DOWNLOAD_PATTERNS = [
    /\b(download|get|retrieve|send|share|give me|i need|find)\s+(the\s+|a\s+)?(file|document|pdf|doc)\b/i,
    /\bcan (you|i)\s+(download|get|access)\b/i,
    /\bwhere (is|can i find|can i get)\s+(the\s+)?file\b/i,
    /\b(file|document)\s+(is|was)\s+(missing|lost|not on my pc|not in my computer|deleted)\b/i,
    /\bshare\s+(the|a|this)?\s*(file|document|pdf|doc)\b/i,
    /\bsend\s+(me|it|the)?\s*(file|document|pdf|doc)\b/i,
];

function detectFileIntent(message: string): 'file_generate' | 'file_download' | null {
    if (FILE_GENERATE_PATTERNS.some((p) => p.test(message))) return 'file_generate';
    if (FILE_DOWNLOAD_PATTERNS.some((p) => p.test(message))) return 'file_download';
    return null;
}

// ── Date Annotator ────────────────────────────────────────────────────────────
// Annotates any date in context with [UPCOMING], [TODAY], or [PAST]
// Works for any date format — no assumptions about what events those dates represent
function annotateDates(context: string): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return context.replace(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g, (match, d, m, y) => {
        const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
        const date = new Date(year, parseInt(m) - 1, parseInt(d));
        if (isNaN(date.getTime())) return match;
        const diffDays = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) return `${match} [UPCOMING — ${diffDays} day(s) from today]`;
        if (diffDays === 0) return `${match} [TODAY]`;
        return `${match} [PAST — ${Math.abs(diffDays)} day(s) ago]`;
    });
}

// ── Range Resolver ────────────────────────────────────────────────────────────
// Detects ANY ID range pattern in context and resolves whether a given ID falls
// within it. Searches same line → nearby lines → wide chunk → full context.
function resolveIdRanges(context: string, queryId: string): string {
    if (!queryId) return context;

    const suffixMatch = queryId.match(/(\d+)([A-Z]*)$/i);
    if (!suffixMatch) return context;

    const querySuffix = parseInt(suffixMatch[1], 10);
    const queryPrefix = queryId.slice(0, queryId.length - suffixMatch[0].length).toUpperCase();

    const resolvedNotes: string[] = [];
    const lines = context.split('\n');

    // Find all range matches across the entire context
    const rangePattern = /([A-Z0-9]{4,})\s*(?:-{1,2}|–|to)\s*([A-Z0-9]{4,})/gi;
    const allMatches = [...context.matchAll(rangePattern)];

    const locationPatterns = [
        /\bLT[-\s]?\d{3,4}\b/gi,
        /\b[A-Z]{1,4}[-\s]\d{3,4}\b/g,
        /\b(?:room|lab|hall|block|theater|theatre|auditorium|tutorial)\s*[-:]?\s*[A-Z0-9]+/gi,
        /\b[A-Z]+\s*(?:room|lab|hall|block)\b/gi,
    ];

    const findLocations = (text: string, rangeStart: string): string[] => {
        const found: string[] = [];
        for (const lp of locationPatterns) {
            [...text.matchAll(lp)].forEach((lm) => {
                const loc = lm[0].trim();
                if (
                    !found.includes(loc) &&
                    loc.length > 2 &&
                    !/^\d+$/.test(loc) &&
                    !rangeStart.startsWith(loc.toUpperCase().replace(/\s/g, ''))
                ) {
                    found.push(loc);
                }
            });
        }
        return found;
    };

    for (const match of allMatches) {
        const rangeStart = match[1].toUpperCase();
        const rangeEnd = match[2].toUpperCase();

        const startSuffixMatch = rangeStart.match(/(\d+)([A-Z]*)$/i);
        const endSuffixMatch = rangeEnd.match(/(\d+)([A-Z]*)$/i);
        if (!startSuffixMatch || !endSuffixMatch) continue;

        const startNum = parseInt(startSuffixMatch[1], 10);
        const endNum = parseInt(endSuffixMatch[1], 10);
        const startPrefix = rangeStart.slice(0, rangeStart.length - startSuffixMatch[0].length);

        if (startPrefix !== queryPrefix) continue;
        if (querySuffix < startNum || querySuffix > endNum) continue;

        // ✅ ID is in this range — escalating search for room
        const matchIndex = match.index || 0;
        const lineIndex = context.substring(0, matchIndex).split('\n').length - 1;

        // Step 1: same line
        let locations = findLocations(lines[lineIndex] || '', rangeStart);

        // Step 2: 3 lines above and below
        if (locations.length === 0) {
            const nearbyText = lines.slice(Math.max(0, lineIndex - 3), lineIndex + 4).join('\n');
            locations = findLocations(nearbyText, rangeStart);
        }

        // Step 3: 400 chars around the match
        if (locations.length === 0) {
            const chunkText = context.substring(
                Math.max(0, matchIndex - 400),
                Math.min(context.length, matchIndex + 400)
            );
            locations = findLocations(chunkText, rangeStart);
        }

        // Step 4: entire context
        if (locations.length === 0) {
            locations = findLocations(context, rangeStart);
        }

        const locationInfo =
            locations.length > 0
                ? locations.slice(0, 2).join(' or ')
                : 'not explicitly stated — check the full seating plan document';

        resolvedNotes.push(
            `✅ RANGE RESOLVED: ID ${queryId} (numeric: ${querySuffix}) is WITHIN ` +
            `range ${rangeStart}(${startNum}) → ${rangeEnd}(${endNum}). ` +
            `Room/location from document: ${locationInfo}.`
        );
    }

    if (resolvedNotes.length > 0) {
        return (
            `[RANGE RESOLUTION]\n` +
            `IMPORTANT: The following has been mathematically verified. Use ONLY this to answer room/location questions. Do NOT say the room is not found.\n` +
            `${resolvedNotes.join('\n')}\n\n` +
            `[DOCUMENT CONTEXT]\n${context}`
        );
    }

    return context;
}

// ── Eligibility Analyzer ──────────────────────────────────────────────────────
// Finds a student row by ID, extracts the percentage, and checks it against
// ANY threshold found in the document or a fallback of the most common value.
// Does NOT hardcode 75% — reads the threshold from the document if present.
function analyzeEligibility(context: string, id: string): string {
    if (!id) return context;

    const lines = context.split('\n');

    // Find the line containing this student's ID
    const studentLine = lines.find(
        (line) =>
            line.toUpperCase().includes(id.toUpperCase()) ||
            // Also match partial ID (last 6+ digits) for flexibility
            (id.length >= 6 && line.includes(id.slice(-6)))
    );

    if (!studentLine) return context;

    // Extract ALL numbers from the student's row
    const allNumbers = [...studentLine.matchAll(/\b(\d{1,3})\b/g)].map((m) => parseInt(m[1]));
    // Filter to plausible percentage range 0-100
    const plausiblePercentages = allNumbers.filter((n) => n >= 0 && n <= 100);

    if (plausiblePercentages.length === 0) return context;

    // The last plausible percentage in the row is typically the overall/total
    const overallPercentage = plausiblePercentages[plausiblePercentages.length - 1];

    // Try to detect the eligibility threshold from the document itself
    // Look for patterns like "minimum 75%", "at least 60%", "75% required" etc.
    const thresholdPatterns = [
        /(?:minimum|min|at least|required|eligibility|eligible if)\s*[:\-]?\s*(\d+)\s*%/gi,
        /(\d+)\s*%\s*(?:minimum|required|needed|mandatory|compulsory|attendance required)/gi,
    ];

    let detectedThreshold: number | null = null;
    for (const tp of thresholdPatterns) {
        const m = context.match(tp);
        if (m) {
            const numMatch = m[0].match(/(\d+)/);
            if (numMatch) { detectedThreshold = parseInt(numMatch[1], 10); break; }
        }
    }

    // Use detected threshold if found, otherwise note that threshold is unknown
    const thresholdNote = detectedThreshold !== null
        ? `Required Threshold (from document): ${detectedThreshold}%`
        : `Required Threshold: Not explicitly stated in the document`;

    const isEligible = detectedThreshold !== null
        ? overallPercentage >= detectedThreshold
        : null;

    const statusNote = isEligible === null
        ? `Cannot determine eligibility — threshold not found in document`
        : isEligible
            ? `✅ ELIGIBLE (meets the required threshold)`
            : `❌ NOT ELIGIBLE — ${detectedThreshold! - overallPercentage}% below the required threshold`;

    const note =
        `[ELIGIBILITY ANALYSIS]\n` +
        `Student ID: ${id}\n` +
        `Student Row: ${studentLine.trim()}\n` +
        `Overall Attendance/Score: ${overallPercentage}%\n` +
        `${thresholdNote}\n` +
        `Status: ${statusNote}\n`;

    return note + '\n[DOCUMENT CONTEXT]\n' + context;
}

// ── Download Link Helper ──────────────────────────────────────────────────────
async function getDownloadLinkForFile(fileName: string, storagePath?: string): Promise<DownloadLink | null> {
    try {
        let sp = storagePath;
        if (!sp) {
            const { data } = await supabaseAdmin
                .from('documents')
                .select('metadata')
                .eq('metadata->>fileName', fileName)
                .limit(1);
            sp = data?.[0]?.metadata?.storagePath;
        }
        if (!sp) return null;
        const url = await getSignedUrl(sp, 3600);
        return { fileName, url, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() };
    } catch {
        return null;
    }
}

// ── System Prompt Builder ─────────────────────────────────────────────────────
// Each prompt is tailored to the query type but never assumes document content
function buildSystemPrompt(queryType: string, context: string, isDownload: boolean): string {
    if (!context) {
        return `You are a helpful department assistant. No relevant documents were found.
Tell the user: "I couldn't find this information in the department's documents. Please contact the department directly."`;
    }

    if (queryType === 'ambiguous') {
        return `You are a helpful department assistant. The query is too vague. Politely ask for clarification — for example their ID number, the document name, or the specific subject/topic they need.`;
    }

    if (queryType === 'document_structure') {
        return `You are a helpful academic assistant. Based on the document excerpts below, guide the student on how to prepare or fill this type of document.

Document excerpts:
${context}

Instructions:
- Walk through each section of the document in order
- Explain what each section contains and what the student needs to fill in
- Use what you see in the document as examples — do not invent sections
- If there are placeholder fields (like <Name>, [Date]), explain what goes there
- You may use general knowledge to explain what a section means but base the structure entirely on the document`;
    }

    if (queryType === 'eligibility_check') {
        return `You are a strict document assistant.

${context}

Instructions:
- If an [ELIGIBILITY ANALYSIS] block is present above, use it directly to give a clear yes/no answer
- State the student's actual percentage and the required threshold found in the document
- If the threshold was not found in the document, say so and give only the attendance percentage
- Do not guess or assume any threshold not stated in the document`;
    }

    if (queryType === 'date_schedule') {
        return `You are a strict document assistant.

${context}

Instructions:
- Dates are annotated with [UPCOMING], [TODAY], or [PAST] — always include this context in your answer
- State exact dates as they appear in the document
- Tell the student clearly whether an event is upcoming or has already passed
- Never guess or invent dates`;
    }

    if (queryType === 'subject_specific') {
        return `You are a strict document assistant.

${context}

Instructions:
- Identify the column corresponding to the requested subject in the table header
- Report the value(s) in that column for the student's row
- State clearly which subject and which type (theory/practical/percentage) you are reporting
- If the subject column cannot be clearly identified, say so`;
    }

    if (queryType === 'aggregate_list' || queryType === 'negative_query') {
        return `You are a strict document assistant.

${context}

Instructions:
- List only records explicitly found in the document excerpts
- For threshold-based conditions, only include records where the value clearly meets the condition
- If the excerpts are incomplete and you cannot give a full list, say so and suggest downloading the full document
- Format the list clearly with ID and name where available`;
    }

    if (queryType === 'cross_document') {
        return `You are a strict document assistant.

${context}

Instructions:
- Check each source document separately and report what each one says
- Clearly state which document confirmed which piece of information
- If the student/item appears in one document but not another, state that explicitly`;
    }

    if (queryType === 'comparison') {
        return `You are a strict document assistant.

${context}

Instructions:
- Compare the requested items point by point using only document content
- Format comparisons clearly (e.g. "Item A: ... | Item B: ...")
- Never add information not present in the documents`;
    }

    // Default strict prompt for factual/general/tabular queries
    return `You are a strict document assistant for a department.

${context}

CRITICAL RULES — follow in this exact order:
1. If the context starts with [RANGE RESOLUTION], that section has been mathematically verified. Use it DIRECTLY to answer any room or location question. Do NOT say the room is unknown or not found — the resolution note IS the answer.
2. If the context starts with [ELIGIBILITY ANALYSIS], use it directly for eligibility questions.
3. For all other questions, answer ONLY using information explicitly present in the document excerpts.
4. If a detail is genuinely not stated, say: "This specific detail is not mentioned in the available documents."
5. NEVER guess, assume, infer, or use general knowledge to fill gaps.
6. NEVER say "I cannot find" or "not explicitly mentioned" when a [RANGE RESOLUTION] note is present — that note IS the explicit answer.
7. NEVER use words like "typically", "usually", "generally", "likely", "probably".
8. Always mention which file the answer came from.
9. ${isDownload ? 'Direct the user to the download button shown below.' : 'If the user asks to share/download a file, direct them to the download button shown below.'}`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const body: ChatRequest = await req.json();
        const { message, conversationHistory = [] } = body;

        if (!message?.trim()) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        const fileIntent = detectFileIntent(message);

        // For file generation, fetch more chunks with lower threshold
        // so the LLM has enough data to build a complete document
        const isFileGen = fileIntent === 'file_generate';
        const retrieveCount = isFileGen ? 15 : 8;
        const retrieveThreshold = isFileGen ? 0.1 : 0.25;

        const { chunks, queryType, entities, isAmbiguous, suggestedClarification } =
            await retrieveWithMetadata(message, retrieveCount, retrieveThreshold);

        // Return early for ambiguous queries
        if (isAmbiguous) {
            return NextResponse.json({
                answer: `I need a bit more information to help you. ${suggestedClarification}`,
                sources: [],
                intent: 'answer',
            } as ChatResponse);
        }

        // Build context, sources, download links
        const sources: Source[] = [];
        const downloadLinks: DownloadLink[] = [];
        let context = '';

        if (chunks.length > 0) {
            context = chunks
                .map((c, i) => `[Source ${i + 1} — ${c.metadata.fileName}]\n${c.content}`)
                .join('\n\n---\n\n');

            const seenFiles = new Set<string>();
            for (const chunk of chunks) {
                if (!seenFiles.has(chunk.metadata.fileName)) {
                    seenFiles.add(chunk.metadata.fileName);
                    sources.push({
                        fileName: chunk.metadata.fileName,
                        similarity: Math.round(chunk.similarity * 100),
                        excerpt: chunk.content.substring(0, 150) + '...',
                        storagePath: chunk.metadata.storagePath,
                    });
                }
            }

            // Fetch download links in parallel — only for top 3 most relevant sources
            const topSources = sources
                .filter((s) => s.similarity >= 70)
                .slice(0, 3);
            const linkPromises = topSources
                .map((source) => getDownloadLinkForFile(source.fileName, source.storagePath));
            const linkResults = await Promise.all(linkPromises);
            for (const link of linkResults) {
                if (link) downloadLinks.push(link);
            }
        }

        // ── Context Enrichment ────────────────────────────────────────────────────
        // Apply enrichments based on what was found — no hardcoded assumptions
        if (context) {
            // Always annotate dates so LLM knows if events are past/upcoming
            context = annotateDates(context);

            // Use the first detected ID for range resolution and eligibility
            const primaryId = entities.ids[0] || '';

            if (queryType === 'eligibility_check' && primaryId) {
                context = analyzeEligibility(context, primaryId);
            } else if (primaryId) {
                // Always try range resolution when an ID is present
                // (handles seating plans, room allocations, any range-based assignment)
                context = resolveIdRanges(context, primaryId);
            }
        }

        // ── File Generate ─────────────────────────────────────────────────────────
        if (fileIntent === 'file_generate') {
            // Pass content + fileName so generate-file can filter by source
            const contextChunks = chunks.map((c) => ({
                content: c.content,
                fileName: c.metadata.fileName,
            }));
            const generateRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/generate-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: message, contextChunks }),
            });
            const generateData = await generateRes.json();

            if (!generateRes.ok) {
                return NextResponse.json({
                    answer: `I tried to generate the file but ran into an error: ${generateData.error}. Please try rephrasing.`,
                    sources,
                    intent: 'file_generate',
                } as ChatResponse);
            }

            return NextResponse.json({
                answer: `✅ I've generated **"${generateData.title}"** for you! Click the download button below.`,
                sources: sources.slice(0, 3),
                // Don't show unrelated download links for generated files — just the generated file itself
                generatedFile: {
                    fileName: generateData.fileName,
                    url: generateData.url,
                    format: 'docx',
                    description: `${generateData.sections} sections · Generated from your request`,
                },
                intent: 'file_generate',
            } as ChatResponse);
        }

        // ── LLM Response ──────────────────────────────────────────────────────────
        const effectiveQueryType = fileIntent === 'file_download' ? 'general' : queryType;
        const systemPrompt = buildSystemPrompt(effectiveQueryType, context, fileIntent === 'file_download');
        const temperature = ['document_structure', 'comparison'].includes(queryType) ? 0.3 : 0.1;

        // Truncate context to ~5000 chars — enough for detailed answers while
        // staying within Groq free-tier token limits for llama-3.3-70b
        const MAX_CONTEXT_CHARS = 5000;
        const truncatedPrompt = systemPrompt.length > MAX_CONTEXT_CHARS
            ? systemPrompt.slice(0, MAX_CONTEXT_CHARS) + '\n...[context truncated for brevity]'
            : systemPrompt;

        // Only keep last 4 conversation turns for context (saves tokens)
        const recentHistory = conversationHistory.slice(-4).map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: truncatedPrompt },
                ...recentHistory,
                { role: 'user', content: message },
            ],
            temperature,
            max_tokens: 1024,
        });

        const answer = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

        return NextResponse.json({
            answer,
            sources,
            downloadLinks: downloadLinks.length > 0 ? downloadLinks : undefined,
            intent: 'answer',
        } as ChatResponse);
    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}