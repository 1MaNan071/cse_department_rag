import { NextRequest, NextResponse } from 'next/server';
import { ingestFile, deleteFile, listIngestedFiles } from '@/lib/ingest';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const files = formData.getAll('files') as File[];
        // Folder-relative paths sent alongside each file
        const paths = formData.getAll('paths') as string[];

        if (!files || files.length === 0) {
            return NextResponse.json({ error: 'No files provided' }, { status: 400 });
        }

        const allowedExts = ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.xls', '.schedx7'];
        for (const file of files) {
            const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
            if (!allowedExts.includes(ext)) {
                return NextResponse.json(
                    { error: `Unsupported file type: ${file.name}. Allowed: PDF, DOCX, DOC, TXT, MD, XLSX, XLS, SCHEDX7` },
                    { status: 400 }
                );
            }
            if (file.size > 10 * 1024 * 1024) {
                return NextResponse.json(
                    { error: `File too large: ${file.name}. Max 10MB.` },
                    { status: 400 }
                );
            }
        }

        const results = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            // Use the folder-relative path if provided (for folder uploads)
            const folderPath = paths[i] || undefined;
            const result = await ingestFile(file, folderPath);
            results.push(result);
        }

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Ingest API error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Ingestion failed' },
            { status: 500 }
        );
    }
}

export async function GET() {
    try {
        const files = await listIngestedFiles();
        return NextResponse.json({ files });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to list files' },
            { status: 500 }
        );
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { fileName } = await req.json();
        if (!fileName) {
            return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
        }
        await deleteFile(fileName);
        return NextResponse.json({ success: true, message: `Deleted: ${fileName}` });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Delete failed' },
            { status: 500 }
        );
    }
}