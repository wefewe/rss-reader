import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  ListChecks, 
  HelpCircle, 
  AlertTriangle, 
  RotateCcw, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp,
  Loader2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Article, AiChatMessage } from '../types';
import { askArticle } from '../api';

interface ArticleAiAssistantProps {
  article: Article;
  fontFamily: 'sans' | 'serif';
  fontSize: number;
}

const PRESET_PROMPTS = [
  { label: '提取行动清单', prompt: '请提炼出本文核心的行动清单（Todo List）与具体执行步骤。', icon: ListChecks },
  { label: '总结争议与评价', prompt: '请综合本文观点与社区回帖讨论，总结核心争议点和网友风向评价。', icon: HelpCircle },
  { label: '一句话大白话省流', prompt: '请用最通俗易懂的大白话、3句话以内为我概括本文最核心价值。', icon: Sparkles },
  { label: '潜在风险与坑点', prompt: '实践或采用本文提到的方案/产品时，可能会遇到哪些潜在风险、坑点或成本代价？', icon: AlertTriangle },
];

export const ArticleAiAssistant: React.FC<ArticleAiAssistantProps> = ({
  article,
  fontFamily,
  fontSize,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [inputQuestion, setInputQuestion] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Reset chat when switching article
  useEffect(() => {
    setMessages([]);
    setInputQuestion('');
    setIsLoading(false);
  }, [article.id]);

  useEffect(() => {
    if (messages.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleSend = async (questionText?: string) => {
    const q = (questionText || inputQuestion).trim();
    if (!q || isLoading) return;

    const userMsg: AiChatMessage = { role: 'user', content: q };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputQuestion('');
    setIsLoading(true);

    try {
      // Send conversation history (last 4 turns)
      const historyPayload = messages.slice(-4).map(m => ({
        role: m.role,
        content: m.content
      }));

      const answer = await askArticle(article.id, q, historyPayload);
      setMessages([...nextMessages, { role: 'assistant', content: answer }]);
    } catch (err: any) {
      setMessages([
        ...nextMessages,
        { role: 'assistant', content: `❌ 请求出错: ${err.message || '网络连接超时'}` }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="rounded-2xl bg-surfaceRaised/40 border border-surfaceBorder overflow-hidden shadow-xs transition-all">
      {/* Header Bar */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-4 py-3 bg-surfaceRaised/60 cursor-pointer select-none hover:bg-surfaceRaised/90 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-textPrimary">
          <div className="w-6 h-6 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
            <Bot size={15} />
          </div>
          <span>AI 互动追问与行动提炼</span>
          <span className="text-[10px] font-normal text-textMuted px-1.5 py-0.5 rounded bg-surface border border-surfaceBorder">
            DeepSeek-V4.1
          </span>
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMessages([]);
              }}
              className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surface transition-colors"
              title="清空对话"
            >
              <RotateCcw size={13} />
            </button>
          )}
          <span className="text-textMuted">
            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </div>

      {/* Body Area */}
      {isOpen && (
        <div className="p-4 space-y-4">
          {/* Quick Preset Prompt Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_PROMPTS.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => handleSend(item.prompt)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl bg-surface border border-surfaceBorder/80 text-textPrimary hover:border-accent/50 hover:bg-accent/5 hover:text-accent transition-all disabled:opacity-50"
                >
                  <Icon size={13} className="text-accent" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Messages Thread */}
          {messages.length > 0 && (
            <div className="space-y-3.5 max-h-[420px] overflow-y-auto pr-1">
              {messages.map((msg, index) => {
                const isUser = msg.role === 'user';
                return (
                  <div 
                    key={index} 
                    className={`flex flex-col space-y-1.5 ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="text-[10px] text-textMuted px-1 flex items-center gap-1">
                      {isUser ? '你' : 'AI 顾问'}
                    </div>

                    <div 
                      className={`relative group max-w-[92%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        isUser 
                          ? 'bg-accent text-white rounded-br-xs' 
                          : 'bg-surface border border-surfaceBorder text-textPrimary rounded-bl-xs shadow-xs'
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div 
                          className={`prose max-w-none ${
                            fontFamily === 'serif' ? 'font-reader-serif' : 'font-reader-sans'
                          }`}
                          style={{ fontSize: `${fontSize - 2}px` }}
                        >
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}

                      {!isUser && (
                        <button
                          onClick={() => handleCopy(msg.content, index)}
                          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 rounded bg-surfaceRaised text-textMuted hover:text-textPrimary transition-all"
                          title="复制回答"
                        >
                          {copiedIndex === index ? (
                            <Check size={12} className="text-accentGreen" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-textMuted p-2 bg-surface rounded-xl border border-surfaceBorder w-fit">
                  <Loader2 size={14} className="animate-spin text-accent" />
                  <span>AI 正在深入研读文章并组织回答...</span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
          )}

          {/* Input Box */}
          <div className="relative flex items-end gap-2 bg-surface rounded-xl border border-surfaceBorder focus-within:border-accent p-2 shadow-xs transition-colors">
            <textarea
              value={inputQuestion}
              onChange={(e) => setInputQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={2}
              placeholder="向 AI 提问文章细节，或输入'提取核心行动步骤'... (Enter 发送, Shift+Enter 换行)"
              className="flex-1 bg-transparent text-xs text-textPrimary placeholder:text-textMuted/60 resize-none outline-none leading-relaxed"
            />
            <button
              onClick={() => handleSend()}
              disabled={!inputQuestion.trim() || isLoading}
              className="p-2 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent transition-all shrink-0"
              title="发送提问"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
