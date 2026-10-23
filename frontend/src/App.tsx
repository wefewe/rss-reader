import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ArticleList } from './components/ArticleList';
import { ReaderView } from './components/ReaderView';
import { MorningBriefModal } from './components/MorningBriefModal';
import { SettingsModal } from './components/SettingsModal';
import { LoginScreen } from './components/LoginScreen';
import { ShortcutHelpModal } from './components/ShortcutHelpModal';
import { HighlightsHubView } from './components/HighlightsHubView';
import { Article, FeedSource, ReaderPreferences, ViewType, ThemeMode } from './types';
import { 
  listReader, 
  getArticle, 
  refreshFeeds, 
  setArticleRead, 
  setArticleStarred, 
  setArticleFeedback, 
  markAllRead,
  fetchArticleFullText,
  summarizeArticle,
  checkAuth,
  deleteSource,
  generateForumDigest,
} from './api';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('reader_theme') as ThemeMode) || 'dark';
  });

  // Responsive mobile navigation view state: 'sidebar' | 'list' | 'reader'
  const [mobileView, setMobileView] = useState<'sidebar' | 'list' | 'reader'>('list');
  // Desktop Zen / Focus mode state
  const [isZenMode, setIsZenMode] = useState<boolean>(false);
  // Keyboard shortcut modal state
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState<boolean>(false);

  const [articles, setArticles] = useState<Article[]>([]);
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [preferences, setPreferences] = useState<ReaderPreferences>({
    feed_view: 'all',
    show_affiliate: false,
    show_big_sales: true,
    show_deal_alerts: true,
    show_sponsored: false,
    pure_rule_mode: false,
    summary_model: 'deepseek-v4.1-flash',
    brief_model: 'gpt-5.6-terra',
  });

  const [currentGroup, setCurrentGroup] = useState<string>('全部');
  const [currentSourceId, setCurrentSourceId] = useState<string>('');
  const [currentView, setCurrentView] = useState<ViewType>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('');
  const [totalArticles, setTotalArticles] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [filterTier, setFilterTier] = useState<string>('normal'); // 'normal' | 'featured' | 'hidden'
  const [tierCounts, setTierCounts] = useState<{ normal: number; featured: number; hidden: number }>({
    normal: 0,
    featured: 0,
    hidden: 0,
  });
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // 300ms debounce on search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isBriefModalOpen, setIsBriefModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isLoadingFullText, setIsLoadingFullText] = useState<boolean>(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(false);
  const [isGeneratingDigest, setIsGeneratingDigest] = useState<boolean>(false);

  // Theme class sync
  useEffect(() => {
    document.documentElement.classList.remove('theme-dark', 'theme-light', 'theme-sepia');
    document.documentElement.classList.add(`theme-${theme}`);
    localStorage.setItem('reader_theme', theme);
  }, [theme]);

  // Check Auth on Mount
  useEffect(() => {
    const runAuthCheck = async () => {
      setIsCheckingAuth(true);
      const res = await checkAuth();
      if (res.auth_required && !res.authed) {
        setIsAuthenticated(false);
      } else {
        setIsAuthenticated(true);
      }
      setIsCheckingAuth(false);
    };

    runAuthCheck();

    const handleUnauthorized = () => {
      setIsAuthenticated(false);
    };

    window.addEventListener('reader_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('reader_unauthorized', handleUnauthorized);
  }, []);

  // Load Reader Data (with AbortController and pagination offset=0)
  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await listReader({
        group_name: currentGroup,
        source_id: currentSourceId || undefined,
        view: currentView,
        search: debouncedSearchQuery || undefined,
        offset: 0,
        limit: 50,
      }, controller.signal);

      setArticles(data.articles);
      setTotalArticles(data.total);
      setSources(data.sources);
      if (data.preferences) setPreferences(data.preferences);
      if (data.tier_counts) {
        setTierCounts(data.tier_counts);
      } else {
        setTierCounts({
          normal: data.articles.filter((a: Article) => a.value_tier !== 'hidden').length,
          featured: data.articles.filter((a: Article) => a.value_tier === 'featured').length,
          hidden: data.articles.filter((a: Article) => a.value_tier === 'hidden').length,
        });
      }

      // Select first article if none selected on desktop
      if (data.articles.length > 0 && !selectedArticleId && window.innerWidth >= 768) {
        setSelectedArticleId(data.articles[0].id);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('Failed to load reader data:', e);
      }
    }
  }, [isAuthenticated, currentGroup, currentSourceId, currentView, debouncedSearchQuery, selectedArticleId]);

  // Load More Articles (incremental pagination)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || articles.length >= totalArticles) return;
    setIsLoadingMore(true);
    try {
      const data = await listReader({
        group_name: currentGroup,
        source_id: currentSourceId || undefined,
        view: currentView,
        search: debouncedSearchQuery || undefined,
        offset: articles.length,
        limit: 50,
      });
      setArticles(prev => {
        const existingIds = new Set(prev.map(a => a.id));
        const incoming = data.articles.filter(a => !existingIds.has(a.id));
        return [...prev, ...incoming];
      });
      setTotalArticles(data.total);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('Failed to load more articles:', e);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, articles.length, totalArticles, currentGroup, currentSourceId, currentView, debouncedSearchQuery]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  // On-demand fetch full article content when an article without content is selected
  useEffect(() => {
    if (!selectedArticleId) return;
    const currentArt = articles.find(a => a.id === selectedArticleId);
    if (currentArt && currentArt.content === undefined) {
      let isCancelled = false;
      getArticle(selectedArticleId).then(fullArt => {
        if (!isCancelled && fullArt) {
          setArticles(prev => prev.map(a => a.id === fullArt.id ? { ...a, ...fullArt } : a));
        }
      }).catch(err => {
        console.error('Failed to fetch full article detail:', err);
      });
      return () => {
        isCancelled = true;
      };
    }
  }, [selectedArticleId, articles]);

  // Selected Article Object
  const selectedArticle = useMemo(() => {
    return articles.find(a => a.id === selectedArticleId) || null;
  }, [articles, selectedArticleId]);

  // Handle Mark Read on selection
  const handleSelectArticle = useCallback(async (article: Article) => {
    setSelectedArticleId(article.id);
    setMobileView('reader'); // Slide into reader on mobile

    if (!article.is_read) {
      setArticles(prev => prev.map(a => a.id === article.id ? { ...a, is_read: true } : a));
      try {
        await setArticleRead(article.id, true);
        setSources(prev => prev.map(s => {
          if (s.id === article.source_id) {
            return { ...s, unread_count: Math.max(0, s.unread_count - 1) };
          }
          return s;
        }));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const handleToggleStar = useCallback(async (articleId: string) => {
    const art = articles.find(a => a.id === articleId);
    if (!art) return;
    const nextState = !art.is_starred;
    setArticles(prev => prev.map(a => a.id === articleId ? { ...a, is_starred: nextState } : a));
    try {
      await setArticleStarred(articleId, nextState);
    } catch (e) {
      console.error(e);
    }
  }, [articles]);

  const handleFeedback = useCallback(async (articleId: string, feedback: 'like' | 'dislike') => {
    const art = articles.find(a => a.id === articleId);
    if (!art) return;
    const nextFeedback = art.feedback === feedback ? null : feedback;
    setArticles(prev => prev.map(a => a.id === articleId ? { ...a, feedback: nextFeedback } : a));
    try {
      await setArticleFeedback(articleId, nextFeedback);
    } catch (e) {
      console.error(e);
    }
  }, [articles]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshFeeds();
      setTimeout(loadData, 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 1500);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead({
        group_name: currentGroup !== '全部' ? currentGroup : undefined,
        source_id: currentSourceId || undefined,
      });
      setArticles(prev => prev.map(a => ({ ...a, is_read: true })));
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleMarkBatchRead = async (articleIds: string[]) => {
    if (!articleIds || articleIds.length === 0) return;
    try {
      await markAllRead({ article_ids: articleIds });
      const idSet = new Set(articleIds);
      setArticles(prev => prev.map(a => idSet.has(a.id) ? { ...a, is_read: true } : a));
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteSource = async (id: string) => {
    try {
      await deleteSource(id);
      loadData();
    } catch (e: any) {
      alert(e.message || '删除订阅源失败');
    }
  };

  const handleSelectFromHighlights = (articleId: string) => {
    setCurrentView('all');
    setSelectedArticleId(articleId);
    setMobileView('reader');
  };

  const handleFetchFullText = async () => {
    if (!selectedArticleId) return;
    setIsLoadingFullText(true);
    try {
      const updated = await fetchArticleFullText(selectedArticleId);
      setArticles(prev => prev.map(a => a.id === updated.id ? updated : a));
    } catch (e: any) {
      alert(e.message || '抓取全文失败');
    } finally {
      setIsLoadingFullText(false);
    }
  };

  const handleSummarize = async () => {
    if (!selectedArticleId) return;
    setIsLoadingSummary(true);
    try {
      const updated = await summarizeArticle(selectedArticleId);
      setArticles(prev => prev.map(a => a.id === updated.id ? updated : a));
    } catch (e: any) {
      alert(e.message || '生成摘要失败');
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const handleGenerateForumDigest = async () => {
    setIsGeneratingDigest(true);
    try {
      const newArticle = await generateForumDigest();
      setArticles(prev => [newArticle, ...prev.filter(a => a.id !== newArticle.id)]);
      setSelectedArticleId(newArticle.id);
      loadData();
    } catch (e: any) {
      alert(e.message || '生成社区内参失败');
    } finally {
      setIsGeneratingDigest(false);
    }
  };

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        const currentIndex = articles.findIndex(a => a.id === selectedArticleId);
        if (currentIndex < articles.length - 1) {
          handleSelectArticle(articles[currentIndex + 1]);
        }
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        const currentIndex = articles.findIndex(a => a.id === selectedArticleId);
        if (currentIndex > 0) {
          handleSelectArticle(articles[currentIndex - 1]);
        }
      } else if (e.key === 's' || e.key === 'S') {
        if (selectedArticleId) {
          e.preventDefault();
          handleToggleStar(selectedArticleId);
        }
      } else if (e.key === 'm' || e.key === 'M') {
        if (selectedArticle) {
          e.preventDefault();
          const nextState = !selectedArticle.is_read;
          setArticles(prev => prev.map(a => a.id === selectedArticle.id ? { ...a, is_read: nextState } : a));
          setArticleRead(selectedArticle.id, nextState);
        }
      } else if (e.key === 'o' || e.key === 'O') {
        if (selectedArticle?.url) {
          e.preventDefault();
          window.open(selectedArticle.url, '_blank', 'noopener,noreferrer');
        }
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        setIsZenMode(prev => !prev);
      } else if (e.key === '?') {
        e.preventDefault();
        setIsShortcutHelpOpen(prev => !prev);
      } else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('article-search-input')?.focus();
      } else if (e.key === 'Escape') {
        setIsShortcutHelpOpen(false);
        setIsZenMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [articles, selectedArticleId, selectedArticle, handleSelectArticle, handleToggleStar]);

  const totalUnread = useMemo(() => {
    return sources.reduce((acc, s) => acc + s.unread_count, 0);
  }, [sources]);

  if (isCheckingAuth) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center text-textMuted text-xs select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="font-mono text-textMuted/70">正在载入数字图书馆...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-textPrimary">
      {/* 1. Left Sidebar (responsive mobile drawer / desktop column) */}
      <div className={`h-full shrink-0 ${
        mobileView === 'sidebar' ? 'w-full block' : 'hidden'
      } md:block ${isZenMode ? 'md:hidden' : ''}`}>
        <Sidebar
          sources={sources}
          currentGroup={currentGroup}
          currentSourceId={currentSourceId}
          currentView={currentView}
          currentTheme={theme}
          onSelectGroup={(g) => { 
            setCurrentGroup(g); 
            setCurrentSourceId(''); 
            setMobileView('list'); 
          }}
          onSelectSource={(s) => { 
            setCurrentSourceId(s); 
            setMobileView('list'); 
          }}
          onSelectView={(v) => { 
            setCurrentView(v); 
            setMobileView('list'); 
          }}
          onSelectTheme={setTheme}
          onRefresh={handleRefresh}
          onOpenBrief={() => setIsBriefModalOpen(true)}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onMarkAllRead={handleMarkAllRead}
          isRefreshing={isRefreshing}
          totalUnread={totalUnread}
        />
      </div>

      {currentView === 'highlights' ? (
        <HighlightsHubView
          articles={articles}
          onSelectArticleById={handleSelectFromHighlights}
        />
      ) : (
        <>
          {/* 2. Middle Article List Column */}
          <div className={`h-full shrink-0 ${
            mobileView === 'list' ? 'w-full block' : 'hidden'
          } md:block ${isZenMode ? 'md:hidden' : ''}`}>
            <ArticleList
              articles={articles}
              selectedArticleId={selectedArticleId}
              onSelectArticle={handleSelectArticle}
              onToggleStar={handleToggleStar}
              onFeedback={handleFeedback}
              onMarkAllRead={handleMarkAllRead}
              onMarkBatchRead={handleMarkBatchRead}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              currentView={currentView}
              filterTier={filterTier}
              onFilterTierChange={setFilterTier}
              tierCounts={tierCounts}
              onBackToSidebar={() => setMobileView('sidebar')}
              totalArticles={totalArticles}
              hasMore={articles.length < totalArticles}
              isLoadingMore={isLoadingMore}
              onLoadMore={handleLoadMore}
            />
          </div>

          {/* 3. Right Immersive Reading Panel */}
          <div className={`h-full flex-1 ${
            mobileView === 'reader' ? 'w-full flex' : 'hidden'
          } md:flex`}>
            <ReaderView
              article={selectedArticle}
              onToggleRead={() => {
                if (selectedArticle) {
                  const next = !selectedArticle.is_read;
                  setArticles(prev => prev.map(a => a.id === selectedArticle.id ? { ...a, is_read: next } : a));
                  setArticleRead(selectedArticle.id, next);
                }
              }}
              onToggleStar={() => selectedArticleId && handleToggleStar(selectedArticleId)}
              onFeedback={(type) => selectedArticleId && handleFeedback(selectedArticleId, type)}
              onFetchFullText={handleFetchFullText}
              onSummarize={handleSummarize}
              isLoadingFullText={isLoadingFullText}
              isLoadingSummary={isLoadingSummary}
              onBackToList={() => setMobileView('list')}
              isZenMode={isZenMode}
              onToggleZenMode={() => setIsZenMode(prev => !prev)}
              onGenerateDigest={handleGenerateForumDigest}
              isGeneratingDigest={isGeneratingDigest}
            />
          </div>
        </>
      )}

      {/* Modals */}
      <MorningBriefModal
        isOpen={isBriefModalOpen}
        onClose={() => setIsBriefModalOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        preferences={preferences}
        onPreferencesUpdated={setPreferences}
        sources={sources}
        onDeleteSource={handleDeleteSource}
      />

      <ShortcutHelpModal
        isOpen={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
      />
    </div>
  );
};
