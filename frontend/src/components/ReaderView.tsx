import React from 'react';
import { 
  ExternalLink, 
  Sparkles, 
  FileText, 
  Star, 
  Clock, 
  Flame, 
  RefreshCw, 
  CheckCircle2, 
  Circle,
  ThumbsUp,
  ThumbsDown,
  Info
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Article } from '../types';
import { DiscussionPosts } from './DiscussionPosts';

interface ReaderViewProps {
  article: Article | null;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onFeedback: (type: 'like' | 'dislike') => void;
  onFetchFullText: () => void;
  onSummarize: () => void;
  isLoadingFullText: boolean;
  isLoadingSummary: boolean;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  article,
  onToggleRead,
  onToggleStar,
  onFeedback,
  onFetchFullText,
  onSummarize,
  isLoadingFullText,
  isLoadingSummary,
}) => {
  if (!article) {
    return (
      <div className="flex-1 bg-surface/20 flex flex-col items-center justify-center text-textMuted gap-3 select-none">
        <FileText size={48} className="opacity-20" />
        <p className="text-sm">选择左侧列表中的文章即可在此开始阅读</p>
        <span className="text-xs text-textMuted/60 font-mono">
          快捷键提示：J 下一篇 • K 上一篇 • M 标已读 • S 标星
        </span>
      </div>
    );
  }

  return (
    <main className="flex-1 bg-surface/10 flex flex-col h-screen overflow-hidden">
      {/* Top Floating Action Bar */}
      <header className="h-12 border-b border-surfaceBorder px-6 flex items-center justify-between bg-surface/40 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleRead}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
              article.is_read
                ? 'text-textMuted hover:text-textPrimary bg-surfaceRaised/50'
                : 'text-accent hover:bg-accent/15 font-medium'
            }`}
          >
            {article.is_read ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            <span>{article.is_read ? '已读' : '标记已读'}</span>
          </button>

          <button
            onClick={onToggleStar}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
              article.is_starred
                ? 'text-accentGold bg-accentGold/10 font-medium'
                : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
            }`}
          >
            <Star size={15} fill={article.is_starred ? 'currentColor' : 'none'} />
            <span>{article.is_starred ? '已收藏' : '收藏'}</span>
          </button>

          <div className="h-4 w-px bg-surfaceBorder" />

          {/* Feedback */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onFeedback('like')}
              className={`p-1 rounded hover:bg-surfaceRaised ${
                article.feedback === 'like' ? 'text-accentGreen' : 'text-textMuted hover:text-textPrimary'
              }`}
              title="赞"
            >
              <ThumbsUp size={15} fill={article.feedback === 'like' ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => onFeedback('dislike')}
              className={`p-1 rounded hover:bg-surfaceRaised ${
                article.feedback === 'dislike' ? 'text-accentRed' : 'text-textMuted hover:text-textPrimary'
              }`}
              title="踩"
            >
              <ThumbsDown size={15} fill={article.feedback === 'dislike' ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>

        {/* Right tools: Fetch fulltext & Jump Original */}
        <div className="flex items-center gap-2">
          {!article.content && (
            <button
              onClick={onFetchFullText}
              disabled={isLoadingFullText}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-surfaceRaised hover:bg-surfaceBorder text-textPrimary transition-colors"
            >
              <RefreshCw size={13} className={isLoadingFullText ? 'animate-spin text-accent' : ''} />
              <span>抓取全文</span>
            </button>
          )}

          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-medium"
          >
            <span>跳原文</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </header>

      {/* Reader Body Scroll Area */}
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Article Meta Header */}
          <div className="space-y-3 pb-6 border-b border-surfaceBorder">
            <div className="flex items-center gap-2 flex-wrap text-xs text-textMuted">
              <span className="font-semibold text-accent px-2 py-0.5 rounded bg-accent/10">
                {article.source_title}
              </span>
              <span>•</span>
              <span className="text-textMuted font-mono flex items-center gap-1">
                <Clock size={12} />
                {article.published_at.replace('T', ' ').slice(0, 16)}
              </span>
              <span>•</span>
              <span className="text-textMuted">{article.group_name}</span>

              {article.value_tier === 'featured' && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-semibold bg-featuredBadge/20 text-featuredBadge border border-featuredBadge/30">
                  <Flame size={12} />
                  精选指数 {Math.round(article.rank_score * 100)}
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-textPrimary tracking-tight leading-snug">
              {article.title}
            </h1>
          </div>

          {/* AI Structured Summary Box (Prominently Pinned) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-surfaceRaised/60 border border-featuredBadge/20 shadow-sm space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-featuredBadge font-semibold">
                <Sparkles size={16} />
                <span>AI 中文深度摘要与事实提炼</span>
              </div>
              <button
                onClick={onSummarize}
                disabled={isLoadingSummary}
                className="text-textMuted hover:text-textPrimary flex items-center gap-1 text-[11px] transition-colors"
                title="重新生成AI摘要"
              >
                <RefreshCw size={12} className={isLoadingSummary ? 'animate-spin text-accent' : ''} />
                <span>重新生成</span>
              </button>
            </div>

            {/* Markdown rendered summary */}
            <div className="text-xs sm:text-sm text-textPrimary/90 leading-relaxed prose prose-invert prose-sm max-w-none">
              {article.summary ? (
                <ReactMarkdown>{article.summary}</ReactMarkdown>
              ) : (
                <p className="text-textMuted italic">暂无摘要，点击右上角生成。</p>
              )}
            </div>

            {/* Triage Signals Insight Tag cloud if available */}
            {article.triage_signals && article.triage_signals.length > 0 && (
              <div className="pt-2 border-t border-surfaceBorder/60 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-textMuted flex items-center gap-1">
                  <Info size={11} />
                  质量信号:
                </span>
                {article.triage_signals.map((sig, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-surfaceBorder text-textPrimary"
                    title={sig.evidence}
                  >
                    {sig.label} ({sig.effect > 0 ? `+${sig.effect}` : sig.effect})
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Lead Image if present */}
          {article.image_url && (
            <div className="rounded-xl overflow-hidden border border-surfaceBorder max-h-[420px] bg-surface flex items-center justify-center">
              <img
                src={article.image_url}
                alt={article.image_alt || article.title}
                className="w-full h-auto object-cover max-h-[420px]"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
          )}

          {/* Main Article Content */}
          <article className="pt-2 text-sm text-textPrimary/90 leading-relaxed font-normal space-y-4">
            {article.content ? (
              <div className="prose prose-invert prose-base max-w-none break-words leading-relaxed space-y-4">
                <ReactMarkdown>{article.content}</ReactMarkdown>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-surface/40 border border-surfaceBorder text-center space-y-3">
                <p className="text-xs text-textMuted">
                  该订阅源仅提供摘要导读。正文内容可一键抓取或跳转至原网站阅读。
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={onFetchFullText}
                    disabled={isLoadingFullText}
                    className="px-4 py-2 rounded-lg bg-surfaceRaised hover:bg-surfaceBorder text-xs text-textPrimary font-medium transition-colors inline-flex items-center gap-2"
                  >
                    <RefreshCw size={13} className={isLoadingFullText ? 'animate-spin text-accent' : ''} />
                    <span>立即解析提取全文</span>
                  </button>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>跳转原文浏览</span>
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            )}
          </article>

          {/* Discussion Posts (LINUX DO Floors) */}
          {article.discussion_posts && article.discussion_posts.length > 0 && (
            <DiscussionPosts posts={article.discussion_posts} />
          )}
        </div>
      </div>
    </main>
  );
};
