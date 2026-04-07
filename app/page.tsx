'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';

const ChatUI = dynamic(() => import('@/components/ChatUI'), { ssr: false });
const FileUpload = dynamic(() => import('@/components/FileUpload'), { ssr: false });

export default function Home() {
  const [activeTab, setActiveTab] = useState<'chat' | 'admin'>('chat');
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPass, setAdminPass] = useState('');

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[90vh] flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">
              🎓
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Department Assistant</h1>
              <p className="text-blue-100 text-xs">Powered by AI · Ask anything about department docs</p>
            </div>
          </div>

          <div className="flex bg-white/10 rounded-xl p-1">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 text-sm rounded-lg transition font-medium ${activeTab === 'chat'
                  ? 'bg-white text-blue-700'
                  : 'text-white hover:bg-white/10'
                }`}
            >
              💬 Chat
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`px-3 py-1.5 text-sm rounded-lg transition font-medium ${activeTab === 'admin'
                  ? 'bg-white text-blue-700'
                  : 'text-white hover:bg-white/10'
                }`}
            >
              ⚙️ Admin
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' ? (
            <ChatUI />
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <div className="max-w-lg mx-auto">

                {!adminUnlocked ? (
                  /* Password Gate */
                  <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <div className="text-4xl">🔒</div>
                    <p className="text-gray-700 font-semibold text-lg">Admin Access Required</p>
                    <p className="text-gray-400 text-sm text-center">
                      Only authorized staff can upload or manage documents
                    </p>
                    <input
                      type="password"
                      value={adminPass}
                      onChange={(e) => setAdminPass(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (adminPass === 'dept@admin123') setAdminUnlocked(true);
                          else alert('Wrong password. Please try again.');
                        }
                      }}
                      className="border border-gray-300 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 w-64 text-center"
                      placeholder="Enter admin password"
                    />
                    <button
                      onClick={() => {
                        if (adminPass === 'dept@admin123') setAdminUnlocked(true);
                        else alert('Wrong password. Please try again.');
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-xl text-sm font-semibold transition active:scale-95"
                    >
                      Unlock Admin
                    </button>
                  </div>
                ) : (
                  /* Admin Panel */
                  <>
                    <div className="mb-6 flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-gray-800">Knowledge Base Admin</h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Upload department documents. Supported: PDF, DOCX, TXT, Markdown
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setAdminUnlocked(false);
                          setAdminPass('');
                        }}
                        className="text-xs text-gray-400 hover:text-red-500 transition"
                      >
                        🔒 Lock
                      </button>
                    </div>

                    <FileUpload />

                    <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                      <p className="text-sm font-medium text-amber-800">💡 Tips for best results</p>
                      <ul className="mt-2 text-xs text-amber-700 space-y-1">
                        <li>• Use descriptive file names (e.g., exam_schedule_2024.pdf)</li>
                        <li>• Text-based PDFs work better than scanned images</li>
                        <li>• Delete outdated files to keep answers accurate</li>
                        <li>• After uploading, test with questions in the Chat tab</li>
                      </ul>
                    </div>
                  </>
                )}

              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}