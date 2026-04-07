import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getSignedUrl, STORAGE_BUCKET } from '@/lib/supabase';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const fileName = searchParams.get('file');

        if (!fileName) {
            return NextResponse.json({ error: '`file` query param is required' }, { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from('documents')
            .select('metadata')
            .eq('metadata->>fileName', fileName)
            .limit(1);

        if (error) throw new Error(error.message);

        const storagePath = data?.[0]?.metadata?.storagePath as string | undefined;

        if (!storagePath) {
            return NextResponse.json(
                {
                    error: `File "${fileName}" was not found in the knowledge base, or it was uploaded before storage tracking was enabled.`,
                },
                { status: 404 }
            );
        }

        const { data: fileList } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .list(storagePath.split('/').slice(0, -1).join('/'), {
                search: storagePath.split('/').pop(),
            });

        if (!fileList || fileList.length === 0) {
            return NextResponse.json(
                { error: `The file exists in the database but could not be found in storage.` },
                { status: 404 }
            );
        }

        const signedUrl = await getSignedUrl(storagePath, 3600);

        return NextResponse.json({
            url: signedUrl,
            fileName,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        });
    } catch (error) {
        console.error('Download API error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to generate download link' },
            { status: 500 }
        );
    }
}