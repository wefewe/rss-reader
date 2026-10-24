import React, { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, CheckCheck, Check, ArrowLeft, Wand2, Layers, AlertCircle } from 'lucide-react';
import { Article, ViewType } from '../types';
import { ArticleCard } from './ArticleCard';

interface ArticleListProps {
  articles: Article[];
  selectedArticleId: string | null;
  onSelectArticle: (article: Article) => void;
  onToggleStar: (articleId: string) => void;
  onFeedback: (articleId: string, feedback: 'like' | 'dislike') => void;
  onMarkAllRead: () => void;
  onMarkBacklogRead?: () => void;
  onMarkBatchRead?: (articleIds: string[]) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentView: ViewType;
  filterTier: string;
  onFilterTierChange: (tier: string) => void;
  tierCounts?: { normal: number; featured: number; hidden: number; backlog?: number };
  currentSort?: 'rank' | 'time';
  onSortChange?: (sort: 'rank' | 'time') => void;
  onBackToSidebar?: () => void;
  totalArticles?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export const ArticleList: React.FC<ArticleListProps> = ({
  articles,
  selectedArticleId,
  onSelectArticle,
  onToggleStar,
  onFeedback,
  onMarkAllRead,
  onMarkBacklogRead,
  onMarkBatchRead,
  searchQuery,
  onSearchChange,
  filterTier,
  onFilterTierChange,
  tierCounts,
  currentSort = 'rank',
  onSortChange,
  onBackToSidebar,
  totalArticles,
  hasMore,
  isLoadingMore,
  onLoadMore,
}) => {
  const [isDebuzz, setIsDebuzz] = useState<boolean>(() => {
    return localStorage.getItem('reader_debuzz') !== 'false';
  });
  const [isClustered, setIsClustered] = useState<boolean>(() => {
    return localStorage.getItem('reader_cluster') !== 'false';
  });
  const [isBacklogModalOpen, setIsBacklogModalOpen] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem('reader_debuzz', String(isDebuzz));
  }, [isDebuzz]);

  useEffect(() => {
    localStorage.setItem('reader_cluster', String(isClustered));
  }, [isClustered]);

  // Escape key to dismiss backlog confirmation modal
  useEffect(() => {
    if (!isBacklogModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsBacklogModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBacklogModalOpen]);

  // Filter by value tier (featured / all / hidden / backlog)
  const filteredArticles = useMemo(() => {
    return articles.filter(a => {
      if (filterTier === 'featured') return a.value_tier === 'featured';
      if (filterTier === 'normal') return a.value_tier !== 'hidden';
      if (filterTier === 'hidden') return a.value_tier === 'hidden';
      if (filterTier === 'backlog') return true;
      return a.value_tier !== 'hidden'; // Default: hide hidden low-value items unless explicitly selected
    });
  }, [articles, filterTier]);

  // Stop words for story clustering
  const STOP_WORDS = useMemo(() => new Set([
    "的", "了", "在", "是", "被", "和", "与", "为", "对", "以", "等", "及", "已", "将", "也", "有", "上", "中", "下", "把", "到", "自", "从"
  ]), []);

  // 24-hour Story Clustering
  const clusteredItems = useMemo(() => {
    if (!isClustered) {
      return filteredArticles.map(a => ({ primary: a, related: [] as Article[] }));
    }

    const getKeywords = (title: string) => {
      const words = title.toLowerCase().match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]{2,4}/g) || [];
      return new Set(words.filter(w => !STOP_WORDS.has(w) && w.length >= 2));
    };

    const clusters: { primary: Article; related: Article[] }[] = [];
    const groupedIds = new Set<string>();

    for (let i = 0; i < filteredArticles.length; i++) {
      const a = filteredArticles[i];
      if (groupedIds.has(a.id)) continue;

      const kwA = getKeywords(a.clean_title || a.title);
      const related: Article[] = [];

      for (let j = i + 1; j < Math.min(filteredArticles.length, i + 35); j++) {
        const b = filteredArticles[j];
        if (groupedIds.has(b.id)) continue;

        // WO-20261023-09: 排除 linuxdo-digest 源内部互相聚合折叠（每期独立成卡，跨源聚合保持原行为）
        if (a.source_id === 'linuxdo-digest' && b.source_id === 'linuxdo-digest') {
          continue;
        }

        const kwB = getKeywords(b.clean_title || b.title);
        let overlapCount = 0;
        let hasLongTerm = false;

        kwA.forEach(k => {
          if (kwB.has(k)) {
            overlapCount++;
            if (k.length >= 5) hasLongTerm = true;
          }
        });

        if (overlapCount >= 2 || hasLongTerm) {
          related.push(b);
          groupedIds.add(b.id);
        }
      }

      clusters.push({ primary: a, related });
    }

    return clusters;
  }, [filteredArticles, isClustered, STOP_WORDS]);

  // Compute unread articles above current selected article
  const unreadAboveIds = useMemo(() => {
    if (!selectedArticleId) return [];
    const idx = filteredArticles.findIndex(a => a.id === selectedArticleId);
    if (idx <= 0) return [];
    return filteredArticles.slice(0, idx).filter(a => !a.is_read).map(a => a.id);
  }, [filteredArticles, selectedArticleId]);

  // Keyboard J/K and navigation auto-scroll to keep active card in viewport
  useEffect(() => {
    if (selectedArticleId) {
      const el = document.getElementById(`article-card-${selectedArticleId}`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedArticleId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (onLoadMore && hasMore && !isLoadingMore) {
      if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) {
        onLoadMore();
      }
    }
  };

  const handleOpenBacklogConfirm = () => {
    setIsBacklogModalOpen(true);
  };

  const handleExecuteMarkBacklogRead = () => {
    setIsBacklogModalOpen(false);
    if (onMarkBacklogRead) {
      onMarkBacklogRead();
    } else {
      onMarkAllRead();
    }
  };

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
              placeholder="全文、评论或标题搜索 (按 / 聚焦)..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-surface border border-surfaceBorder rounded-lg pl-8 pr-3 py-1.5 text-xs text-textPrimary placeholder:text-textMuted/60 focus:outline-none focus:border-accent"
            />
          </div>

          <button
            onClick={() => setIsDebuzz(!isDebuzz)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors shrink-0 ${
              isDebuzz 
                ? 'border-accent bg-accent/15 text-accent font-medium' 
                : 'border-surfaceBorder bg-surface text-textMuted hover:text-textPrimary'
            }`}
            title={isDebuzz ? "去浮夸已开启：优先呈现客观事实标题" : "去浮夸已关闭：展示媒体原始标题"}
          >
            <Wand2 size={13} />
            <span className="text-[11px] hidden sm:inline">去浮夸</span>
          </button>

          <button
            onClick={() => setIsClustered(!isClustered)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors shrink-0 ${
              isClustered 
                ? 'border-accent bg-accent/15 text-accent font-medium' 
                : 'border-surfaceBorder bg-surface text-textMuted hover:text-textPrimary'
            }`}
            title={isClustered ? "同题聚类已开启：折叠合并24小时内同题多源报道" : "同题聚类已关闭：平铺展示所有报道"}
          >
            <Layers size={13} />
            <span className="text-[11px] hidden sm:inline">聚合</span>
          </button>

          {/* Sort Switcher (rank vs time) */}
          {onSortChange && (
            <div className="flex items-center bg-surface p-0.5 rounded-lg border border-surfaceBorder shrink-0">
              <button
                onClick={() => onSortChange('rank')}
                className={`px-1.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  currentSort === 'rank'
                    ? 'bg-surfaceRaised text-accent font-semibold'
                    : 'text-textMuted hover:text-textPrimary'
                }`}
                title="智能排序：结合 AI 价值、时效衰减与偏好加权"
              >
                智能
              </button>
              <button
                onClick={() => onSortChange('time')}
                className={`px-1.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  currentSort === 'time'
                    ? 'bg-surfaceRaised text-accent font-semibold'
                    : 'text-textMuted hover:text-textPrimary'
                }`}
                title="时间排序：严格按发布时间倒序排列"
              >
                最新
              </button>
            </div>
          )}
        </div>

        {/* Tier switcher pills */}
        <div className="flex items-center justify-between text-[11px] pt-0.5">
          <div className="flex items-center gap-1 bg-surface p-0.5 rounded-lg border border-surfaceBorder">
            <button
              onClick={() => onFilterTierChange('normal')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'normal' ? 'bg-surfaceRaised text-textPrimary' : 'text-textMuted hover:text-textPrimary'
              }`}
              title={isClustered && clusteredItems.length !== filteredArticles.length && tierCounts ? `已聚合为 ${clusteredItems.length} 个报道主题，包含 ${tierCounts.normal} 篇关联文章` : undefined}
            >
              推荐 {tierCounts ? (isClustered && clusteredItems.length !== filteredArticles.length && filterTier === 'normal' ? `(${clusteredItems.length}组 · ${tierCounts.normal}篇)` : `(${tierCounts.normal})`) : ''}
            </button>
            <button
              onClick={() => onFilterTierChange('featured')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'featured' ? 'bg-featuredBadge/20 text-featuredBadge' : 'text-textMuted hover:text-textPrimary'
              }`}
            >
              精选 {tierCounts ? `(${tierCounts.featured})` : ''}
            </button>
            <button
              onClick={() => onFilterTierChange('hidden')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'hidden' ? 'bg-surfaceRaised text-textMuted' : 'text-textMuted/60 hover:text-textMuted'
              }`}
              title={tierCounts && tierCounts.hidden === 0 ? "当前视图无被折叠的低价值内容" : undefined}
            >
              折叠 {tierCounts ? `(${tierCounts.hidden})` : ''}
            </button>
            <button
              onClick={() => onFilterTierChange('backlog')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filterTier === 'backlog' ? 'bg-amber-500/20 text-amber-500 font-semibold' : 'text-textMuted/70 hover:text-textPrimary'
              }`}
              title={tierCounts?.backlog === 0 ? "暂无超过 14 天的积压未读内容" : "点击展开超过 14 天未读的积压内容"}
            >
              积压 {tierCounts && tierCounts.backlog !== undefined ? `(${tierCounts.backlog})` : ''}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {unreadAboveIds.length > 0 && onMarkBatchRead && filterTier !== 'backlog' && (
              <button
                onClick={() => onMarkBatchRead(unreadAboveIds)}
                title={`标记当前文章上方的 ${unreadAboveIds.length} 篇未读为已读`}
                className="flex items-center gap-1 text-accent hover:text-accent/80 transition-colors px-1.5 py-0.5 rounded bg-accent/10 hover:bg-accent/15"
              >
                <Check size={12} />
                <span>已读上方 ({unreadAboveIds.length})</span>
              </button>
            )}

            {filterTier === 'backlog' ? (
              <button
                onClick={handleOpenBacklogConfirm}
                disabled={(tierCounts?.backlog || 0) === 0 && articles.length === 0}
                title="全部积压标为已读（应用内二次确认）"
                className="flex items-center gap-1 text-amber-500 hover:text-amber-400 transition-colors px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 font-medium disabled:opacity-40"
              >
                <CheckCheck size={13} />
                <span>积压标已读</span>
              </button>
            ) : (
              <button
                onClick={onMarkAllRead}
                title="全部标为已读"
                className="flex items-center gap-1 text-textMuted hover:text-accent transition-colors px-1.5 py-0.5 rounded hover:bg-surfaceRaised"
              >
                <CheckCheck size={13} />
                <span>已读全部</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Article List Scroll View */}
      <div 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto divide-y divide-surfaceBorder/60"
      >
        {/* Backlog Banner in backlog view */}
        {filterTier === 'backlog' && (
          <div className="p-3 bg-amber-500/10 border-b border-surfaceBorder/60 flex items-center justify-between gap-2">
            <div className="text-[11px] text-amber-500/90 leading-tight">
              <span className="font-semibold block">未读积压治理</span>
              <span>发布超过 14 天且非精选/未收藏的普通与折叠未读</span>
            </div>
            <button
              onClick={handleOpenBacklogConfirm}
              disabled={(tierCounts?.backlog || 0) === 0 && articles.length === 0}
              className="px-2.5 py-1 text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-md transition-colors shrink-0 flex items-center gap-1 shadow-sm disabled:opacity-40"
              title="一键将所有积压文章标记为已读（只改已读状态，不删文章）"
            >
              <CheckCheck size={13} />
              <span>全部标为已读</span>
            </button>
          </div>
        )}

        {clusteredItems.length === 0 ? (
          <div className="p-8 text-center text-textMuted text-xs flex flex-col items-center justify-center gap-2 h-64">
            <SlidersHorizontal size={24} className="opacity-30" />
            <p>
              {filterTier === 'hidden' 
                ? '暂无被系统折叠的低价值内容（点击上方「推荐」即可切回正常流）' 
                : filterTier === 'backlog'
                ? '太棒了！当前没有超过 14 天的积压未读文章'
                : '暂无符合当前筛选条件的文章'}
            </p>
          </div>
        ) : (
          <>
            {clusteredItems.map(({ primary, related }) => (
              <ArticleCard
                key={primary.id}
                article={primary}
                isSelected={selectedArticleId === primary.id}
                onSelect={() => onSelectArticle(primary)}
                onToggleStar={(e) => {
                  e.stopPropagation();
                  onToggleStar(primary.id);
                }}
                onFeedback={(e, type) => {
                  e.stopPropagation();
                  onFeedback(primary.id, type);
                }}
                isDebuzz={isDebuzz}
                relatedArticles={related}
                onSelectRelated={onSelectArticle}
              />
            ))}

            {/* Pagination / Load More Footer */}
            {hasMore && (
              <div className="p-4 text-center">
                <button
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="w-full py-2 px-3 text-xs text-textMuted hover:text-textPrimary bg-surface hover:bg-surfaceRaised border border-surfaceBorder rounded-lg transition-colors disabled:opacity-50 font-medium"
                >
                  {isLoadingMore ? "正在加载更多文章..." : `加载更多 (已展示 ${articles.length} / 共 ${totalArticles ?? articles.length} 篇)`}
                </button>
              </div>
            )}
            {!hasMore && articles.length > 0 && (
              <div className="p-4 text-center text-[11px] text-textMuted/60 font-mono">
                已加载全部 {articles.length} 篇文章
              </div>
            )}
          </>
        )}
      </div>

      {/* Backlog Mark Read Application Modal */}
      {isBacklogModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => setIsBacklogModalOpen(false)}
        >
          <div 
            className="w-full max-w-sm bg-surface border border-surfaceBorder rounded-2xl shadow-2xl p-5 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-500 shrink-0">
                <AlertCircle size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-textPrimary leading-snug">
                  全部标为已读确认
                </h3>
                <p className="text-xs text-textMuted mt-1 leading-relaxed">
                  将把当前全部 <span className="font-semibold text-amber-500 font-mono">{tierCounts?.backlog ?? articles.length} 篇</span> 积压文章标记为已读。
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-surfaceRaised/70 border border-surfaceBorder/80 text-[11px] text-textMuted leading-relaxed">
              <span className="font-medium text-textPrimary block mb-0.5">安全须知</span>
              此操作<strong className="text-textPrimary font-semibold">只改已读状态，不删文章</strong>。标记后文章将脱离积压列表，但完整保留在数据库中，后续仍可在搜索中随时检索阅读。
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsBacklogModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExecuteMarkBacklogRead}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <CheckCheck size={14} />
                <span>确认全部标为已读</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
