import React from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Star, ThumbsUp, ThumbsDown, MessageSquare, Flame } from 'lucide-react';
import { Article } from '../types';

interface ArticleCardProps {
  article: Article;
  isSelected: boolean;
  onSelect: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
  onFeedback: (e: React.MouseEvent, type: 'like' | 'dislike') => void;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  isSelected,
  onSelect,
  onToggleStar,
  onFeedback,
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

  return (
    <div
      id={`article-card-${article.id}`}
      onClick={onSelect}
      className={`p-3.5 border-b border-surfaceBorder cursor-pointer transition-all relative select-none ${
        isSelected
          ? 'bg-surfaceRaised border-l-2 border-l-accent'
          : article.is_read
          ? 'bg-background/40 hover:bg-surface/60 opacity-80'
          : 'bg-background hover:bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Unread indicator */}
          {!article.is_read && (
            <span className="w-2 h-2 rounded-full bg-accent shrink-0 animate-pulse" />
          )}

          {/* Value Tier Badge */}
          {article.value_tier === 'featured' && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded font-medium bg-featuredBadge/20 text-featuredBadge border border-featuredBadge/30">
              <Flame size={10} />
              精选 {Math.round(article.rank_score * 100)}
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
      }`}>
        {article.title}
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
    </div>
  );
};
