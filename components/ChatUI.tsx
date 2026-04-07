'use client';
import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageBubble from './Message';
import { Message } from '@/types';

export default function ChatUI() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: uuidv4(),
            role: 'assistant',
            content:
                "👋 Hello! I'm the department assistant. I can:\n\n• Answer questions about department documents\n• Help you download files you've lost\n• Generate new documents on demand\n\nJust ask!",
            timestamp: new Date(),
        },
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStage, setLoadingStage] = useState('Thinking...');
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    const sendMessage = async (text?: string) => {
        const messageText = (text || input).trim();
        if (!messageText || isLoading) return;

        const userMessage: Message = {
            id: uuidv4(),
            role: 'user',
            content: messageText,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        const isGenerating = /\b(generate|create|make|build|draft)\b/i.test(messageText);
        const isDownloading = /\b(download|get|retrieve|give me)\b/i.test(messageText);
        setLoadingStage(
            isGenerating
                ? 'Generating your file...'
                : isDownloading
                    ? 'Preparing download link...'
                    : 'Searching documents...'
        );

        try {
            const history = messages
                .slice(-10)
                .map((m) => ({ role: m.role, content: m.content }));

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText, conversationHistory: history }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');

            const botMessage: Message = {
                id: uuidv4(),
                role: 'assistant',
                content: data.answer,
                sources: data.sources,
                downloadLinks: data.downloadLinks,
                generatedFile: data.generatedFile,
                timestamp: new Date(),
            };

            setMessages((prev) => [...prev, botMessage]);
        } catch (error) {
            setMessages((prev) => [
                ...prev,
                {
                    id: uuidv4(),
                    role: 'assistant',
                    content: `Something went wrong: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
                    timestamp: new Date(),
                },
            ]);
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const suggestedPrompts = [
        { icon: '🔍', text: 'What is the exam schedule?' },
        { icon: '⬇️', text: 'Download the department handbook' },
        { icon: '📊', text: 'Generate a file with all CSE teachers and their subjects' },
        { icon: '📋', text: 'Create a faculty directory document' },
    ];

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                ))}

                {isLoading && (
                    <div className="flex justify-start mb-4">
                        <div className="flex items-end gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm">
                                🎓
                            </div>
                            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                                <div className="flex gap-1">
                                    <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                                </div>
                                <span className="text-xs text-gray-500">{loadingStage}</span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {messages.length <= 1 && !isLoading && (
                <div className="px-4 pb-3">
                    <p className="text-xs text-gray-400 mb-2 font-medium">Try asking:</p>
                    <div className="grid grid-cols-2 gap-2">
                        {suggestedPrompts.map((p, i) => (
                            <button
                                key={i}
                                onClick={() => sendMessage(p.text)}
                                className="text-left text-xs bg-white border border-gray-200 text-gray-600 px-3 py-2.5 rounded-xl hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50 transition flex items-start gap-2"
                            >
                                <span className="text-base leading-none">{p.icon}</span>
                                <span className="leading-snug">{p.text}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="border-t border-gray-200 p-3 bg-white">
                <div className="flex items-end gap-2 bg-gray-50 border border-gray-300 rounded-2xl px-4 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask a question, request a download, or say 'generate a file with...'"
                        rows={1}
                        disabled={isLoading}
                        className="flex-1 bg-transparent resize-none outline-none text-sm text-gray-700 placeholder-gray-400 max-h-32 py-1 disabled:opacity-50"
                    />
                    <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim() || isLoading}
                        className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
                <p className="text-xs text-gray-400 text-center mt-1">
                    Enter to send · Shift+Enter for new line
                </p>
            </div>
        </div>
    );
}