import React from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Star, ThumbsUp, ThumbsDown, MessageSquare, Flame, Layers } from 'lucide-react';
import { Article } from '../types';

interface ArticleCardProps {
  article: Article;
  isSelected: boolean;
  onSelect: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
  onFeedback: (e: React.MouseEvent, type: 'like' | 'dislike') => void;
  isDebuzz?: boolean;
  relatedArticles?: Article[];
  onSelectRelated?: (article: Article) => void;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  isSelected,
  onSelect,
  onToggleStar,
  onFeedback,
  isDebuzz = true,
  relatedArticles,
  onSelectRelated,
}) => {
  const timeAgo = React.useMemo(() => {
    try {
      return formatDistanceToNow(parseISO(article.published_at), { addSuffix: true, locale: zhCN });
    } catch {
      return '';
    }
  }, [article.published_at]);

  // Extract first sentence or takeaway from summary
  const summarySnippet = React.useMemo(() => {
    if (!article.summary) return '';
    // Look for 一句话速览 if present
    if (article.summary.includes('一句话速览')) {
      const match = article.summary.match(/一句话速览[：:]\s*([^\n]+)/);
      if (match) return match[1].replace(/[*_]/g, '').trim();
    }
    return article.summary.replace(/[*_#]/g, '').slice(0, 85).trim() + '...';
  }, [article.summary]);

  const topSignal = React.useMemo(() => {
    if (!article.triage_signals || article.triage_signals.length === 0) return null;
    return article.triage_signals[0];
  }, [article.triage_signals]);

  const isTitleDebuzzed = isDebuzz && article.clean_title && article.clean_title !== article.title;
  const displayTitle = isTitleDebuzzed ? article.clean_title : article.title;

  return (
    <div
      id={`article-card-${article.id}`}
      onClick={onSelect}
      className={`group p-3.5 border-b border-surfaceBorder cursor-pointer transition-all relative select-none ${
        isSelected
          ? 'bg-surfaceRaised border-l-2 border-l-accent'
          : article.is_read
          ? 'bg-background/40 hover:bg-surface/60 opacity-80'
          : 'bg-background hover:bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Unread indicator */}
          {!article.is_read && (
            <span className="w-2 h-2 rounded-full bg-accent shrink-0 animate-pulse mr-0.5" />
          )}

          {/* Value Tier Badge */}
          {article.value_tier === 'featured' ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded font-medium bg-featuredBadge/20 text-featuredBadge border border-featuredBadge/30">
              <Flame size={10} />
              精选 {Math.round(article.rank_score * 100)}
            </span>
          ) : article.value_tier === 'hidden' ? (
            <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-surfaceRaised text-textMuted/60 border border-surfaceBorder">
              已折叠
            </span>
          ) : null}

          {/* Top Triage Signal Tag */}
          {topSignal && article.value_tier !== 'hidden' && (
            <span className={`text-[9px] px-1.5 py-0.2 rounded font-medium truncate max-w-[90px] ${
              topSignal.effect > 0
                ? 'bg-accentGreen/10 text-accentGreen border border-accentGreen/20'
                : 'bg-surfaceRaised text-textMuted border border-surfaceBorder'
            }`} title={topSignal.evidence}>
              {topSignal.label}
            </span>
          )}

          <span className="text-[11px] font-medium text-textMuted hover:text-textPrimary">
            {article.source_title}
          </span>
          <span className="text-[10px] text-textMuted/70 font-mono">• {timeAgo}</span>
        </div>

        {/* Actions (Star / Discussions) */}
        <div className="flex items-center gap-1 shrink-0">
          {article.discussion_posts && article.discussion_posts.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-textMuted bg-surfaceRaised px-1.5 py-0.5 rounded">
              <MessageSquare size={11} />
              {article.discussion_posts.length}
            </span>
          )}
          <button
            onClick={onToggleStar}
            className={`p-1 rounded hover:bg-surfaceBorder transition-colors ${
              article.is_starred ? 'text-accentGold' : 'text-textMuted/50 hover:text-textMuted'
            }`}
          >
            <Star size={14} fill={article.is_starred ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Article Title */}
      <h3 className={`text-xs font-semibold leading-snug line-clamp-2 mb-1.5 ${
        article.is_read ? 'text-textPrimary/75 font-normal' : 'text-textPrimary'
      }`} title={isTitleDebuzzed ? `媒体原文: ${article.title}` : undefined}>
        {displayTitle}
        {isTitleDebuzzed && (
          <span className="text-[9px] px-1 py-0.2 rounded bg-accent/15 text-accent border border-accent/20 font-normal ml-1 inline-block align-middle">
            客观还原
          </span>
        )}
      </h3>

      {/* AI Summary Snippet */}
      {summarySnippet && (
        <p className="text-[11px] text-textMuted line-clamp-2 leading-relaxed">
          {summarySnippet}
        </p>
      )}

      {/* Bottom meta tag bar */}
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-textMuted/80 pt-1">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-surfaceRaised/80 font-mono text-textMuted">
            {article.group_name}
          </span>
          {article.triage_reason && (
            <span className="truncate max-w-[140px] text-textMuted/70 italic">
              {article.triage_reason}
            </span>
          )}
        </div>

        {/* Feedback Buttons */}
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => onFeedback(e, 'like')}
            className={`p-0.5 rounded hover:text-accentGreen ${
              article.feedback === 'like' ? 'text-accentGreen' : 'text-textMuted/50'
            }`}
            title="赞"
          >
            <ThumbsUp size={12} fill={article.feedback === 'like' ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={(e) => onFeedback(e, 'dislike')}
            className={`p-0.5 rounded hover:text-accentRed ${
              article.feedback === 'dislike' ? 'text-accentRed' : 'text-textMuted/50'
            }`}
            title="踩"
          >
            <ThumbsDown size={12} fill={article.feedback === 'dislike' ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Story Cluster sub-list */}
      {relatedArticles && relatedArticles.length > 0 && (
        <div 
          className="mt-2 pt-2 border-t border-surfaceBorder/50 space-y-1.5" 
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[10px] text-textMuted">
            <span className="font-semibold text-accent flex items-center gap-1">
              <Layers size={11} />
              多源同题报道 ({relatedArticles.length}篇):
            </span>
          </div>
          <div className="space-y-1">
            {relatedArticles.map((rel) => (
              <div
                key={rel.id}
                onClick={() => onSelectRelated && onSelectRelated(rel)}
                className="flex items-center justify-between p-1 px-1.5 rounded bg-surfaceRaised/60 hover:bg-surfaceRaised text-[10px] cursor-pointer text-textMuted hover:text-textPrimary transition-colors"
              >
                <span className="truncate max-w-[200px]">{rel.title}</span>
                <span className="shrink-0 text-textMuted/60 font-mono">[{rel.source_title}]</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
