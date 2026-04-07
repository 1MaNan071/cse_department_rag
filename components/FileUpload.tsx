'use client';
import { useState, useCallback, useEffect, useRef } from 'react';

interface IngestResult {
    fileName: string;
    success: boolean;
    chunksCreated: number;
    storagePath?: string;
    error?: string;
}

interface IngestedFileInfo {
    fileName: string;
    storagePath: string | null;
    uploadedAt: string;
    totalChunks: number;
}

const ALLOWED_EXTENSIONS = new Set([
    'pdf', 'docx', 'doc', 'txt', 'md', 'xlsx', 'xls', 'schedx7',
]);

function isAllowed(name: string): boolean {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
}

function fileIcon(name: string): string {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return '📕';
    if (ext === 'docx' || ext === 'doc') return '📘';
    if (ext === 'xlsx' || ext === 'xls') return '📗';
    if (ext === 'schedx7') return '📅';
    return '📄';
}

export default function FileUpload() {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStage, setUploadStage] = useState('');
    const [uploadProgress, setUploadProgress] = useState('');
    const [results, setResults] = useState<IngestResult[]>([]);
    const [ingestedFiles, setIngestedFiles] = useState<IngestedFileInfo[]>([]);
    const [showFiles, setShowFiles] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [listError, setListError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const folderInputRef = useRef<HTMLInputElement>(null);
    const fileListRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadIngestedFiles();
    }, []);

    // Ensure webkitdirectory attribute is set natively on the folder input.
    // React may not reliably pass non-standard attributes like webkitdirectory,
    // which can cause the browser to open a file picker instead of a folder picker.
    useEffect(() => {
        if (folderInputRef.current) {
            folderInputRef.current.setAttribute('webkitdirectory', '');
            folderInputRef.current.setAttribute('directory', '');
        }
    }, []);

    // ── Upload handler that supports folder paths ──────────────────────────────
    const handleFilesWithPaths = async (
        items: { file: File; relativePath?: string }[],
    ) => {
        if (items.length === 0) return;

        // Filter to allowed types only
        const allowed = items.filter((i) => isAllowed(i.file.name));
        if (allowed.length === 0) {
            setResults([
                {
                    fileName: 'Upload',
                    success: false,
                    chunksCreated: 0,
                    error: 'No supported files found. Allowed: PDF, DOCX, DOC, TXT, MD, XLSX, XLS, SCHEDX7',
                },
            ]);
            return;
        }

        setIsUploading(true);
        setResults([]);

        const formData = new FormData();
        for (const item of allowed) {
            formData.append('files', item.file);
            formData.append('paths', item.relativePath || item.file.name);
        }

        try {
            setUploadStage('Uploading to storage...');
            setUploadProgress(`0 / ${allowed.length} files`);
            await new Promise((r) => setTimeout(r, 400));
            setUploadStage('Parsing & chunking...');

            const res = await fetch('/api/ingest', { method: 'POST', body: formData });
            const data = await res.json();

            setUploadStage('Generating embeddings...');
            await new Promise((r) => setTimeout(r, 300));

            if (data.results) {
                setResults(data.results);
                await loadIngestedFiles();
            } else {
                setResults([
                    { fileName: 'Upload', success: false, chunksCreated: 0, error: data.error },
                ]);
            }
        } catch {
            setResults([
                { fileName: 'Upload', success: false, chunksCreated: 0, error: 'Network error. Try again.' },
            ]);
        } finally {
            setIsUploading(false);
            setUploadStage('');
            setUploadProgress('');
        }
    };

    // ── Simple file handler (backwards-compatible) ────────────────────────────
    const handleFiles = async (files: File[]) => {
        await handleFilesWithPaths(files.map((f) => ({ file: f })));
    };

    // ── Drag & drop (supports folder drops via DataTransfer items) ────────────
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const items = e.dataTransfer.items;

        // Try to use webkitGetAsEntry for folder drops
        if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
            const allFiles: { file: File; relativePath?: string }[] = [];

            // readEntries() returns results in BATCHES — must call repeatedly
            // until it returns an empty array to get ALL entries.
            const readAllEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
                return new Promise((resolve, reject) => {
                    const allEntries: FileSystemEntry[] = [];
                    const readBatch = () => {
                        reader.readEntries((entries) => {
                            if (entries.length === 0) {
                                resolve(allEntries);
                            } else {
                                allEntries.push(...entries);
                                readBatch(); // keep reading until empty
                            }
                        }, reject);
                    };
                    readBatch();
                });
            };

            const readEntry = (entry: FileSystemEntry, path: string): Promise<void> => {
                return new Promise((resolve, reject) => {
                    if (entry.isFile) {
                        (entry as FileSystemFileEntry).file((file) => {
                            const relativePath = path ? `${path}/${file.name}` : file.name;
                            allFiles.push({ file, relativePath });
                            resolve();
                        }, reject);
                    } else if (entry.isDirectory) {
                        const reader = (entry as FileSystemDirectoryEntry).createReader();
                        readAllEntries(reader).then(async (entries) => {
                            const dirPath = path ? `${path}/${entry.name}` : entry.name;
                            for (const child of entries) {
                                await readEntry(child, dirPath);
                            }
                            resolve();
                        }).catch(reject);
                    } else {
                        resolve();
                    }
                });
            };

            const promises: Promise<void>[] = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry) promises.push(readEntry(entry, ''));
            }
            await Promise.all(promises);
            await handleFilesWithPaths(allFiles);
        } else {
            // Fallback: plain file drop
            handleFiles(Array.from(e.dataTransfer.files));
        }
    }, []);

    // ── Regular file input ───────────────────────────────────────────────────
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(Array.from(e.target.files || []));
    };

    // ── Folder input (webkitdirectory) ──────────────────────────────────────
    const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0) return;

        const items: { file: File; relativePath?: string }[] = [];
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            // webkitRelativePath gives folder-relative path like "FolderName/Sub/File.xlsx"
            const relativePath = (file as any).webkitRelativePath || file.name;
            items.push({ file, relativePath });
        }
        handleFilesWithPaths(items);
    };

    const loadIngestedFiles = async () => {
        setLoadingFiles(true);
        setListError(null);
        try {
            const res = await fetch('/api/ingest');
            const data = await res.json();

            if (!res.ok) {
                setListError(data.error || `Server error: ${res.status}`);
                setIngestedFiles([]);
            } else {
                setIngestedFiles(data.files || []);
            }
        } catch (err) {
            setListError(err instanceof Error ? err.message : 'Failed to load files');
            setIngestedFiles([]);
        } finally {
            setLoadingFiles(false);
        }
    };

    const deleteFile = async (fileName: string) => {
        if (!confirm(`Delete "${fileName}" from the knowledge base?`)) return;
        try {
            const res = await fetch('/api/ingest', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName }),
            });
            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Failed to delete file.');
                return;
            }
            setIngestedFiles((prev) => prev.filter((f) => f.fileName !== fileName));
        } catch {
            alert('Failed to delete file. Please try again.');
        }
    };

    const downloadFile = async (fileName: string) => {
        try {
            const res = await fetch(`/api/download?file=${encodeURIComponent(fileName)}`);
            const data = await res.json();
            if (data.url) {
                window.open(data.url, '_blank', 'noopener,noreferrer');
            } else {
                alert(data.error || 'Could not generate download link.');
            }
        } catch {
            alert('Download failed. Please try again.');
        }
    };

    return (
        <div className="space-y-4">
            {/* ── Drop zone ───────────────────────────────────────────────── */}
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 ${isDragging
                    ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                    : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/30'
                    }`}
            >
                <div className="text-4xl mb-3">📁</div>

                {isUploading ? (
                    <div className="space-y-3">
                        <p className="text-sm font-semibold text-blue-700">{uploadStage || 'Processing...'}</p>
                        {uploadProgress && (
                            <p className="text-xs text-blue-500">{uploadProgress}</p>
                        )}
                        <div className="w-48 mx-auto bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-blue-500 h-1.5 rounded-full animate-pulse w-2/3" />
                        </div>
                        <p className="text-xs text-gray-500">This may take a minute for large files / folders</p>
                    </div>
                ) : (
                    <>
                        <p className="text-sm font-semibold text-gray-700">
                            Drop files or folders here, or click to upload
                        </p>
                        <p className="text-xs text-gray-500 mt-1 mb-4">
                            PDF · DOCX · DOC · XLSX · XLS · SCHEDX7 · TXT · MD | Max 10 MB per file
                        </p>
                        <div className="flex items-center justify-center gap-3 flex-wrap">
                            {/* File picker */}
                            <label className="cursor-pointer inline-flex items-center gap-2 bg-blue-600 text-white text-sm px-5 py-2.5 rounded-xl hover:bg-blue-700 active:scale-95 transition font-medium shadow-sm">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Choose Files
                                <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.docx,.doc,.txt,.md,.xlsx,.xls,.schedx7"
                                    onChange={handleInputChange}
                                    className="hidden"
                                />
                            </label>

                            {/* Folder picker */}
                            <button
                                type="button"
                                onClick={() => folderInputRef.current?.click()}
                                className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm px-5 py-2.5 rounded-xl hover:bg-emerald-700 active:scale-95 transition font-medium shadow-sm"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                                Upload Folder
                            </button>
                            {/* Hidden folder input */}
                            <input
                                ref={folderInputRef}
                                type="file"
                                // @ts-expect-error webkitdirectory is non-standard but widely supported
                                webkitdirectory=""
                                directory=""
                                multiple
                                onChange={handleFolderChange}
                                className="hidden"
                            />
                        </div>
                    </>
                )}
            </div>

            {/* ── Upload results ──────────────────────────────────────────── */}
            {results.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {results.map((result, i) => (
                        <div
                            key={i}
                            className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm border ${result.success
                                ? 'bg-green-50 border-green-200 text-green-800'
                                : 'bg-red-50 border-red-200 text-red-700'
                                }`}
                        >
                            <span className="font-medium truncate">
                                {result.success ? '✅' : '❌'} {result.fileName}
                            </span>
                            <span className="text-xs flex-shrink-0 ml-2">
                                {result.success ? `${result.chunksCreated} chunks · stored ☁️` : result.error}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <button
                onClick={loadIngestedFiles}
                className="w-full py-2 text-sm text-gray-500 hover:text-blue-600 border border-dashed border-gray-300 hover:border-blue-300 rounded-xl transition flex items-center justify-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Refresh Knowledge Base
            </button>

            {showFiles && (
                <div className="border border-gray-200 rounded-2xl overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center justify-between">
                        <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">📚 Knowledge Base</p>
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {ingestedFiles.length} files
                        </span>
                    </div>

                    {/* Search bar */}
                    {ingestedFiles.length > 0 && (
                        <div className="px-3 pt-3 pb-2 border-b border-gray-100">
                            <div className="relative">
                                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <input
                                    type="text"
                                    placeholder="Search files..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white placeholder-gray-400"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {loadingFiles ? (
                        <div className="p-6 text-center text-sm text-gray-400">
                            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                            Loading files...
                        </div>
                    ) : listError ? (
                        <div className="p-6 text-center">
                            <p className="text-sm text-red-500 font-medium">⚠️ Failed to load files</p>
                            <p className="text-xs text-red-400 mt-1">{listError}</p>
                            <button
                                onClick={loadIngestedFiles}
                                className="mt-3 text-xs text-blue-600 underline"
                            >
                                Try again
                            </button>
                        </div>
                    ) : ingestedFiles.length === 0 ? (
                        <div className="p-6 text-center">
                            <p className="text-sm text-gray-400">No files in knowledge base yet</p>
                            <p className="text-xs text-gray-300 mt-1">
                                Files visible in Supabase Storage but not here need to be re-uploaded through this panel
                            </p>
                        </div>
                    ) : (() => {
                        const filtered = ingestedFiles.filter((f) =>
                            f.fileName.toLowerCase().includes(searchQuery.toLowerCase())
                        );
                        return filtered.length === 0 ? (
                            <div className="p-6 text-center">
                                <p className="text-sm text-gray-400">No files matching &ldquo;{searchQuery}&rdquo;</p>
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="mt-2 text-xs text-blue-600 underline"
                                >
                                    Clear search
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <div
                                    ref={fileListRef}
                                    className="max-h-80 overflow-y-auto scroll-smooth"
                                >
                                    <ul className="divide-y divide-gray-100">
                                        {filtered.map((file, i) => (
                                            <li key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition">
                                                <span className="text-lg">{fileIcon(file.fileName)}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-gray-800 truncate">{file.fileName}</p>
                                                    <p className="text-xs text-gray-400">
                                                        {file.totalChunks} chunks {file.storagePath ? '· ☁️ stored' : '· ⚠️ no storage'}
                                                    </p>
                                                </div>
                                                <div className="flex gap-2 flex-shrink-0">
                                                    {file.storagePath && (
                                                        <button
                                                            onClick={() => downloadFile(file.fileName)}
                                                            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition font-medium"
                                                        >
                                                            ⬇️ Get
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => deleteFile(file.fileName)}
                                                        className="text-xs bg-red-50 text-red-500 hover:bg-red-100 px-2.5 py-1 rounded-lg transition font-medium"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                {/* Scroll-to-top button — shown when list has many items */}
                                {filtered.length > 5 && (
                                    <button
                                        onClick={() => fileListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                                        className="absolute bottom-2 right-2 bg-white border border-gray-200 shadow-md rounded-full p-1.5 text-gray-500 hover:text-blue-600 hover:border-blue-300 transition"
                                        title="Scroll to top"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                        </svg>
                                    </button>
                                )}
                                {/* File count footer */}
                                {searchQuery && filtered.length !== ingestedFiles.length && (
                                    <div className="bg-gray-50 border-t border-gray-100 px-4 py-1.5 text-center">
                                        <span className="text-xs text-gray-400">
                                            Showing {filtered.length} of {ingestedFiles.length} files
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}