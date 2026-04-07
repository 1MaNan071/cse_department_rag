import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { buildDocx, parseLLMContent } from '@/lib/fileGenerator';
import { uploadGeneratedFile, getSignedUrl } from '@/lib/supabase';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

interface ChunkInput {
    content: string;
    fileName: string;
}

// Detect which section/file the user is asking about from the prompt
function detectTargetSection(prompt: string): string | null {
    const m =
        prompt.match(/\b(?:section|sec|div(?:ision)?|group|batch|class)\s*[:\-]?\s*([A-Z0-9])/i) ||
        prompt.match(/\bin\s+([A-Z])\s+(?:section|div|batch|group|class)/i) ||
        prompt.match(/\b([A-Z])\s+(?:section|div|batch|group|class)/i);
    return m ? m[1].toUpperCase() : null;
}

// Score how relevant a chunk's fileName OR content is to the requested section/target
function chunkMatchesSection(chunk: ChunkInput, section: string | null): boolean {
    if (!section) return true; // no filter if no section detected
    const name = chunk.fileName.toLowerCase();
    const content = chunk.content.toLowerCase();
    const sectionLower = section.toLowerCase();
    // Match patterns like: section_a, sec-a, section a, _a_, (a), etc.
    const patterns = [
        new RegExp(`section[\\s_\\-]*${section}`, 'i'),
        new RegExp(`sec[\\s_\\-]*${section}`, 'i'),
        new RegExp(`[_\\-\\s(]${section}[_\\-\\s).]`, 'i'),
    ];
    // Check file name
    if (patterns.some((p) => p.test(name))) return true;
    // Also check chunk content for section references
    if (content.includes(`section ${sectionLower}`) || content.includes(`section: ${sectionLower}`)) return true;
    return false;
}

export async function POST(req: NextRequest) {
    try {
        const { prompt, contextChunks } = await req.json();

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
        }

        // Normalise: accept both plain strings (legacy) and {content, fileName} objects
        const enrichedChunks: ChunkInput[] = (contextChunks ?? []).map((c: ChunkInput | string) =>
            typeof c === 'string' ? { content: c, fileName: 'unknown' } : c
        );

        // ── Section Filtering ───────────────────────────────────────────────────
        const targetSection = detectTargetSection(prompt);
        console.log(`🗂️  Target section detected: ${targetSection ?? 'none (no filter)'}`);

        let relevantChunks = enrichedChunks;
        if (targetSection) {
            const sectionChunks = enrichedChunks.filter((c) =>
                chunkMatchesSection(c, targetSection)
            );
            // Only apply filter if it narrows the result (avoid empty context)
            if (sectionChunks.length > 0) {
                relevantChunks = sectionChunks;
                console.log(
                    `✂️  Filtered to ${relevantChunks.length} chunks from section ${targetSection} ` +
                    `(dropped ${enrichedChunks.length - relevantChunks.length} from other sections)`
                );
            } else {
                console.warn(`⚠️  Section filter matched 0 chunks — using all ${enrichedChunks.length} chunks`);
            }
        }

        // Group chunks by source file and label them clearly
        const byFile = new Map<string, string[]>();
        for (const chunk of relevantChunks) {
            const existing = byFile.get(chunk.fileName) ?? [];
            existing.push(chunk.content);
            byFile.set(chunk.fileName, existing);
        }

        const contextText = byFile.size > 0
            ? Array.from(byFile.entries())
                .map(([file, contents]) =>
                    `=== SOURCE FILE: ${file} ===\n${contents.join('\n---\n')}`
                )
                .join('\n\n')
            : '';

        const sectionNote = targetSection
            ? `The user is asking for Section ${targetSection} data. The context has been pre-filtered to only include chunks from files matching Section ${targetSection}. DO NOT include data from any other file.`
            : 'Use only data from the context below.';

        const systemPrompt = `You are a precise document generator for a department. Your job is to create structured documents using ONLY the data explicitly provided to you in the context below.

${sectionNote}

Here is the ONLY data you are allowed to use:

${contextText || '(no context provided)'}

STRICT DATA RULES — these are non-negotiable:
- Use ONLY names, numbers, and details that are EXPLICITLY present in the context above
- Do NOT invent, estimate, or assume any data not shown above
- Do NOT add students, names, or records that are not in the context
- Every row you output MUST come verbatim from the context — copy enrollment numbers and names exactly as they appear
- Do NOT mix data from different source files
- If the context is incomplete (not all students fit in the retrieved chunks), include only what is available and add a note: "Note: This list may be incomplete. Download the full document for the complete data."
- For fields not present in the context, write "Not Available"
- Do NOT fill in placeholder values or make up realistic-looking data

You MUST respond with ONLY valid JSON in this exact format:
{
  "title": "Document Title Here",
  "sections": [
    {
      "heading": "Section Heading",
      "paragraphs": ["Paragraph text here."]
    },
    {
      "heading": "Data Table",
      "table": {
        "headers": ["Col 1", "Col 2", "Col 3"],
        "rows": [
          ["val1", "val2", "val3"]
        ]
      }
    }
  ]
}

Respond ONLY with the JSON object — no explanation, no markdown, no backticks.`;

        console.log('🤖 Generating document...');
        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 8192,
            response_format: { type: 'json_object' },
        });

        const rawContent = completion.choices[0]?.message?.content;
        if (!rawContent) throw new Error('LLM returned empty response');

        const documentContent = parseLLMContent(rawContent);
        console.log(`📄 Building DOCX: "${documentContent.title}"`);

        const docxBuffer = await buildDocx(documentContent);

        const safeTitle = (documentContent.title || 'Generated_Document')
            .replace(/[^a-zA-Z0-9 _\-]/g, '')
            .replace(/\s+/g, '_')
            .slice(0, 50)
            || 'Generated_Document';
        const fileName = `${safeTitle}.docx`;

        console.log(`☁️  Uploading: ${fileName}`);
        const storagePath = await uploadGeneratedFile(
            docxBuffer,
            fileName,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );

        const signedUrl = await getSignedUrl(storagePath, 3600);

        return NextResponse.json({
            success: true,
            fileName,
            url: signedUrl,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            title: documentContent.title,
            sections: documentContent.sections.length,
        });
    } catch (error) {
        console.error('File generation error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'File generation failed' },
            { status: 500 }
        );
    }
}