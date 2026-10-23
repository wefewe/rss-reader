import React, { useState, useEffect, useMemo } from 'react';
import { 
  Bookmark, 
  Highlighter, 
  Search, 
  Download, 
  Copy, 
  Check, 
  Trash2, 
  Edit3, 
  ExternalLink, 
  Clock, 
  Filter,
  Layers,
  ArrowRight
} from 'lucide-react';
import { ArticleHighlight, Article } from '../types';
import { listHighlights, updateHighlight, deleteHighlight, downloadHighlightsMarkdown } from '../api';

interface HighlightsHubViewProps {
  onSelectArticleById?: (articleId: string) => void;
  articles: Article[];
}

const COLOR_MAP = {
  yellow: {
    bg: 'bg-amber-400/15 text-amber-200 border-amber-400/40',
    dot: 'bg-amber-400',
    label: '核心重点',
  },
  green: {
    bg: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/40',
    dot: 'bg-emerald-400',
    label: '启发灵感',
  },
  red: {
    bg: 'bg-rose-400/15 text-rose-200 border-rose-400/40',
    dot: 'bg-rose-400',
    label: '警惕避坑',
  },
  purple: {
    bg: 'bg-purple-400/15 text-purple-200 border-purple-400/40',
    dot: 'bg-purple-400',
    label: '优质工具',
  },
};

export const HighlightsHubView: React.FC<HighlightsHubViewProps> = ({
  onSelectArticleById,
  articles,
}) => {
  const [highlights, setHighlights] = useState<ArticleHighlight[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string>('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await listHighlights({ limit: 500 });
      setHighlights(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered highlights
  const filteredHighlights = useMemo(() => {
    return highlights.filter(h => {
      if (selectedColor !== 'all' && h.color !== selectedColor) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inText = h.text.toLowerCase().includes(q);
        const inNote = (h.note || '').toLowerCase().includes(q);
        const inTitle = (h.article_title || '').toLowerCase().includes(q);
        return inText || inNote || inTitle;
      }
      return true;
    });
  }, [highlights, selectedColor, searchQuery]);

  // Delete
  const handleDelete = async (id: string) => {
    if (!confirm('确定要移除此条划线记录吗？')) return;
    try {
      await deleteHighlight(id);
      setHighlights(prev => prev.filter(h => h.id !== id));
    } catch (e: any) {
      alert(e.message || '删除失败');
    }
  };

  // Update note
  const handleUpdate = async (id: string) => {
    try {
      const updated = await updateHighlight({ id, note: editNote });
      setHighlights(prev => prev.map(h => h.id === id ? updated : h));
      setEditingId(null);
    } catch (e: any) {
      alert(e.message || '保存失败');
    }
  };

  // Copy single quote
  const handleCopyQuote = (h: ArticleHighlight) => {
    const textToCopy = `> ${h.text}\n\n${h.note ? `*批注：${h.note}*\n` : ''}—— 出自《${h.article_title || '文章'}》`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(h.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export all to Markdown (后端端点 + 前端降级容灾)
  const handleExportMarkdown = async () => {
    if (highlights.length === 0) return;
    try {
      await downloadHighlightsMarkdown();
    } catch (e) {
      console.warn('Backend markdown export failed, using local fallback:', e);
      const nowStr = new Date().toISOString().slice(0, 10);
      let md = `# 💡 我的数字图书馆划线与知识萃取库\n\n导出时间：${nowStr}\n总计收录：${highlights.length} 条灵感划线\n\n---\n\n`;

      // Group highlights by article
      const grouped: Record<string, ArticleHighlight[]> = {};
      for (const h of highlights) {
        const key = h.article_title || '未分类文章';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(h);
      }

      for (const [title, list] of Object.entries(grouped)) {
        md += `## 《${title}》\n\n`;
        for (const item of list) {
          const colorLabel = COLOR_MAP[item.color as keyof typeof COLOR_MAP]?.label || '重点';
          md += `> **[${colorLabel}]** ${item.text}\n\n`;
          if (item.note) {
            md += `✍️ **思考批注**：${item.note}\n\n`;
          }
          md += `<small>记录时间：${item.created_at.slice(0, 16).replace('T', ' ')}</small>\n\n`;
        }
        md += `---\n\n`;
      }

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my_highlights_archive_${nowStr}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex-1 bg-background h-screen flex flex-col overflow-hidden select-none">
      {/* Top Header */}
      <header className="p-4 sm:px-8 border-b border-surfaceBorder bg-surface/40 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-400/15 text-amber-300">
            <Bookmark size={20} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
              灵感与划线萃取库
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surfaceRaised text-textMuted border border-surfaceBorder">
                {highlights.length} 条知识沉淀
              </span>
            </h1>
            <p className="text-xs text-textMuted">Readwise 式阅读工作流：记录高光段落与即时思考</p>
          </div>
        </div>

        <button
          onClick={handleExportMarkdown}
          disabled={highlights.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors shadow-2xs"
          title="导出全部高亮与批注为标准 Markdown 笔记"
        >
          <Download size={13} />
          <span>导出 Markdown</span>
        </button>
      </header>

      {/* Filter & Search Bar */}
      <div className="px-4 sm:px-8 py-3 border-b border-surfaceBorder bg-surfaceRaised/20 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={13} />
          <input
            type="text"
            placeholder="搜索划线金句、文章标题或个人批注..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-surfaceBorder rounded-lg pl-8 pr-3 py-1.5 text-xs text-textPrimary placeholder:text-textMuted/60 focus:outline-none focus:border-accent"
          />
        </div>

        {/* Color Filters */}
        <div className="flex items-center gap-1 bg-surface p-1 rounded-xl border border-surfaceBorder text-xs">
          <button
            onClick={() => setSelectedColor('all')}
            className={`px-2 py-0.5 rounded-lg transition-colors ${
              selectedColor === 'all' ? 'bg-surfaceRaised text-textPrimary font-semibold' : 'text-textMuted hover:text-textPrimary'
            }`}
          >
            全部
          </button>
          {(['yellow', 'green', 'red', 'purple'] as const).map(color => (
            <button
              key={color}
              onClick={() => setSelectedColor(color)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg transition-colors ${
                selectedColor === color ? 'bg-surfaceRaised text-textPrimary font-semibold' : 'text-textMuted hover:text-textPrimary'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${COLOR_MAP[color].dot}`} />
              <span>{COLOR_MAP[color].label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Highlights List Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:px-8 py-6 space-y-4">
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-textMuted text-xs">
            正在载入你的知识库...
          </div>
        ) : filteredHighlights.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-textMuted text-xs gap-3 select-none">
            <Highlighter size={32} className="opacity-20" />
            <p>暂无符合条件的划线记录</p>
            <span className="text-[11px] text-textMuted/60">
              在任一文章正文中选中文本，即可即席高亮、记录想法或调用 AI 深度解析
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 max-w-4xl mx-auto">
            {filteredHighlights.map((h) => {
              const colorConfig = COLOR_MAP[h.color as keyof typeof COLOR_MAP] || COLOR_MAP.yellow;
              const isEditing = editingId === h.id;

              return (
                <div
                  key={h.id}
                  className="p-4 rounded-2xl bg-surface/70 border border-surfaceBorder hover:border-surfaceBorder/90 transition-all space-y-3 group shadow-xs"
                >
                  {/* Card Header: Article Title & Color Tag & Actions */}
                  <div className="flex items-center justify-between gap-2 border-b border-surfaceBorder/40 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorConfig.dot}`} />
                      <span
                        onClick={() => onSelectArticleById && onSelectArticleById(h.article_id)}
                        className="font-semibold text-textPrimary text-xs truncate hover:text-accent cursor-pointer flex items-center gap-1"
                        title={h.article_title || '进入文章'}
                      >
                        《{h.article_title || '未知文章'}》
                        <ExternalLink size={11} className="opacity-60" />
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-textMuted/60 font-mono hidden sm:inline">
                        {h.created_at.replace('T', ' ').slice(0, 16)}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopyQuote(h)}
                          className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
                          title="复制 Markdown 引用"
                        >
                          {copiedId === h.id ? <Check size={13} className="text-accentGreen" /> : <Copy size={13} />}
                        </button>

                        <button
                          onClick={() => {
                            setEditingId(h.id);
                            setEditNote(h.note || '');
                          }}
                          className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
                          title="编辑批注"
                        >
                          <Edit3 size={13} />
                        </button>

                        <button
                          onClick={() => handleDelete(h.id)}
                          className="p-1 rounded text-textMuted hover:text-accentRed hover:bg-accentRed/10 transition-colors"
                          title="删除记录"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Highlighted Quote Text */}
                  <blockquote className={`text-xs italic leading-relaxed border-l-2 pl-3.5 py-1 rounded-r ${colorConfig.bg}`}>
                    “{h.text}”
                  </blockquote>

                  {/* Attached Note */}
                  {isEditing ? (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(h.id)}
                        placeholder="编辑你的见解或反思..."
                        className="flex-1 bg-surfaceRaised border border-surfaceBorder rounded-lg px-2.5 py-1 text-xs text-textPrimary focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={() => handleUpdate(h.id)}
                        className="px-3 py-1 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1 rounded-lg border border-surfaceBorder text-textMuted hover:text-textPrimary text-xs"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    h.note && (
                      <div className="text-xs text-textPrimary/90 bg-surfaceRaised/40 p-2.5 rounded-xl border border-surfaceBorder/60 flex items-start gap-2">
                        <span className="font-semibold text-accent text-[11px] shrink-0">我的思考:</span>
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
    </div>
  );
};
