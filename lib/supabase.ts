import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const STORAGE_BUCKET = 'department-files';

export async function uploadFileToStorage(file: File): Promise<string> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `uploads/${Date.now()}_${safeName}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
        });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return storagePath;
}

export async function uploadGeneratedFile(
    buffer: Buffer,
    fileName: string,
    contentType: string
): Promise<string> {
    const storagePath = `generated/${Date.now()}_${fileName}`;

    const { error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: false });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return storagePath;
}

export async function getSignedUrl(
    storagePath: string,
    expiresInSeconds = 3600
): Promise<string> {
    const { data, error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
        throw new Error(`Failed to generate signed URL: ${error?.message}`);
    }
    return data.signedUrl;
}

export async function deleteFileFromStorage(storagePath: string): Promise<void> {
    const { error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

    if (error) throw new Error(`Storage delete failed: ${error.message}`);
}