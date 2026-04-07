-- ============================================================
-- Department RAG — Supabase Setup
-- Run this entire script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<your-project>/sql/new
-- ============================================================

-- 1. Enable the pgvector extension (required for embeddings)
create extension if not exists vector;

-- 2. Create the documents table
create table if not exists documents (
    id          uuid primary key default gen_random_uuid(),
    content     text             not null,
    metadata    jsonb            not null default '{}',
    embedding   vector(384),          -- sentence-transformers/all-MiniLM-L6-v2
    created_at  timestamptz      not null default now()
);

-- 3. Create an index on the embedding column for fast similarity search
create index if not exists documents_embedding_idx
    on documents
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- 4. Create the match_documents RPC function used by the retriever
create or replace function match_documents(
    query_embedding  vector(384),
    match_threshold  float,
    match_count      int
)
returns table (
    id          uuid,
    content     text,
    metadata    jsonb,
    similarity  float
)
language sql stable
as $$
    select
        id,
        content,
        metadata,
        1 - (embedding <=> query_embedding) as similarity
    from documents
    where 1 - (embedding <=> query_embedding) > match_threshold
    order by embedding <=> query_embedding
    limit match_count;
$$;

-- 5. Row Level Security — allow the service role full access
alter table documents enable row level security;

create policy "Service role full access"
    on documents
    for all
    using     (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

-- Optional: allow anon to read (needed if you use the anon key for reads)
create policy "Anon read"
    on documents
    for select
    using (true);

-- 6. Create the storage bucket (run only once; skip if it already exists)
-- You can also create this via the Supabase dashboard: Storage → New bucket
-- insert into storage.buckets (id, name, public)
-- values ('department-files', 'department-files', false)
-- on conflict do nothing;
