const HF_API_KEY = process.env.HUGGINGFACE_API_KEY!;
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const API_URL = `https://router.huggingface.co/hf-inference/models/${EMBEDDING_MODEL}/pipeline/feature-extraction`;

// all-MiniLM-L6-v2 has a 256-token window. Anything beyond is silently
// truncated by the model anyway, so we trim to ~1000 chars (≈256 tokens)
// to reduce payload size and speed up requests.
const MAX_CHARS_PER_CHUNK = 1000;

function trimForEmbedding(text: string): string {
    return text.length > MAX_CHARS_PER_CHUNK
        ? text.slice(0, MAX_CHARS_PER_CHUNK)
        : text;
}

export async function getEmbedding(text: string): Promise<number[]> {
    const trimmed = trimForEmbedding(text);
    const data = await fetchBatchWithRetry([trimmed], 3);
    // Single-text response can be [[...]] or [...]
    if (Array.isArray(data[0]) && Array.isArray((data[0] as unknown[])[0])) return data[0] as unknown as number[];
    if (Array.isArray(data[0])) return data[0];
    return data as unknown as number[];
}

/**
 * Fetch embeddings for a single batch with retry + exponential backoff.
 * Retries on 5xx / 429 (rate-limit) errors up to `maxRetries` times.
 */
async function fetchBatchWithRetry(
    batch: string[],
    maxRetries = 5,
): Promise<number[][]> {
    let lastError = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ inputs: batch }),
        });

        if (response.ok) {
            return await response.json();
        }

        const status = response.status;
        lastError = await response.text();

        // Only retry on transient / rate-limit errors
        const retryable = status === 429 || status === 503 || status === 504 || status >= 500;
        if (!retryable || attempt === maxRetries) {
            throw new Error(
                `HuggingFace API error (HTTP ${status}) after ${attempt + 1} attempt(s): ${lastError.slice(0, 200)}`,
            );
        }

        // Exponential backoff: 2s, 4s, 8s, 16s, 32s
        const delay = Math.min(2000 * Math.pow(2, attempt), 32000);
        console.warn(
            `⚠️  HuggingFace ${status} on batch (attempt ${attempt + 1}/${maxRetries + 1}). ` +
            `Retrying in ${delay / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, delay));
    }
    // Should not reach here, but just in case
    throw new Error(`HuggingFace API error after retries: ${lastError.slice(0, 200)}`);
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
    // ── Tuning knobs ─────────────────────────────────────────────────
    const batchSize = 16;       // HF inference can handle 16-20 short texts per call
    const concurrency = 3;      // Fire 3 batches in parallel
    const interGroupDelay = 300; // ms pause between each group of concurrent batches

    const trimmed = texts.map(trimForEmbedding);
    const results: (number[] | null)[] = new Array(texts.length).fill(null);

    // Build list of batch descriptors
    const batches: { start: number; end: number }[] = [];
    for (let i = 0; i < trimmed.length; i += batchSize) {
        batches.push({ start: i, end: Math.min(i + batchSize, trimmed.length) });
    }

    // Process batches in groups of `concurrency`
    for (let g = 0; g < batches.length; g += concurrency) {
        const group = batches.slice(g, g + concurrency);

        const promises = group.map(async ({ start, end }) => {
            const batch = trimmed.slice(start, end);
            const data = await fetchBatchWithRetry(batch);

            // Handle single-item batch edge case
            if (batch.length === 1 && !Array.isArray(data[0])) {
                results[start] = data as unknown as number[];
            } else {
                for (let j = 0; j < data.length; j++) {
                    results[start + j] = data[j];
                }
            }
        });

        await Promise.all(promises);

        // Progress logging
        const done = Math.min((g + concurrency) * batchSize, texts.length);
        if (texts.length > 30) {
            console.log(`   🔢 Embedded ${done} / ${texts.length} chunks`);
        }

        // Small pause between groups to stay under rate limits
        if (g + concurrency < batches.length) {
            await new Promise((r) => setTimeout(r, interGroupDelay));
        }
    }

    return results as number[][];
}