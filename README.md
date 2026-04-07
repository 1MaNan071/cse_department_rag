# Department RAG

A Next.js + Supabase Retrieval-Augmented Generation (RAG) app for department workflows.

This project lets users:
- Ingest files (PDF, DOCX, DOC, TXT, MD, XLSX, XLS, SCHEDX7)
- Store chunk embeddings in Supabase with pgvector
- Ask questions over ingested departmental data
- Generate and download response files through API routes

## Tech Stack

- Next.js (App Router)
- TypeScript
- Supabase (Postgres + pgvector + Storage)
- LangChain
- Groq SDK

## Project Structure

```text
department-rag/
	app/
	components/
	lib/
	types/
	supabase_schema.sql
```

## Prerequisites

- Node.js 20+
- npm 10+
- Supabase project
- API keys for Groq and Hugging Face

## Environment Variables

Create `.env.local` in `department-rag/` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GROQ_API_KEY=your_groq_api_key
HUGGINGFACE_API_KEY=your_huggingface_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure Supabase:
- Open your Supabase SQL Editor
- Run `supabase_schema.sql`
- Create required storage bucket if you use file storage flows

3. Run development server:

```bash
npm run dev
```

4. Open app:
- http://localhost:3000

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## API Routes

- `POST /api/ingest`: Ingest uploaded files
- `GET /api/ingest`: List ingested files
- `DELETE /api/ingest`: Delete ingested file entries
- `POST /api/chat`: Ask questions over ingested content
- `POST /api/generate-file`: Generate output files from responses
- `POST /api/download`: Get file download links

## Dependency Guide

For a dedicated dependency installation guide, see:
- `DEPENDENCY_INSTALLATION.md`

## Push to GitHub

Use these commands from the repository root after your changes:

```bash
git add README.md DEPENDENCY_INSTALLATION.md
git commit -m "docs: update README and add dependency installation guide"
git push origin <your-branch-name>
```
