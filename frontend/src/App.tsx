import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { ArticleList } from './components/ArticleList';
import { ReaderView } from './components/ReaderView';
import { MorningBriefModal } from './components/MorningBriefModal';
import { SettingsModal } from './components/SettingsModal';
import { LoginScreen } from './components/LoginScreen';
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
} from './api';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('reader_theme') as ThemeMode) || 'dark';
  });

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
  const [filterTier, setFilterTier] = useState<string>('normal'); // 'normal' | 'featured' | 'hidden'
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isBriefModalOpen, setIsBriefModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isLoadingFullText, setIsLoadingFullText] = useState<boolean>(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(false);

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

  // Load Reader Data
  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await listReader({
        group_name: currentGroup,
        source_id: currentSourceId || undefined,
        view: currentView,
        search: searchQuery || undefined,
      });
      setArticles(data.articles);
      setSources(data.sources);
      if (data.preferences) setPreferences(data.preferences);

      // Select first article if none selected
      if (data.articles.length > 0 && !selectedArticleId) {
        setSelectedArticleId(data.articles[0].id);
      }
    } catch (e) {
      console.error('Failed to load reader data:', e);
    }
  }, [isAuthenticated, currentGroup, currentSourceId, currentView, searchQuery, selectedArticleId]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  // Selected Article Object
  const selectedArticle = useMemo(() => {
    return articles.find(a => a.id === selectedArticleId) || null;
  }, [articles, selectedArticleId]);

  // Handle Mark Read on selection
  const handleSelectArticle = useCallback(async (article: Article) => {
    setSelectedArticleId(article.id);
    if (!article.is_read) {
      // Optimistic update
      setArticles(prev => prev.map(a => a.id === article.id ? { ...a, is_read: true } : a));
      try {
        await setArticleRead(article.id, true);
        // Update local source unread count
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
      setTimeout(loadData, 2000); // Poll after 2s
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

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        // Next article
        e.preventDefault();
        const currentIndex = articles.findIndex(a => a.id === selectedArticleId);
        if (currentIndex < articles.length - 1) {
          handleSelectArticle(articles[currentIndex + 1]);
        }
      } else if (e.key === 'k' || e.key === 'K') {
        // Previous article
        e.preventDefault();
        const currentIndex = articles.findIndex(a => a.id === selectedArticleId);
        if (currentIndex > 0) {
          handleSelectArticle(articles[currentIndex - 1]);
        }
      } else if (e.key === 's' || e.key === 'S') {
        // Star article
        if (selectedArticleId) {
          e.preventDefault();
          handleToggleStar(selectedArticleId);
        }
      } else if (e.key === 'm' || e.key === 'M') {
        // Toggle read
        if (selectedArticle) {
          e.preventDefault();
          const nextState = !selectedArticle.is_read;
          setArticles(prev => prev.map(a => a.id === selectedArticle.id ? { ...a, is_read: nextState } : a));
          setArticleRead(selectedArticle.id, nextState);
        }
      } else if (e.key === 'o' || e.key === 'O') {
        // Open original URL in new tab
        if (selectedArticle?.url) {
          e.preventDefault();
          window.open(selectedArticle.url, '_blank', 'noopener,noreferrer');
        }
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
      {/* 1. Left Sidebar */}
      <Sidebar
        sources={sources}
        currentGroup={currentGroup}
        currentSourceId={currentSourceId}
        currentView={currentView}
        currentTheme={theme}
        onSelectGroup={(g) => { setCurrentGroup(g); setCurrentSourceId(''); }}
        onSelectSource={(s) => setCurrentSourceId(s)}
        onSelectView={(v) => setCurrentView(v)}
        onSelectTheme={setTheme}
        onRefresh={handleRefresh}
        onOpenBrief={() => setIsBriefModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onMarkAllRead={handleMarkAllRead}
        isRefreshing={isRefreshing}
        totalUnread={totalUnread}
      />

      {/* 2. Middle Article List Column */}
      <ArticleList
        articles={articles}
        selectedArticleId={selectedArticleId}
        onSelectArticle={handleSelectArticle}
        onToggleStar={handleToggleStar}
        onFeedback={handleFeedback}
        onMarkAllRead={handleMarkAllRead}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        currentView={currentView}
        filterTier={filterTier}
        onFilterTierChange={setFilterTier}
      />

      {/* 3. Right Immersive Reading Panel */}
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
      />

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
      />
    </div>
  );
};
