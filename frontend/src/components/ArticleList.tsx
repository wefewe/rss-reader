import React, { useEffect, useMemo } from 'react';
import { Search, SlidersHorizontal, CheckCheck, ArrowLeft } from 'lucide-react';
import { Article, ViewType } from '../types';
import { ArticleCard } from './ArticleCard';

interface ArticleListProps {
  articles: Article[];
  selectedArticleId: string | null;
  onSelectArticle: (article: Article) => void;
  onToggleStar: (articleId: string) => void;
  onFeedback: (articleId: string, feedback: 'like' | 'dislike') => void;
  onMarkAllRead: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentView: ViewType;
  filterTier: string;
  onFilterTierChange: (tier: string) => void;
  onBackToSidebar?: () => void;
}

export const ArticleList: React.FC<ArticleListProps> = ({
  articles,
  selectedArticleId,
  onSelectArticle,
  onToggleStar,
  onFeedback,
  onMarkAllRead,
  searchQuery,
  onSearchChange,
  filterTier,
  onFilterTierChange,
  onBackToSidebar,
}) => {
  // Filter by value tier (featured / all / hidden)
  const filteredArticles = useMemo(() => {
    return articles.filter(a => {
      if (filterTier === 'featured') return a.value_tier === 'featured';
      if (filterTier === 'normal') return a.value_tier !== 'hidden';
      if (filterTier === 'hidden') return a.value_tier === 'hidden';
      return a.value_tier !== 'hidden'; // Default: hide hidden low-value items unless explicitly selected
    });
  }, [articles, filterTier]);

  // Keyboard J/K and navigation auto-scroll to keep active card in viewport
  useEffect(() => {
    if (selectedArticleId) {
      const el = document.getElementById(`article-card-${selectedArticleId}`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedArticleId]);

  return (
    <div className="w-full md:w-[360px] lg:w-[380px] bg-background border-r border-surfaceBorder flex flex-col h-screen shrink-0">
      {/* Search & Batch Actions Header */}
      <div className="p-3 border-b border-surfaceBorder space-y-2 bg-surface/30">
        <div className="flex items-center gap-2">
          {onBackToSidebar && (
            <button
              onClick={onBackToSidebar}
              className="md:hidden p-1.5 rounded-lg text-textMuted hover:text-textPrimary bg-surfaceRaised transition-colors"
              title="返回订阅分类"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={14} />
            <input
              id="article-search-input"
              type="text"
              placeholder="搜索标题或按 / 聚焦..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-surface border border-surfaceBorder rounded-lg pl-8 pr-3 py-1.5 text-xs text-textPrimary placeholder:text-textMuted/60 focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Tier switcher pills */}
        <div className="flex items-center justify-between text-[11px] pt-0.5">
          <div className="flex items-center gap-1 bg-surface p-0.5 rounded-lg border border-surfaceBorder">
            <button
              onClick={() => onFilterTierChange('normal')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'normal' ? 'bg-surfaceRaised text-textPrimary' : 'text-textMuted hover:text-textPrimary'
              }`}
            >
              推荐
            </button>
            <button
              onClick={() => onFilterTierChange('featured')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'featured' ? 'bg-featuredBadge/20 text-featuredBadge' : 'text-textMuted hover:text-textPrimary'
              }`}
            >
              精选
            </button>
            <button
              onClick={() => onFilterTierChange('hidden')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'hidden' ? 'bg-surfaceRaised text-textMuted' : 'text-textMuted/60 hover:text-textMuted'
              }`}
            >
              低价值折叠
            </button>
          </div>

          <button
            onClick={onMarkAllRead}
            title="全部标为已读"
            className="flex items-center gap-1 text-textMuted hover:text-accent transition-colors px-1.5 py-0.5 rounded hover:bg-surfaceRaised"
          >
            <CheckCheck size={13} />
            <span>已读全部</span>
          </button>
        </div>
      </div>

      {/* Article List Scroll View */}
      <div className="flex-1 overflow-y-auto divide-y divide-surfaceBorder/60">
        {filteredArticles.length === 0 ? (
          <div className="p-8 text-center text-textMuted text-xs flex flex-col items-center justify-center gap-2 h-64">
            <SlidersHorizontal size={24} className="opacity-30" />
            <p>暂无符合当前筛选条件的文章</p>
          </div>
        ) : (
          filteredArticles.map(article => (
            <ArticleCard
              key={article.id}
              article={article}
              isSelected={selectedArticleId === article.id}
              onSelect={() => onSelectArticle(article)}
              onToggleStar={(e) => {
                e.stopPropagation();
                onToggleStar(article.id);
              }}
              onFeedback={(e, type) => {
                e.stopPropagation();
                onFeedback(article.id, type);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};
