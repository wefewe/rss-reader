import React, { useState, useEffect, useRef } from 'react';
import { 
  Highlighter, 
  MessageSquarePlus, 
  Sparkles, 
  Trash2, 
  Copy, 
  Check, 
  X, 
  Edit3, 
  Bot, 
  ChevronDown, 
  ChevronUp, 
  Loader2,
  Bookmark
} from 'lucide-react';
import { Article, ArticleHighlight } from '../types';
import { createHighlight, listHighlights, updateHighlight, deleteHighlight, explainSelection } from '../api';

interface HighlightSectionProps {
  article: Article;
  containerRef: React.RefObject<HTMLDivElement>;
}

const COLOR_MAP = {
  yellow: {
    bg: 'bg-amber-400/20 text-amber-300 border-amber-400/40',
    dot: 'bg-amber-400',
    label: '核心重点',
  },
  green: {
    bg: 'bg-emerald-400/20 text-emerald-300 border-emerald-400/40',
    dot: 'bg-emerald-400',
    label: '启发灵感',
  },
  red: {
    bg: 'bg-rose-400/20 text-rose-300 border-rose-400/40',
    dot: 'bg-rose-400',
    label: '警惕避坑',
  },
  purple: {
    bg: 'bg-purple-400/20 text-purple-300 border-purple-400/40',
    dot: 'bg-purple-400',
    label: '优质工具',
  },
};

export const HighlightSection: React.FC<HighlightSectionProps> = ({ article, containerRef }) => {
  const [highlights, setHighlights] = useState<ArticleHighlight[]>([]);
  const [isSectionOpen, setIsSectionOpen] = useState<boolean>(true);

  // Floating Selection Popup State
  const [selectionRange, setSelectionRange] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const [isAiExplaining, setIsAiExplaining] = useState<boolean>(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState<string>('');
  const [isAddingNote, setIsAddingNote] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState<string>('');

  // Load highlights for current article
  const loadHighlights = async () => {
    try {
      const data = await listHighlights({ article_id: article.id });
      setHighlights(data);
    } catch (e) {
      console.error('Failed to load highlights:', e);
    }
  };

  useEffect(() => {
    loadHighlights();
    setSelectionRange(null);
    setAiExplanation(null);
    setIsAddingNote(false);
  }, [article.id]);

  // Listen to text selection in containerRef
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 2) return;

      // Verify that selection is inside our reading container
      if (containerRef.current && containerRef.current.contains(sel.anchorNode)) {
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setSelectionRange({
            text,
            x: Math.max(10, rect.left + rect.width / 2),
            y: Math.max(10, rect.top - 10),
          });
          setAiExplanation(null);
          setIsAddingNote(false);
          setNoteInput('');
        } catch {
          // ignore selection measuring errors
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Dismiss popup if click outside toolbar
      const popup = document.getElementById('selection-floating-toolbar');
      if (popup && !popup.contains(e.target as Node)) {
        setSelectionRange(null);
        setAiExplanation(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [containerRef]);

  // Create Highlight Handler
  const handleCreateHighlight = async (color: 'yellow' | 'green' | 'red' | 'purple', note?: string) => {
    if (!selectionRange) return;
    try {
      const newHl = await createHighlight({
        article_id: article.id,
        text: selectionRange.text,
        color,
        note: note || undefined,
      });
      setHighlights(prev => [newHl, ...prev]);
      setSelectionRange(null);
      setAiExplanation(null);
      setIsAddingNote(false);
      window.getSelection()?.removeAllRanges();
    } catch (e: any) {
      alert(e.message || '保存高亮失败');
    }
  };

  // AI Explain Selection Handler
  const handleExplain = async () => {
    if (!selectionRange || isAiExplaining) return;
    setIsAiExplaining(true);
    setAiExplanation(null);
    try {
      const exp = await explainSelection({
        selected_text: selectionRange.text,
        article_title: article.title,
        surrounding_context: (article.content || article.summary || '').slice(0, 800),
      });
      setAiExplanation(exp);
    } catch (e: any) {
      setAiExplanation('解析超时，请稍后重试。');
    } finally {
      setIsAiExplaining(false);
    }
  };

  const handleDeleteHighlight = async (id: string) => {
    try {
      await deleteHighlight(id);
      setHighlights(prev => prev.filter(h => h.id !== id));
    } catch (e: any) {
      alert(e.message || '删除失败');
    }
  };

  const handleUpdateNote = async (id: string) => {
    try {
      const updated = await updateHighlight({ id, note: editNoteText });
      setHighlights(prev => prev.map(h => h.id === id ? updated : h));
      setEditingNoteId(null);
    } catch (e: any) {
      alert(e.message || '更新批注失败');
    }
  };

  const handleCopyQuote = (h: ArticleHighlight) => {
    const textToCopy = `> ${h.text}\n\n${h.note ? `*批注：${h.note}*\n` : ''}—— 出自《${article.title}》`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(h.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      {/* 1. Floating Text Selection Popover Toolbar */}
      {selectionRange && (
        <div
          id="selection-floating-toolbar"
          style={{
            position: 'fixed',
            left: `${selectionRange.x}px`,
            top: `${selectionRange.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
          className="z-50 bg-surface/95 backdrop-blur-md border border-surfaceBorder rounded-2xl shadow-2xl p-2 flex flex-col gap-2 min-w-[240px] max-w-sm animate-in fade-in zoom-in-95 duration-150 select-none text-xs"
        >
          {/* Quick Actions Bar */}
          <div className="flex items-center justify-between gap-1.5 pb-1 border-b border-surfaceBorder/60">
            {/* 4 Semantic Colors */}
            <div className="flex items-center gap-1">
              {(['yellow', 'green', 'red', 'purple'] as const).map(color => (
                <button
                  key={color}
                  onClick={() => handleCreateHighlight(color, noteInput)}
                  className={`w-6 h-6 rounded-full flex items-center justify-center hover:scale-110 transition-transform ${COLOR_MAP[color].dot}`}
                  title={`划线: ${COLOR_MAP[color].label}`}
                >
                  <Highlighter size={12} className="text-black/80" />
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-surfaceBorder/80 mx-0.5" />

            {/* Note & AI Action Buttons */}
            <button
              onClick={() => setIsAddingNote(!isAddingNote)}
              className={`p-1.5 rounded-lg flex items-center gap-1 transition-colors ${
                isAddingNote ? 'bg-accent/20 text-accent font-medium' : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
              }`}
              title="写想法与批注"
            >
              <MessageSquarePlus size={14} />
              <span className="text-[11px]">批注</span>
            </button>

            <button
              onClick={handleExplain}
              disabled={isAiExplaining}
              className="p-1.5 rounded-lg text-featuredBadge hover:bg-featuredBadge/15 flex items-center gap-1 transition-colors"
              title="划词 AI 即席解析"
            >
              {isAiExplaining ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span className="text-[11px]">AI 解析</span>
            </button>

            <button
              onClick={() => setSelectionRange(null)}
              className="p-1 text-textMuted hover:text-textPrimary rounded-md hover:bg-surfaceRaised"
            >
              <X size={13} />
            </button>
          </div>

          {/* Inline Note Input Box */}
          {isAddingNote && (
            <div className="space-y-1.5 pt-1">
              <input
                type="text"
                autoFocus
                placeholder="随手记录你的见解或疑问..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateHighlight('yellow', noteInput);
                  }
                }}
                className="w-full bg-surfaceRaised border border-surfaceBorder rounded-lg px-2.5 py-1 text-xs text-textPrimary focus:outline-none focus:border-accent"
              />
              <span className="text-[10px] text-textMuted">点击上方颜色圆点或按 Enter 保存划线与想法</span>
            </div>
          )}

          {/* AI Explanation Card in Popover */}
          {aiExplanation && (
            <div className="p-2.5 rounded-xl bg-surfaceRaised/80 border border-featuredBadge/30 text-xs text-textPrimary leading-relaxed space-y-1.5 animate-in fade-in duration-150">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-featuredBadge">
                <Bot size={13} />
                <span>AI 划词即席百科：</span>
              </div>
              <p className="text-[11px] text-textPrimary/90">{aiExplanation}</p>
            </div>
          )}
        </div>
      )}

      {/* 2. Permanent Highlights & Notes Section for Current Article */}
      {highlights.length > 0 && (
        <div className="mt-8 pt-6 border-t border-surfaceBorder space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bookmark size={16} className="text-accent" />
              <h3 className="text-sm font-semibold text-textPrimary">
                本篇划线与知识萃取 ({highlights.length} 条)
              </h3>
            </div>

            <button
              onClick={() => setIsSectionOpen(!isSectionOpen)}
              className="text-xs text-textMuted hover:text-textPrimary flex items-center gap-0.5 transition-colors"
            >
              <span>{isSectionOpen ? '收起划线' : '展开划线'}</span>
              {isSectionOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>

          {isSectionOpen && (
            <div className="grid grid-cols-1 gap-3">
              {highlights.map((h) => {
                const colorConfig = COLOR_MAP[h.color as keyof typeof COLOR_MAP] || COLOR_MAP.yellow;
                const isEditing = editingNoteId === h.id;

                return (
                  <div
                    key={h.id}
                    className="p-3.5 rounded-xl bg-surface/60 border border-surfaceBorder/80 space-y-2 hover:border-surfaceBorder transition-all group"
                  >
                    {/* Header: Color Tag + Date + Action Buttons */}
                    <div className="flex items-center justify-between text-xs text-textMuted pb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${colorConfig.dot}`} />
                        <span className="text-[10px] font-medium text-textMuted">{colorConfig.label}</span>
                        <span className="text-[10px] text-textMuted/60 font-mono">• {h.created_at.replace('T', ' ').slice(0, 16)}</span>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopyQuote(h)}
                          className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
                          title="复制 Markdown 金句引用"
                        >
                          {copiedId === h.id ? <Check size={12} className="text-accentGreen" /> : <Copy size={12} />}
                        </button>

                        <button
                          onClick={() => {
                            setEditingNoteId(h.id);
                            setEditNoteText(h.note || '');
                          }}
                          className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
                          title="编辑批注"
                        >
                          <Edit3 size={12} />
                        </button>

                        <button
                          onClick={() => handleDeleteHighlight(h.id)}
                          className="p-1 rounded text-textMuted hover:text-accentRed hover:bg-accentRed/10 transition-colors"
                          title="移除高亮"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Highlighted Quote Text */}
                    <blockquote className={`text-xs italic leading-relaxed border-l-2 pl-3 py-0.5 rounded-r ${colorConfig.bg}`}>
                      “{h.text}”
                    </blockquote>

                    {/* Attached Note / User Thought */}
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="text"
                          value={editNoteText}
                          onChange={(e) => setEditNoteText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateNote(h.id)}
                          placeholder="填写或修改你的批注思考..."
                          className="flex-1 bg-surfaceRaised border border-surfaceBorder rounded-lg px-2.5 py-1 text-xs text-textPrimary focus:outline-none focus:border-accent"
                        />
                        <button
                          onClick={() => handleUpdateNote(h.id)}
                          className="px-2.5 py-1 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingNoteId(null)}
                          className="px-2 py-1 rounded-lg border border-surfaceBorder text-textMuted hover:text-textPrimary text-xs"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      h.note && (
                        <div className="text-xs text-textPrimary/90 bg-surfaceRaised/50 p-2 rounded-lg border border-surfaceBorder/60 flex items-start gap-1.5">
                          <span className="font-semibold text-accent text-[11px] shrink-0">我的批注:</span>
                          <span className="leading-relaxed">{h.note}</span>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
};
