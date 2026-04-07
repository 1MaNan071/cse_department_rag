export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: Source[];
    downloadLinks?: DownloadLink[];
    generatedFile?: GeneratedFile;
    timestamp: Date;
}

export interface Source {
    fileName: string;
    similarity: number;
    excerpt: string;
    storagePath?: string;
}

export interface DownloadLink {
    fileName: string;
    url: string;
    expiresAt: string;
}

export interface GeneratedFile {
    fileName: string;
    url: string;
    format: 'docx' | 'txt';
    description: string;
}

export interface ChatRequest {
    message: string;
    conversationHistory?: { role: string; content: string }[];
}

export interface ChatResponse {
    answer: string;
    sources: Source[];
    downloadLinks?: DownloadLink[];
    generatedFile?: GeneratedFile;
    intent?: 'answer' | 'file_download' | 'file_generate';
}