'use client';
import { useState } from 'react';
import { Message, DownloadLink } from '@/types';

interface MessageProps {
    message: Message;
}

function DownloadButton({ link }: { link: DownloadLink }) {
    const [downloading, setDownloading] = useState(false);
    const [downloaded, setDownloaded] = useState(false);

    const handleDownload = async () => {
        setDownloading(true);
        try {
            window.open(link.url, '_blank', 'noopener,noreferrer');
            setDownloaded(true);
            setTimeout(() => setDownloaded(false), 3000);
        } catch {
            alert('Download failed. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    const expiresIn = Math.round(
        (new Date(link.expiresAt).getTime() - Date.now()) / 60000
    );

    return (
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-4 py-3 gap-3">
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-blue-600 text-lg flex-shrink-0">
                    {link.fileName.endsWith('.pdf')
                        ? '📕'
                        : link.fileName.endsWith('.docx')
                            ? '📘'
                            : '📄'}
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-blue-900 truncate">{link.fileName}</p>
                    <p className="text-xs text-blue-500">Link valid for {expiresIn} min</p>
                </div>
            </div>
            <button
                onClick={handleDownload}
                disabled={downloading}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${downloaded
                        ? 'bg-green-500 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 active:scale-95 text-white'
                    } disabled:opacity-60`}
            >
                {downloading ? (
                    <>
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Opening...
                    </>
                ) : downloaded ? (
                    <>✓ Opened</>
                ) : (
                    <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                    </>
                )}
            </button>
        </div>
    );
}

function GeneratedFileCard({ file }: { file: NonNullable<Message['generatedFile']> }) {
    const [downloading, setDownloading] = useState(false);

    const handleDownload = () => {
        setDownloading(true);
        window.open(file.url, '_blank', 'noopener,noreferrer');
        setTimeout(() => setDownloading(false), 1500);
    };

    return (
        <div className="mt-2 bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-2xl overflow-hidden">
            <div className="bg-emerald-500 px-4 py-2 flex items-center gap-2">
                <span className="text-white text-sm">✨</span>
                <p className="text-white text-xs font-bold uppercase tracking-wide">File Generated</p>
            </div>
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <div className="w-12 h-14 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                        <span className="text-white text-2xl">W</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{file.fileName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{file.description}</p>
                        <p className="text-xs text-emerald-600 mt-1 font-medium">
                            {file.format.toUpperCase()} · Ready to download
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="mt-3 w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                    {downloading ? (
                        <>
                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Opening file...
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download {file.format.toUpperCase()} File
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

export default function MessageBubble({ message }: MessageProps) {
    const isUser = message.role === 'user';

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
            <div className={`max-w-[82%] ${isUser ? 'order-2' : 'order-1'}`}>
                <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${isUser ? 'bg-blue-600 text-white' : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                            }`}
                    >
                        {isUser ? 'U' : '🎓'}
                    </div>

                    <div className="flex-1">
                        <div
                            className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser
                                    ? 'bg-blue-600 text-white rounded-br-sm'
                                    : 'bg-white text-gray-800 rounded-bl-sm border border-gray-200 shadow-sm'
                                }`}
                        >
                            <p className="whitespace-pre-wrap">
                                {message.content.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                                    part.startsWith('**') && part.endsWith('**') ? (
                                        <strong key={i}>{part.slice(2, -2)}</strong>
                                    ) : (
                                        <span key={i}>{part}</span>
                                    )
                                )}
                            </p>
                        </div>

                        {message.generatedFile && (
                            <div className="mt-2">
                                <GeneratedFileCard file={message.generatedFile} />
                            </div>
                        )}

                        {message.downloadLinks && message.downloadLinks.length > 0 && (
                            <div className="mt-2 space-y-2">
                                <p className="text-xs text-gray-500 ml-1 font-medium">⬇️ Download Files:</p>
                                {message.downloadLinks.map((link, i) => (
                                    <DownloadButton key={i} link={link} />
                                ))}
                            </div>
                        )}

                        {message.sources && message.sources.length > 0 && !message.downloadLinks && (
                            <div className="mt-2 space-y-1">
                                <p className="text-xs text-gray-400 ml-1">📎 Referenced:</p>
                                {message.sources.map((source, i) => (
                                    <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium text-slate-700">
                                                {source.fileName.endsWith('.pdf') ? '📕' : source.fileName.endsWith('.docx') ? '📘' : '📄'}{' '}
                                                {source.fileName}
                                            </span>
                                            <span className="text-slate-400">{source.similarity}% match</span>
                                        </div>
                                        <p className="text-slate-500 mt-1 line-clamp-2">{source.excerpt}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        <p className={`text-xs text-gray-400 mt-1 ${isUser ? 'text-right mr-1' : 'ml-1'}`}>
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}