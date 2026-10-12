import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  Info,
  ArrowLeft,
  Maximize2,
  Minimize2,
  Type,
  Copy,
  Check,
  X,
  BookOpen,
  Send
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Article } from '../types';
import { DiscussionPosts } from './DiscussionPosts';
import { ArticleAiAssistant } from './ArticleAiAssistant';
import { TriageRadarBox } from './TriageRadarBox';
import { HighlightSection } from './HighlightSection';
import { forwardTelegram } from '../api';

interface ReaderViewProps {
  article: Article | null;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onFeedback: (type: 'like' | 'dislike') => void;
  onFetchFullText: () => void;
  onSummarize: () => void;
  isLoadingFullText: boolean;
  isLoadingSummary: boolean;
  onBackToList?: () => void;
  isZenMode: boolean;
  onToggleZenMode: () => void;
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
  onBackToList,
  isZenMode,
  onToggleZenMode,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollPercent, setScrollPercent] = useState<number>(0);
  const [activeLightboxImg, setActiveLightboxImg] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isTypographyOpen, setIsTypographyOpen] = useState<boolean>(false);
  const [isSendingTg, setIsSendingTg] = useState<boolean>(false);
  const [tgSentSuccess, setTgSentSuccess] = useState<boolean>(false);

  // Typography settings with localStorage persistence
  const [fontSize, setFontSize] = useState<number>(() => {
    return Number(localStorage.getItem('reader_fontsize')) || 16;
  });
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>(() => {
    return (localStorage.getItem('reader_fontfamily') as 'sans' | 'serif') || 'sans';
  });
  const [lineHeight, setLineHeight] = useState<'normal' | 'relaxed'>(() => {
    return (localStorage.getItem('reader_lineheight') as 'normal' | 'relaxed') || 'normal';
  });

  useEffect(() => {
    localStorage.setItem('reader_fontsize', String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('reader_fontfamily', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem('reader_lineheight', lineHeight);
  }, [lineHeight]);

  // Reset scroll on article change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      setScrollPercent(0);
    }
  }, [article?.id]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight <= clientHeight) {
      setScrollPercent(100);
      return;
    }
    const percent = Math.min(100, Math.max(0, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)));
    setScrollPercent(percent);
  };

  const wordStats = useMemo(() => {
    if (!article) return { chars: 0, minutes: 1 };
    const raw = (article.content || article.summary || article.title || '').trim();
    const chars = raw.length;
    const minutes = Math.max(1, Math.ceil(chars / 380));
    return { chars, minutes };
  }, [article]);

  const handleCopyMarkdown = () => {
    if (!article) return;
    const md = `# ${article.title}\n\n- **来源**：${article.source_title} (${article.group_name})\n- **发布时间**：${article.published_at.slice(0, 16).replace('T', ' ')}\n- **原文链接**：${article.url}\n\n## AI 结构化摘要\n\n${article.summary || '无摘要'}\n\n---\n\n## 正文摘录\n\n${article.content || article.summary || ''}`;
    navigator.clipboard.writeText(md).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const handleForwardTg = async () => {
    if (!article || isSendingTg) return;
    setIsSendingTg(true);
    try {
      await forwardTelegram(article.id);
      setTgSentSuccess(true);
      setTimeout(() => setTgSentSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || '转发至 Telegram 失败');
    } finally {
      setIsSendingTg(false);
    }
  };

  if (!article) {
    return (
      <div className="flex-1 bg-surface/20 flex flex-col items-center justify-center text-textMuted gap-3 select-none">
        <FileText size={48} className="opacity-20" />
        <p className="text-sm">选择左侧列表中的文章即可在此开始阅读</p>
        <span className="text-xs text-textMuted/60 font-mono">
          快捷键提示：J 下一篇 • K 上一篇 • M 标已读 • S 标星 • Z 专注模式
        </span>
      </div>
    );
  }

  return (
    <main className="flex-1 bg-surface/10 flex flex-col h-screen overflow-hidden relative">
      {/* 1. Thin Reading Progress Indicator at top */}
      <div
        className="absolute top-0 left-0 h-[2px] bg-accent transition-all duration-75 z-50 pointer-events-none"
        style={{ width: `${scrollPercent}%` }}
      />

      {/* 2. Top Action Bar */}
      <header className="h-12 border-b border-surfaceBorder px-4 sm:px-6 flex items-center justify-between bg-surface/40 backdrop-blur-sm shrink-0 z-40">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile Back Button */}
          {onBackToList && (
            <button
              onClick={onBackToList}
              className="md:hidden p-1.5 rounded-lg text-textMuted hover:text-textPrimary bg-surfaceRaised/50 transition-colors"
              title="返回文章列表"
            >
              <ArrowLeft size={16} />
            </button>
          )}

          <button
            onClick={onToggleRead}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
              article.is_read
                ? 'text-textMuted hover:text-textPrimary bg-surfaceRaised/50'
                : 'text-accent hover:bg-accent/15 font-medium'
            }`}
          >
            {article.is_read ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            <span className="hidden sm:inline">{article.is_read ? '已读' : '标记已读'}</span>
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
            <span className="hidden sm:inline">{article.is_starred ? '已收藏' : '收藏'}</span>
          </button>

          <div className="h-4 w-px bg-surfaceBorder hidden sm:block" />

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

        {/* Right Tools: Typography Aa, Copy, Zen, Jump Original */}
        <div className="flex items-center gap-2">
          {/* Typography Aa Control Button */}
          <div className="relative">
            <button
              onClick={() => setIsTypographyOpen(!isTypographyOpen)}
              className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors ${
                isTypographyOpen ? 'bg-surfaceRaised text-accent' : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
              }`}
              title="排版与字体调节"
            >
              <Type size={15} />
            </button>

            {/* Typography Dropdown Popover */}
            {isTypographyOpen && (
              <div 
                className="absolute right-0 top-full mt-2 w-64 p-3.5 rounded-xl bg-surface border border-surfaceBorder shadow-2xl z-50 space-y-3 text-xs select-none"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-surfaceBorder/60 pb-2">
                  <span className="font-semibold text-textPrimary">阅读排版调节</span>
                  <button onClick={() => setIsTypographyOpen(false)} className="text-textMuted hover:text-textPrimary">
                    <X size={14} />
                  </button>
                </div>

                {/* Font Size */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-textMuted">字号大小</span>
                  <div className="flex items-center justify-between bg-surfaceRaised p-1 rounded-lg border border-surfaceBorder">
                    {[14, 16, 18, 20].map(size => (
                      <button
                        key={size}
                        onClick={() => setFontSize(size)}
                        className={`flex-1 py-1 rounded text-xs font-mono font-medium transition-colors ${
                          fontSize === size ? 'bg-accent text-white shadow-xs' : 'text-textMuted hover:text-textPrimary'
                        }`}
                      >
                        {size}px
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Family */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-textMuted">字体风格</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setFontFamily('sans')}
                      className={`flex-1 py-1 px-2 rounded-lg border text-xs font-medium transition-colors ${
                        fontFamily === 'sans' ? 'border-accent bg-accent/10 text-accent font-semibold' : 'border-surfaceBorder text-textMuted hover:text-textPrimary'
                      }`}
                    >
                      系统黑体 (Sans)
                    </button>
                    <button
                      onClick={() => setFontFamily('serif')}
                      className={`flex-1 py-1 px-2 rounded-lg border text-xs font-medium font-reader-serif transition-colors ${
                        fontFamily === 'serif' ? 'border-accent bg-accent/10 text-accent font-semibold' : 'border-surfaceBorder text-textMuted hover:text-textPrimary'
                      }`}
                    >
                      思源宋体 (Serif)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Copy Markdown Summary */}
          <button
            onClick={handleCopyMarkdown}
            className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
            title={isCopied ? "已复制到剪贴板！" : "复制 Markdown 笔记"}
          >
            {isCopied ? <Check size={15} className="text-accentGreen" /> : <Copy size={15} />}
          </button>

          {/* Forward to Telegram Favorites */}
          <button
            onClick={handleForwardTg}
            disabled={isSendingTg}
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 ${
              tgSentSuccess 
                ? 'bg-accentGreen/15 text-accentGreen' 
                : 'text-textMuted hover:text-accent hover:bg-surfaceRaised'
            }`}
            title={tgSentSuccess ? "已推送至 Telegram 收藏夹！" : "一键推送至 Telegram 收藏夹"}
          >
            {isSendingTg ? (
              <RefreshCw size={15} className="animate-spin text-accent" />
            ) : tgSentSuccess ? (
              <Check size={15} className="text-accentGreen" />
            ) : (
              <Send size={15} />
            )}
          </button>

          {/* Zen Focus Mode Toggle */}
          <button
            onClick={onToggleZenMode}
            className={`p-1.5 rounded-lg transition-colors hidden lg:flex ${
              isZenMode ? 'bg-accent/15 text-accent' : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
            }`}
            title={isZenMode ? "退出专注模式 (Z)" : "开启专注模式 (Z)"}
          >
            {isZenMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          {/* Fetch Fulltext */}
          {!article.content && (
            <button
              onClick={onFetchFullText}
              disabled={isLoadingFullText}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-surfaceRaised hover:bg-surfaceBorder text-textPrimary transition-colors"
            >
              <RefreshCw size={13} className={isLoadingFullText ? 'animate-spin text-accent' : ''} />
              <span className="hidden sm:inline">抓取全文</span>
            </button>
          )}

          {/* Jump to Original */}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-medium"
          >
            <span>原文</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </header>

      {/* 3. Reader Body Scroll Area */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-10 py-8"
      >
        <div className={`mx-auto space-y-6 transition-all duration-200 ${
          isZenMode ? 'max-w-2xl' : 'max-w-3xl'
        }`}>
          {/* Article Header & Meta */}
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

            <h1 className={`font-bold text-textPrimary tracking-tight leading-snug ${
              fontFamily === 'serif' ? 'font-reader-serif' : 'font-reader-sans'
            }`} style={{ fontSize: `${fontSize + 8}px` }}>
              {article.title}
            </h1>

            {/* Reading Estimate Indicator */}
            <div className="flex items-center gap-3 text-[11px] text-textMuted/70 font-mono pt-1">
              <span>约 {wordStats.chars.toLocaleString()} 字</span>
              <span>•</span>
              <span>预估阅读 {wordStats.minutes} 分钟</span>
              <span>•</span>
              <span>已读 {scrollPercent}%</span>
            </div>
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
            <div className={`text-textPrimary/90 leading-relaxed prose max-w-none ${
              fontFamily === 'serif' ? 'font-reader-serif' : 'font-reader-sans'
            }`} style={{ fontSize: `${fontSize - 1}px` }}>
              {article.summary ? (
                <ReactMarkdown>{article.summary}</ReactMarkdown>
              ) : (
                <p className="text-textMuted italic">暂无摘要，点击右上角生成。</p>
              )}
            </div>

            {/* AI Triage Radar Box */}
            <TriageRadarBox article={article} />
          </div>

          {/* AI Conversational Assistant & Action Item Extraction */}
          <ArticleAiAssistant 
            article={article} 
            fontFamily={fontFamily} 
            fontSize={fontSize} 
          />

          {/* Lead Image with Lightbox click */}
          {article.image_url && (
            <div 
              onClick={() => setActiveLightboxImg(article.image_url || null)}
              className="rounded-xl overflow-hidden border border-surfaceBorder max-h-[420px] bg-surface flex items-center justify-center cursor-zoom-in group relative"
            >
              <img
                src={article.image_url}
                alt={article.image_alt || article.title}
                className="w-full h-auto object-cover max-h-[420px] group-hover:scale-[1.01] transition-transform duration-200"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                点击放大图片
              </span>
            </div>
          )}

          {/* Main Article Content with custom typography styles */}
          <article 
            className={`pt-2 text-textPrimary/90 space-y-4 ${
              fontFamily === 'serif' ? 'font-reader-serif' : 'font-reader-sans'
            }`}
            style={{ 
              fontSize: `${fontSize}px`, 
              lineHeight: lineHeight === 'relaxed' ? 2.0 : 1.75 
            }}
          >
            {article.content ? (
              <div className="prose max-w-none break-words leading-relaxed space-y-4">
                <ReactMarkdown
                  components={{
                    img: ({ src, alt }) => (
                      <img
                        src={src}
                        alt={alt}
                        onClick={() => src && setActiveLightboxImg(src)}
                        className="cursor-zoom-in rounded-xl max-w-full my-4 border border-surfaceBorder hover:opacity-95 transition-opacity"
                        loading="lazy"
                      />
                    ),
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    )
                  }}
                >
                  {article.content}
                </ReactMarkdown>
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

          {/* Highlights & Inline Annotations Section */}
          <HighlightSection article={article} containerRef={scrollContainerRef} />

          {/* Discussion Posts (LINUX DO Floors) */}
          {article.discussion_posts && article.discussion_posts.length > 0 && (
            <DiscussionPosts posts={article.discussion_posts} />
          )}
        </div>
      </div>

      {/* 4. Fullscreen Image Lightbox Modal */}
      {activeLightboxImg && (
        <div 
          onClick={() => setActiveLightboxImg(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-150"
        >
          <img
            src={activeLightboxImg}
            alt="放大预览"
            className="max-w-full max-h-[92vh] object-contain rounded-xl shadow-2xl"
          />
          <button
            onClick={() => setActiveLightboxImg(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-surfaceRaised/80 text-white hover:bg-surfaceRaised"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </main>
  );
};
