import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import {
    supabaseAdmin,
    uploadFileToStorage,
    deleteFileFromStorage,
} from './supabase';
import { getEmbeddings } from './embeddings';
import * as XLSX from 'xlsx';

const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 150,
    separators: ['\n\n', '\n', '. ', ' ', ''],
});

// Splitter tuned for structured / tabular content (larger chunks).
// Attendance sheets & Excel files can have thousands of rows;
// larger chunks reduce API calls while remaining searchable.
const structuredSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,
    chunkOverlap: 300,
    separators: ['\n\n', '\n', '. ', ' ', ''],
});

export interface IngestResult {
    success: boolean;
    chunksCreated: number;
    fileName: string;
    storagePath?: string;
    error?: string;
}

// ── Parsed content with rich metadata ────────────────────────────────────────
interface ParsedContent {
    /** The extracted text */
    text: string;
    /** File-type specific metadata to store alongside every chunk */
    extraMeta: Record<string, unknown>;
    /** If set, use the structured splitter (larger chunks for tabular data) */
    useStructuredSplitter?: boolean;
    /** If provided, these are pre-split sections (each section becomes its own chunk group) */
    sections?: { label: string; text: string }[];
}

// ── Helper: detect file extension ─────────────────────────────────────────────
function ext(name: string): string {
    return (name.split('.').pop() || '').toLowerCase();
}

// ── Excel parser (.xlsx, .xls) ───────────────────────────────────────────────
function parseExcel(buffer: Buffer, fileName: string): ParsedContent {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetNames = workbook.SheetNames;

    const sections: { label: string; text: string }[] = [];
    const allColumnHeaders: string[] = [];
    let totalRows = 0;

    for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        // Get JSON rows with headers
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
            defval: '',
            raw: false,
        });
        if (rows.length === 0) continue;

        const headers = Object.keys(rows[0]);
        allColumnHeaders.push(...headers);
        totalRows += rows.length;

        // Build a readable text block for this sheet
        // Format: "Sheet: <name>\nColumns: ...\n\nRow 1: col1=val1 | col2=val2 ..."
        const headerLine = `Sheet: ${sheetName}\nColumns: ${headers.join(', ')}\nTotal rows: ${rows.length}\n`;
        const rowLines = rows.map((row, idx) => {
            const fields = headers
                .filter((h) => row[h] !== '' && row[h] !== undefined && row[h] !== null)
                .map((h) => `${h}: ${row[h]}`)
                .join(' | ');
            return `Row ${idx + 1}: ${fields}`;
        });

        sections.push({
            label: `Sheet: ${sheetName}`,
            text: headerLine + '\n' + rowLines.join('\n'),
        });
    }

    const uniqueHeaders = [...new Set(allColumnHeaders)];
    const fullText = sections.map((s) => s.text).join('\n\n');

    return {
        text: fullText,
        useStructuredSplitter: true,
        sections,
        extraMeta: {
            fileType: 'excel',
            sheetNames,
            sheetCount: sheetNames.length,
            columnHeaders: uniqueHeaders,
            totalRows,
        },
    };
}

// ── SCHEDX7 parser (.schedx7) — text-based scheduling format ─────────────────
function parseSchedx7(text: string, fileName: string): ParsedContent {
    // SCHEDX7 is text-based; extract structure by detecting sections/blocks
    const lines = text.split(/\r?\n/);
    const sections: { label: string; text: string }[] = [];
    let currentLabel = 'Header';
    let currentLines: string[] = [];

    // Simple heuristic: lines that look like headers (ALL CAPS, or with : or [] or === separators)
    const headerPattern = /^(?:\[.+\]|={3,}|-{3,}|#{1,3}\s|[A-Z][A-Z0-9 _/]{4,}:?\s*$)/;

    for (const line of lines) {
        if (headerPattern.test(line.trim()) && currentLines.length > 0) {
            sections.push({ label: currentLabel, text: currentLines.join('\n') });
            currentLabel = line.trim().replace(/^[\[#=\-]+\s*/, '').replace(/[\]=]+$/, '').trim() || 'Section';
            currentLines = [line];
        } else {
            currentLines.push(line);
        }
    }
    if (currentLines.length > 0) {
        sections.push({ label: currentLabel, text: currentLines.join('\n') });
    }

    // Try to extract schedule-specific metadata
    const datePattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g;
    const timePattern = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/g;
    const dates = [...new Set(text.match(datePattern) || [])];
    const times = [...new Set(text.match(timePattern) || [])];

    return {
        text,
        useStructuredSplitter: true,
        sections: sections.length > 1 ? sections : undefined,
        extraMeta: {
            fileType: 'schedx7',
            sectionCount: sections.length,
            detectedDates: dates.slice(0, 20),
            detectedTimes: times.slice(0, 20),
            lineCount: lines.length,
        },
    };
}

// ── Main file parser ─────────────────────────────────────────────────────────
async function parseFile(file: File): Promise<ParsedContent> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extension = ext(file.name);

    // PDF — pdf-parse v2.x uses a class-based API
    if (extension === 'pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer, verbosity: 0 });
        // getText() internally loads the document, then extracts all page text
        const result = await parser.getText();
        return {
            text: result.text,
            extraMeta: {
                fileType: 'pdf',
                pageCount: result.total ?? null,
            },
        };
    }

    // Word documents (.docx, .doc)
    if (extension === 'docx' || extension === 'doc') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return {
            text: result.value,
            extraMeta: {
                fileType: extension === 'docx' ? 'docx' : 'doc',
            },
        };
    }

    // Excel (.xlsx, .xls)
    if (extension === 'xlsx' || extension === 'xls') {
        return parseExcel(buffer, file.name);
    }

    // SCHEDX7
    if (extension === 'schedx7') {
        const rawText = new TextDecoder().decode(arrayBuffer);
        return parseSchedx7(rawText, file.name);
    }

    // Plain text / markdown
    if (extension === 'txt' || extension === 'md') {
        return {
            text: new TextDecoder().decode(arrayBuffer),
            extraMeta: { fileType: extension },
        };
    }

    throw new Error(`Unsupported file type: ${file.name}`);
}

// ── Ingest a single file (with folder-path awareness) ───────────────────────
export async function ingestFile(
    file: File,
    /** Relative path within the uploaded folder (e.g. "Reports/2024/Q1.xlsx") */
    folderPath?: string,
): Promise<IngestResult> {
    const displayName = folderPath || file.name;
    let storagePath: string | undefined;

    try {
        console.log(`📄 Processing: ${displayName}`);

        // Skip if this exact file is already ingested (avoids duplicates on re-upload)
        const { count } = await supabaseAdmin
            .from('documents')
            .select('id', { count: 'exact', head: true })
            .eq('metadata->>fileName', displayName);
        if (count && count > 0) {
            console.log(`⏭️  Skipping (already ingested): ${displayName}`);
            return { success: true, chunksCreated: count, fileName: displayName, error: 'Already in knowledge base — skipped' };
        }

        console.log(`☁️  Uploading original file to storage...`);
        storagePath = await uploadFileToStorage(file);

        const parsed = await parseFile(file);

        if (!parsed.text.trim()) {
            throw new Error('File appears to be empty or could not be parsed.');
        }

        // Choose splitter based on file type
        const splitter = parsed.useStructuredSplitter ? structuredSplitter : textSplitter;

        // If the parser produced named sections, chunk each section independently
        // so that chunks don't bleed across logical boundaries (sheets, schedule blocks, etc.)
        let allChunks: { text: string; sectionLabel?: string }[] = [];

        if (parsed.sections && parsed.sections.length > 0) {
            for (const section of parsed.sections) {
                if (!section.text.trim()) continue;
                const sectionChunks = await splitter.splitText(section.text);
                allChunks.push(
                    ...sectionChunks.map((c) => ({ text: c, sectionLabel: section.label })),
                );
            }
        } else {
            const chunks = await splitter.splitText(parsed.text);
            allChunks = chunks.map((c) => ({ text: c }));
        }

        if (allChunks.length === 0) {
            throw new Error('No chunks produced after splitting.');
        }

        console.log(`✂️  Created ${allChunks.length} chunks`);

        console.log(`🔢 Generating embeddings...`);
        const embeddings = await getEmbeddings(allChunks.map((c) => c.text));

        const rows = allChunks.map((chunk, index) => ({
            content: chunk.text,
            metadata: {
                fileName: displayName,
                fileSize: file.size,
                storagePath,
                chunkIndex: index,
                totalChunks: allChunks.length,
                uploadedAt: new Date().toISOString(),
                // Folder context (helps relevance when many nested files)
                ...(folderPath ? { folderPath, folderName: folderPath.split('/').slice(0, -1).join('/') } : {}),
                // Section label (sheet name, schedule block, etc.)
                ...(chunk.sectionLabel ? { section: chunk.sectionLabel } : {}),
                // Extra file-type specific metadata
                ...parsed.extraMeta,
            },
            embedding: embeddings[index],
        }));

        // Insert in larger batches for fewer round-trips to Supabase
        const batchSize = 50;
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const { error } = await supabaseAdmin.from('documents').insert(batch);
            if (error) throw new Error(`Supabase insert error: ${error.message}`);
        }

        console.log(`✅ Successfully ingested: ${displayName}`);
        return {
            success: true,
            chunksCreated: allChunks.length,
            fileName: displayName,
            storagePath,
        };
    } catch (err) {
        if (storagePath) {
            try {
                await deleteFileFromStorage(storagePath);
            } catch {
                // best-effort cleanup
            }
        }
        const error = err instanceof Error ? err.message : 'Unknown error';
        console.error(`❌ Ingestion failed for ${displayName}:`, error);
        return { success: false, chunksCreated: 0, fileName: displayName, error };
    }
}

export async function deleteFile(fileName: string): Promise<void> {
    const { data: rows } = await supabaseAdmin
        .from('documents')
        .select('metadata')
        .eq('metadata->>fileName', fileName)
        .limit(1);

    const storagePath = rows?.[0]?.metadata?.storagePath as string | undefined;

    const { error } = await supabaseAdmin
        .from('documents')
        .delete()
        .eq('metadata->>fileName', fileName);
    if (error) throw new Error(`Failed to delete DB records: ${error.message}`);

    if (storagePath) {
        try {
            await deleteFileFromStorage(storagePath);
        } catch (e) {
            console.warn(`Could not delete storage file ${storagePath}:`, e);
        }
    }
}

export interface IngestedFileInfo {
    fileName: string;
    storagePath: string | null;
    uploadedAt: string;
    totalChunks: number;
}

export async function listIngestedFiles(): Promise<IngestedFileInfo[]> {
    // Supabase REST can paginate large result sets; fetch in pages so we can
    // reliably include every file represented in the documents table.
    const pageSize = 1000;
    let from = 0;
    const allRows: Array<{ metadata: any }> = [];

    while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await supabaseAdmin
            .from('documents')
            .select('metadata')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw new Error(error.message);

        const rows = data || [];
        allRows.push(...rows);

        if (rows.length < pageSize) break;
        from += pageSize;
    }

    const seen = new Map<string, IngestedFileInfo & { _count: number }>();
    for (const row of allRows) {
        const m = row.metadata;
        if (!m?.fileName) continue;
        const existing = seen.get(m.fileName);
        if (existing) {
            existing._count++;
        } else {
            seen.set(m.fileName, {
                fileName: m.fileName,
                storagePath: m.storagePath ?? null,
                uploadedAt: m.uploadedAt ?? '',
                totalChunks: m.totalChunks ?? 0,
                _count: 1,
            });
        }
    }
    // Use actual DB count (more accurate than metadata.totalChunks for re-ingested files)
    return Array.from(seen.values()).map(({ _count, ...rest }) => ({
        ...rest,
        totalChunks: _count,
    }));
}
