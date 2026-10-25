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
  Send, 
  Languages, 
  Headphones, 
  Volume2, 
  Play, 
  Pause, 
  MessageSquare,
  ArrowUp,
  ListTree,
  ChevronDown,
  ChevronUp,
  Terminal,
  Columns
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Article } from '../types';
import { DiscussionPosts } from './DiscussionPosts';
import { ArticleAiAssistant } from './ArticleAiAssistant';
import { TriageRadarBox } from './TriageRadarBox';
import { HighlightSection } from './HighlightSection';
import { SafeImage } from './SafeImage';
import { forwardTelegram, fetchBilingualTranslate, getAuthToken } from '../api';
import { formatBionicContent } from '../utils/bionic';

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
  onGenerateDigest?: () => Promise<void>;
  isGeneratingDigest?: boolean;
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
  onGenerateDigest,
  isGeneratingDigest,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);
  const typographyRef = useRef<HTMLDivElement>(null);
  const [activeLightboxImg, setActiveLightboxImg] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isTypographyOpen, setIsTypographyOpen] = useState<boolean>(false);
  const [leadImageFailed, setLeadImageFailed] = useState<boolean>(false);
  const [isSendingTg, setIsSendingTg] = useState<boolean>(false);
  const [tgSentSuccess, setTgSentSuccess] = useState<boolean>(false);

  // Typography & Layout settings with localStorage persistence
  const [fontSize, setFontSize] = useState<number>(() => {
    return Number(localStorage.getItem('reader_fontsize')) || 16;
  });
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>(() => {
    return (localStorage.getItem('reader_fontfamily') as 'sans' | 'serif') || 'sans';
  });
  const [lineHeight, setLineHeight] = useState<'tight' | 'normal' | 'relaxed'>(() => {
    const saved = localStorage.getItem('reader_lineheight');
    if (saved === 'tight' || saved === 'normal' || saved === 'relaxed') return saved;
    return 'normal';
  });
  const [contentWidth, setContentWidth] = useState<'compact' | 'standard' | 'wide'>(() => {
    const saved = localStorage.getItem('reader_contentwidth');
    if (saved === 'compact' || saved === 'standard' || saved === 'wide') return saved;
    return 'standard';
  });
  const [isBionicReading, setIsBionicReading] = useState<boolean>(() => {
    return localStorage.getItem('reader_bionic_reading') === 'true';
  });

  // Reading auxiliary features: Back-to-top & TOC
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
  const [isTocOpen, setIsTocOpen] = useState<boolean>(true);

  // Bilingual flow state (Follow 工作流)
  const [isBilingualMode, setIsBilingualMode] = useState<boolean>(false);
  const [isLoadingBilingual, setIsLoadingBilingual] = useState<boolean>(false);
  const [bilingualContent, setBilingualContent] = useState<string | null>(null);

  // Audio Player State (Web Speech API + Edge-TTS 伴读播客)
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [isAudioPlayerOpen, setIsAudioPlayerOpen] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const stopAudio = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlayingAudio(false);
    setIsAudioPlayerOpen(false);
  };

  useEffect(() => {
    stopAudio();
  }, [article?.id]);

  const startAudioPlayback = (rate = speechRate) => {
    if (!article) return;
    setIsAudioPlayerOpen(true);

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const rawText = `${article.clean_title || article.title}。来源：${article.source_title}。${article.summary ? 'AI速览：' + article.summary.replace(/[*_#`>\[\]\(\)]/g, '') : ''}`;
      const utterance = new SpeechSynthesisUtterance(rawText);
      utterance.lang = /[\u4e00-\u9fa5]/.test(rawText) ? 'zh-CN' : 'en-US';
      utterance.rate = rate;
      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);
      window.speechSynthesis.speak(utterance);
      setIsPlayingAudio(true);
    } else if (audioRef.current) {
      audioRef.current.play().catch(() => {});
      setIsPlayingAudio(true);
    }
  };

  const toggleAudioPlayback = () => {
    if (!isAudioPlayerOpen) {
      startAudioPlayback();
      return;
    }
    if ('speechSynthesis' in window) {
      if (isPlayingAudio) {
        window.speechSynthesis.pause();
        setIsPlayingAudio(false);
      } else {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          setIsPlayingAudio(true);
        } else {
          startAudioPlayback();
        }
      }
    } else if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play().catch(() => {});
        setIsPlayingAudio(true);
      }
    }
  };

  useEffect(() => {
    setIsBilingualMode(false);
    setIsLoadingBilingual(false);
    setBilingualContent(article?.bilingual_content || null);
  }, [article?.id]);

  const handleToggleBilingual = async () => {
    if (!article) return;
    if (isBilingualMode) {
      setIsBilingualMode(false);
      return;
    }
    if (bilingualContent || article.bilingual_content) {
      setIsBilingualMode(true);
      return;
    }
    setIsLoadingBilingual(true);
    try {
      const text = await fetchBilingualTranslate(article.id);
      setBilingualContent(text);
      setIsBilingualMode(true);
    } catch (err: any) {
      alert(err.message || '双语对照生成失败');
    } finally {
      setIsLoadingBilingual(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('reader_fontsize', String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('reader_fontfamily', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem('reader_lineheight', lineHeight);
  }, [lineHeight]);

  useEffect(() => {
    localStorage.setItem('reader_contentwidth', contentWidth);
  }, [contentWidth]);

  useEffect(() => {
    localStorage.setItem('reader_bionic_reading', String(isBionicReading));
  }, [isBionicReading]);

  // Click-Outside auto-dismiss for typography popover
  useEffect(() => {
    if (!isTypographyOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (typographyRef.current && e.target instanceof Node && !typographyRef.current.contains(e.target)) {
        setIsTypographyOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isTypographyOpen]);

  // Reset scroll, progress indicators, lightbox, and lead image failed state on article change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    if (progressBarRef.current) {
      progressBarRef.current.style.width = '0%';
    }
    if (progressTextRef.current) {
      progressTextRef.current.textContent = '0%';
    }
    setActiveLightboxImg(null);
    setShowBackToTop(false);
    setLeadImageFailed(false);
  }, [article?.id, article?.image_url]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    let percent = 0;
    if (scrollHeight <= clientHeight) {
      percent = 100;
    } else {
      percent = Math.min(100, Math.max(0, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)));
    }
    if (progressBarRef.current) {
      progressBarRef.current.style.width = `${percent}%`;
    }
    if (progressTextRef.current) {
      progressTextRef.current.textContent = `${percent}%`;
    }
    setShowBackToTop(scrollTop > clientHeight);
  };

  const handleScrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToSection = (keyword: string) => {
    if (!scrollContainerRef.current) return;
    const headings = scrollContainerRef.current.querySelectorAll('h2, h3, h4, span[id]');
    for (const el of Array.from(headings)) {
      if (el.textContent?.includes(keyword) || (el as HTMLElement).id?.includes(keyword)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  };

  const contentWidthClass = useMemo(() => {
    switch (contentWidth) {
      case 'compact':
        return 'w-full max-w-full md:max-w-[620px]';
      case 'wide':
        return 'w-full max-w-full md:max-w-[840px]';
      case 'standard':
      default:
        return 'w-full max-w-full md:max-w-[700px]';
    }
  }, [contentWidth]);

  const getHeadingText = (children: any): string => {
    if (typeof children === 'string') return children;
    if (Array.isArray(children)) {
      return children.map(getHeadingText).join('');
    }
    if (children && typeof children === 'object' && children.props?.children) {
      return getHeadingText(children.props.children);
    }
    return '';
  };

  const slugify = (text: string): string => {
    return 'h-' + text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  };

  // Custom code component for codeblocks and inline code
  const CodeBlockComponent = ({ inline, className, children, ...props }: any) => {
    const [copied, setCopied] = useState(false);
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const rawCode = String(children || '').replace(/\n$/, '');

    const handleCopy = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(rawCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    const isInline = inline || (!language && !rawCode.includes('\n') && rawCode.length < 80);

    if (isInline) {
      return (
        <code 
          className="font-mono text-[0.875em] px-1.5 py-0.5 rounded-md bg-surfaceRaised/80 border border-surfaceBorder/60 text-textPrimary inline-block mx-0.5 select-text" 
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <div className="my-4 rounded-xl border border-surfaceBorder bg-surfaceRaised/60 shadow-2xs overflow-hidden group">
        <div className="flex items-center justify-between px-3 py-1.5 bg-surfaceRaised/90 border-b border-surfaceBorder/60 text-[11px] text-textMuted select-none">
          <div className="flex items-center gap-1.5 font-mono">
            <Terminal size={12} className="text-accent" />
            <span>{language || 'code'}</span>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-surface hover:text-textPrimary transition-colors"
            title="复制代码"
          >
            {copied ? (
              <>
                <Check size={11} className="text-accentGreen" />
                <span className="text-accentGreen font-medium">已复制</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>复制</span>
              </>
            )}
          </button>
        </div>
        <pre 
          className="p-3.5 sm:p-4 overflow-x-auto leading-relaxed font-mono text-textPrimary/95 bg-transparent m-0 select-text"
          style={{ fontSize: `max(12px, ${fontSize - 2}px)` }}
        >
          <code className="bg-transparent p-0 border-0 text-inherit font-inherit">
            {rawCode}
          </code>
        </pre>
      </div>
    );
  };

  // Stable markdown components definition to prevent re-mounting during re-renders
  const markdownComponents = useMemo(() => ({
    p: ({ children }: any) => {
      if (!isBionicReading) return <p className="mb-4">{children}</p>;
      if (typeof children === 'string') {
        return <p className="mb-4">{formatBionicContent(children)}</p>;
      }
      return <p className="mb-4">{children}</p>;
    },
    code: CodeBlockComponent,
    pre: ({ children }: any) => <>{children}</>,
    h2: ({ children, ...props }: any) => {
      const text = getHeadingText(children).trim();
      const id = slugify(text);
      return (
        <h2 id={id} className="text-lg font-bold text-textPrimary mt-7 mb-3 scroll-mt-14" {...props}>
          {children}
        </h2>
      );
    },
    h3: ({ children, ...props }: any) => {
      const text = getHeadingText(children).trim();
      const id = slugify(text);
      return (
        <h3 id={id} className="text-base font-semibold text-textPrimary mt-5 mb-2 scroll-mt-14" {...props}>
          {children}
        </h3>
      );
    },
    img: ({ src, alt }: any) => (
      <SafeImage
        key={src}
        src={src}
        alt={alt}
        className="cursor-zoom-in rounded-xl max-w-full my-4 border border-surfaceBorder hover:opacity-95 transition-opacity"
        onImageClick={(validSrc) => setActiveLightboxImg(validSrc)}
      />
    ),
    a: ({ href, children }: any) => {
      const isForumLink = href && (href.includes('linux.do') || href.includes('/t/topic/'));
      if (isForumLink) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 bg-cyan-950/30 px-2 py-0.5 rounded border border-cyan-500/30 text-xs font-medium transition-colors no-underline hover:border-cyan-400"
          >
            <span>{children}</span>
            <ExternalLink size={11} className="inline ml-0.5 opacity-80" />
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
  }), [isBionicReading, fontSize]);

  const wordStats = useMemo(() => {
    if (!article) return { chars: 0, minutes: 1 };
    const raw = (article.content || article.summary || article.title || '').trim();
    const chars = raw.length;
    const minutes = Math.max(1, Math.ceil(chars / 380));
    return { chars, minutes };
  }, [article]);

  const isForumTopic = Boolean(
    article?.source_id.startsWith('linuxdo') || 
    (article?.discussion_posts && article.discussion_posts.length > 0) ||
    article?.url.includes('linux.do')
  );

  const effectiveContent = article?.content || (isForumTopic ? article?.summary : null);

  // TOC extracted from article headings (>= 3 headings, excluding linuxdo-digest)
  const tocItems = useMemo(() => {
    if (!effectiveContent || article?.source_id === 'linuxdo-digest') return [];
    const items: { id: string; text: string; level: number }[] = [];
    const lines = effectiveContent.split('\n');
    let inCode = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      const mdMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
      if (mdMatch) {
        const level = mdMatch[1].length;
        const cleanText = mdMatch[2].replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').trim();
        if (cleanText) {
          items.push({ id: slugify(cleanText), text: cleanText, level });
        }
        continue;
      }

      const htmlMatch = trimmed.match(/<h([23])[^>]*>(.*?)<\/h\1>/i);
      if (htmlMatch) {
        const level = parseInt(htmlMatch[1], 10);
        const cleanText = htmlMatch[2].replace(/<[^>]+>/g, '').trim();
        if (cleanText) {
          items.push({ id: slugify(cleanText), text: cleanText, level });
        }
      }
    }

    return items.length >= 3 ? items : [];
  }, [effectiveContent, article?.source_id]);

  const scrollToHeading = (id: string) => {
    if (!scrollContainerRef.current) return;
    const target = scrollContainerRef.current.querySelector(`#${id}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

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
      {/* 1. Thin Reading Progress Indicator at top (Direct hardware-accelerated style update) */}
      <div
        ref={progressBarRef}
        className="absolute top-0 left-0 h-[2px] bg-accent z-50 pointer-events-none transition-none"
        style={{ width: '0%' }}
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
          <div className="relative" ref={typographyRef}>
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
                className="absolute right-0 top-full mt-2 w-72 p-4 rounded-xl bg-surface border border-surfaceBorder shadow-2xl z-50 space-y-3.5 text-xs select-none"
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

                {/* Content Column Width */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-textMuted">正文列宽</span>
                  <div className="flex items-center justify-between bg-surfaceRaised p-1 rounded-lg border border-surfaceBorder">
                    {([
                      { key: 'compact', label: '紧凑 (620)' },
                      { key: 'standard', label: '标准 (700)' },
                      { key: 'wide', label: '宽松 (840)' }
                    ] as const).map(item => (
                      <button
                        key={item.key}
                        onClick={() => setContentWidth(item.key)}
                        className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                          contentWidth === item.key ? 'bg-accent text-white shadow-xs' : 'text-textMuted hover:text-textPrimary'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Line Height */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-textMuted">行高间距</span>
                  <div className="flex items-center justify-between bg-surfaceRaised p-1 rounded-lg border border-surfaceBorder">
                    {([
                      { key: 'tight', label: '紧凑 (1.6)' },
                      { key: 'normal', label: '标准 (1.8)' },
                      { key: 'relaxed', label: '宽松 (2.1)' }
                    ] as const).map(item => (
                      <button
                        key={item.key}
                        onClick={() => setLineHeight(item.key)}
                        className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                          lineHeight === item.key ? 'bg-accent text-white shadow-xs' : 'text-textMuted hover:text-textPrimary'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bionic Reading Toggle */}
                <div className="pt-2 border-t border-surfaceBorder/60">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-[11px] font-medium text-textPrimary">仿生跳读引导 (Bionic)</span>
                      <p className="text-[10px] text-textMuted">加粗词汇前部，引导眼跳定焦</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={isBionicReading}
                      onChange={(e) => setIsBionicReading(e.target.checked)}
                      className="rounded border-surfaceBorder text-accent focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
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

          {/* Bilingual Translation Toggle (Follow 工作流) */}
          <button
            onClick={handleToggleBilingual}
            disabled={isLoadingBilingual}
            className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors ${
              isBilingualMode
                ? 'bg-accent/20 text-accent font-semibold border border-accent/30'
                : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
            }`}
            title={isBilingualMode ? "退出双语对照模式" : "开启 AI 逐段双语对照阅读流"}
          >
            {isLoadingBilingual ? (
              <RefreshCw size={14} className="animate-spin text-accent" />
            ) : (
              <Languages size={15} />
            )}
            <span className="hidden sm:inline text-[11px]">
              {isLoadingBilingual ? "翻译中..." : isBilingualMode ? "双语" : "双语对照"}
            </span>
          </button>

          {/* Edge-TTS Audio Player Toggle */}
          <button
            onClick={toggleAudioPlayback}
            className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors ${
              isAudioPlayerOpen
                ? 'bg-featuredBadge/20 text-featuredBadge font-semibold border border-featuredBadge/30'
                : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised'
            }`}
            title="Edge-TTS / 浏览器自然语音听文伴读"
          >
            <Headphones size={15} />
            <span className="hidden sm:inline text-[11px]">
              {isPlayingAudio ? "朗读中" : "听文"}
            </span>
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

          {/* On-demand Generate Latest Forum Digest Button */}
          {article.source_id === 'linuxdo-digest' && onGenerateDigest && (
            <button
              onClick={onGenerateDigest}
              disabled={isGeneratingDigest}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors font-medium shrink-0"
              title="即席把过去数小时最新抓取到的社区议题汇总生成新一期快报"
            >
              <Sparkles size={13} className={isGeneratingDigest ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{isGeneratingDigest ? "编纂中..." : "即席生成新刊"}</span>
            </button>
          )}

          {/* Fetch Fulltext (Hide for forum topics as OP and floors are synced natively) */}
          {!effectiveContent && !isForumTopic && (
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
        <div
          key={article.id}
          className={`mx-auto space-y-6 transition-all duration-200 ${contentWidthClass}`}
        >
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
              <span>已读 <span ref={progressTextRef}>0%</span></span>
            </div>
          </div>

          {/* Magazine Hero Banner & In-Page Section Quick-Jump TOC */}
          {article.source_id === 'linuxdo-digest' && (
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-surfaceRaised to-purple-950/30 border border-cyan-500/30 shadow-sm space-y-3 select-none">
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2 text-cyan-400 font-semibold">
                  <span className="text-base">🐧</span>
                  <span>LINUX DO 社区热点期刊 · AI 深度萃取</span>
                </div>
                <span className="text-[11px] font-mono text-cyan-300/80 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                  3分钟纵览全天精粹
                </span>
              </div>

              {/* In-Page Section Quick-Jump Anchor Pills */}
              <div className="pt-2 border-t border-surfaceBorder/60 flex items-center gap-2 flex-wrap text-xs">
                <span className="text-[11px] text-textMuted flex items-center gap-1 font-medium">
                  <span>直达板块:</span>
                </span>
                <button
                  type="button"
                  onClick={() => scrollToSection('开源')}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-surfaceBorder hover:border-cyan-400/60 hover:text-cyan-400 text-textPrimary transition-colors flex items-center gap-1 text-[11px] shadow-2xs"
                >
                  🛠️ <span>开源干货</span>
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('福利')}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-surfaceBorder hover:border-amber-400/60 hover:text-amber-400 text-textPrimary transition-colors flex items-center gap-1 text-[11px] shadow-2xs"
                >
                  🎁 <span>在役羊毛</span>
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('争鸣')}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-surfaceBorder hover:border-rose-400/60 hover:text-rose-400 text-textPrimary transition-colors flex items-center gap-1 text-[11px] shadow-2xs"
                >
                  🔥 <span>热门争鸣</span>
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('杂谈')}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-surfaceBorder hover:border-purple-400/60 hover:text-purple-400 text-textPrimary transition-colors flex items-center gap-1 text-[11px] shadow-2xs"
                >
                  💬 <span>神帖花絮</span>
                </button>
              </div>
            </div>
          )}

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
          {article.image_url && !leadImageFailed && (
            <div 
              onClick={() => setActiveLightboxImg(article.image_url || null)}
              className="rounded-xl overflow-hidden border border-surfaceBorder max-h-[420px] bg-surface flex items-center justify-center cursor-zoom-in group relative"
            >
              <SafeImage
                src={article.image_url}
                alt={article.image_alt || article.title}
                className="w-full h-auto object-cover max-h-[420px] group-hover:scale-[1.01] transition-transform duration-200"
                onImageClick={(validSrc) => setActiveLightboxImg(validSrc)}
                onError={() => setLeadImageFailed(true)}
              />
              <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                点击放大图片
              </span>
            </div>
          )}

          {/* Article Table of Contents (TOC) for structured long-read articles */}
          {tocItems.length >= 3 && (
            <div className="p-3.5 sm:p-4 rounded-2xl bg-surfaceRaised/40 border border-surfaceBorder/80 shadow-2xs select-none space-y-2.5">
              <div 
                className="flex items-center justify-between cursor-pointer group"
                onClick={() => setIsTocOpen(!isTocOpen)}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-textPrimary">
                  <ListTree size={15} className="text-accent" />
                  <span>文章目录</span>
                  <span className="text-[10px] font-mono font-normal text-textMuted bg-surfaceRaised px-1.5 py-0.5 rounded border border-surfaceBorder/50">
                    {tocItems.length} 个小节
                  </span>
                </div>
                <button className="text-textMuted group-hover:text-textPrimary transition-colors p-1 rounded-md hover:bg-surfaceRaised">
                  {isTocOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {isTocOpen && (
                <div className="pt-2 border-t border-surfaceBorder/50 space-y-1 text-xs">
                  {tocItems.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => scrollToHeading(item.id)}
                      className={`cursor-pointer text-textMuted hover:text-accent transition-colors flex items-center gap-1.5 py-1 px-1.5 rounded-lg hover:bg-surfaceRaised/80 truncate ${
                        item.level === 3 ? 'pl-5 text-[11px]' : 'font-medium'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.level === 3 ? 'bg-textMuted/40' : 'bg-accent/70'}`} />
                      <span className="truncate">{item.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Main Article Content with custom typography styles */}
          <article 
            className={`pt-2 text-textPrimary/90 space-y-4 ${
              fontFamily === 'serif' ? 'font-reader-serif' : 'font-reader-sans'
            }`}
            style={{ 
              fontSize: `${fontSize}px`, 
              lineHeight: lineHeight === 'tight' ? 1.6 : lineHeight === 'relaxed' ? 2.1 : 1.8 
            }}
          >
            {isBilingualMode && (
              <div className="mb-4 p-3 rounded-xl bg-accent/10 border border-accent/25 flex items-center justify-between text-xs text-accent animate-in fade-in duration-150">
                <div className="flex items-center gap-2 font-medium">
                  <Languages size={15} />
                  <span>正在呈现 AI 逐段双语对照流 (Follow模式 · 英文原文 + 中文精准释义)</span>
                </div>
                <button
                  onClick={() => setIsBilingualMode(false)}
                  className="text-[11px] underline hover:text-textPrimary transition-colors"
                >
                  切回原文
                </button>
              </div>
            )}

            {isForumTopic && (
              <div className="mb-4 p-2.5 px-3 rounded-xl bg-surfaceRaised/60 border border-surfaceBorder/80 flex items-center justify-between text-xs text-textMuted select-none">
                <div className="flex items-center gap-1.5 font-medium text-textPrimary">
                  <MessageSquare size={14} className="text-accent" />
                  <span>Discourse 社区主题帖（1 楼楼主首发）</span>
                </div>
                <span className="text-[11px] font-mono text-textMuted">
                  {article.discussion_posts ? `${article.discussion_posts.length} 条互动讨论` : ''}
                </span>
              </div>
            )}

            {article.content === undefined ? (
              <div className="p-12 text-center text-textMuted text-xs flex flex-col items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="font-mono text-textMuted/70">正在载入文章正文...</span>
              </div>
            ) : (isBilingualMode ? (bilingualContent || article.bilingual_content || effectiveContent) : effectiveContent) ? (
              <div className="prose max-w-none break-words space-y-4">
                <ReactMarkdown components={markdownComponents}>
                  {(isBilingualMode ? (bilingualContent || article.bilingual_content || effectiveContent) : effectiveContent) || ''}
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
          <SafeImage
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

      {/* 5. Natural Voice / Audio Player Bar */}
      {isAudioPlayerOpen && article && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 bg-surface/95 backdrop-blur-md border border-surfaceBorder rounded-2xl shadow-2xl p-2.5 px-4 flex items-center gap-3.5 text-xs text-textPrimary animate-in slide-in-from-bottom-2 duration-150 select-none">
          <audio
            ref={audioRef}
            src={`/api/reader/article/tts_audio?id=${encodeURIComponent(article.id)}&token=${getAuthToken() || ''}`}
            onEnded={() => setIsPlayingAudio(false)}
          />
          <div className="flex items-center gap-2 min-w-0">
            <Volume2 size={16} className={`text-accent shrink-0 ${isPlayingAudio ? 'animate-pulse' : ''}`} />
            <span className="font-medium text-xs truncate max-w-[150px] sm:max-w-xs">
              {article.clean_title || article.title}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Speed Selector */}
            <div className="flex items-center gap-0.5 bg-surfaceRaised p-0.5 rounded-lg border border-surfaceBorder text-[10px]">
              {([1.0, 1.25, 1.5] as const).map(rate => (
                <button
                  key={rate}
                  onClick={() => {
                    setSpeechRate(rate);
                    if (isPlayingAudio) startAudioPlayback(rate);
                  }}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    speechRate === rate ? 'bg-accent text-white font-semibold' : 'text-textMuted hover:text-textPrimary'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <button
              onClick={toggleAudioPlayback}
              className="p-1.5 rounded-full bg-accent text-white hover:bg-accent/90 shadow-xs"
              title={isPlayingAudio ? "暂停朗读" : "开始朗读"}
            >
              {isPlayingAudio ? <Pause size={13} /> : <Play size={13} />}
            </button>

            <button
              onClick={stopAudio}
              className="p-1 text-textMuted hover:text-textPrimary rounded-md hover:bg-surfaceRaised"
              title="关闭播放器"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 6. Floating Back to Top Button */}
      {showBackToTop && (
        <button
          onClick={handleScrollToTop}
          className="fixed sm:absolute bottom-6 right-6 z-40 p-2.5 rounded-full bg-surface/90 hover:bg-surfaceRaised backdrop-blur-md border border-surfaceBorder hover:border-accent text-textMuted hover:text-accent shadow-xl transition-all duration-200 cursor-pointer animate-in fade-in zoom-in-95"
          title="回到顶部"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </main>
  );
};
