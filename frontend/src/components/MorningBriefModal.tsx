import React, { useEffect, useState } from 'react';
import { X, Coffee, Sparkles, RefreshCw, Calendar } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DigestRecord } from '../types';
import { getDailyBriefs, generateDailyBrief } from '../api';

interface MorningBriefModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MorningBriefModal: React.FC<MorningBriefModalProps> = ({ isOpen, onClose }) => {
  const [briefs, setBriefs] = useState<DigestRecord[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<DigestRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadBriefs();
    }
  }, [isOpen]);

  const loadBriefs = async () => {
    setIsLoading(true);
    try {
      const data = await getDailyBriefs();
      setBriefs(data);
      if (data.length > 0) {
        setSelectedBrief(data[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const newBrief = await generateDailyBrief();
      setBriefs(prev => [newBrief, ...prev.filter(b => b.id !== newBrief.id)]);
      setSelectedBrief(newBrief);
    } catch (e) {
      alert('生成早报失败，请检查后端或LLM服务');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-surfaceBorder rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-200">
        {/* Header */}
        <div className="p-4 px-6 border-b border-surfaceBorder flex items-center justify-between bg-surfaceRaised/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accentGold/15 text-accentGold">
              <Coffee size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-textPrimary flex items-center gap-2">
                每日晨间数字早报
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accentGold/20 text-accentGold font-bold">
                  09:00 定时
                </span>
              </h2>
              <p className="text-xs text-textMuted">过去 24 小时全网高价值动态深度汇编</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={13} className={isGenerating ? "animate-spin" : ""} />
              <span>{isGenerating ? "正在编写中..." : "重新生成"}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surfaceBorder text-textMuted hover:text-textPrimary transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* History Tabs if multiple */}
        {briefs.length > 1 && (
          <div className="px-6 py-2 border-b border-surfaceBorder bg-surface/30 flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-textMuted text-[11px] shrink-0">往期早报：</span>
            {briefs.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBrief(b)}
                className={`px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1 transition-colors ${
                  selectedBrief?.id === b.id
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
                }`}
              >
                <Calendar size={12} />
                <span>{b.date}</span>
              </button>
            ))}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-4">
          {isLoading ? (
            <div className="py-20 text-center text-textMuted text-xs flex flex-col items-center justify-center gap-2">
              <RefreshCw size={24} className="animate-spin text-accent" />
              <span>正在获取早报记录...</span>
            </div>
          ) : selectedBrief ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-textMuted pb-2 border-b border-surfaceBorder/60">
                <span className="font-mono">{selectedBrief.date}</span>
                {selectedBrief.is_fallback && (
                  <span className="text-accentGold text-[11px] bg-accentGold/10 px-2 py-0.5 rounded">
                    保底摘录模式
                  </span>
                )}
              </div>
              <div className="prose prose-invert prose-base max-w-none break-words leading-relaxed">
                <ReactMarkdown>{selectedBrief.content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-textMuted text-xs space-y-3">
              <p>暂无早报记录，点击右上角立即生成第一份早报。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
