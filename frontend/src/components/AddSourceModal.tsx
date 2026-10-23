import React, { useState, useEffect } from 'react';
import { X, Plus, Rss, Loader2, AlertCircle, Check, Folder } from 'lucide-react';
import { FeedSource } from '../types';
import { createSource } from '../api';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  sources: FeedSource[];
  onSourceAdded: (source: FeedSource, message: string) => void;
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  isOpen,
  onClose,
  sources,
  onSourceAdded,
}) => {
  const [feedUrl, setFeedUrl] = useState('');
  const [title, setTitle] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('个人关注');
  const [customGroup, setCustomGroup] = useState('');
  const [isCustomGroup, setIsCustomGroup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Extract unique group names from existing sources
  const existingGroups = React.useMemo(() => {
    const set = new Set<string>();
    set.add('个人关注');
    set.add('科技资讯');
    set.add('深度博客');
    for (const s of sources) {
      if (s.group_name) set.add(s.group_name);
    }
    return Array.from(set);
  }, [sources]);

  useEffect(() => {
    if (isOpen) {
      setFeedUrl('');
      setTitle('');
      setSelectedGroup('个人关注');
      setCustomGroup('');
      setIsCustomGroup(false);
      setIsLoading(false);
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUrl = feedUrl.trim();
    if (!targetUrl) {
      setErrorMsg('请输入 RSS 订阅地址或网站主页 URL');
      return;
    }

    const finalGroup = isCustomGroup
      ? (customGroup.trim() || '自定义订阅')
      : selectedGroup;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await createSource({
        feed_url: targetUrl,
        group_name: finalGroup,
        title: title.trim() || undefined,
      });

      onSourceAdded(res.source, res.message);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || '添加订阅源失败，请检查 URL 是否可达');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div 
        className="w-full max-w-md bg-surface border border-surfaceBorder rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-surfaceBorder flex items-center justify-between bg-surfaceRaised/50">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-accent/15 text-accent">
              <Plus size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-textPrimary">添加新订阅源</h2>
              <p className="text-[11px] text-textMuted">支持 Feed 链接或站点主页自动发现</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-accentRed/10 border border-accentRed/20 flex items-start gap-2.5 text-accentRed text-xs">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1 break-all leading-relaxed">
                {errorMsg}
              </div>
            </div>
          )}

          {/* Feed URL / Site URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-textMuted flex items-center gap-1.5">
              <Rss size={13} className="text-accent" />
              订阅地址或网站 URL <span className="text-accentRed">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="https://example.com/feed 或 https://example.com"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 text-xs rounded-xl bg-surfaceRaised border border-surfaceBorder text-textPrimary focus:outline-hidden focus:border-accent font-mono placeholder:text-textMuted/50 transition-colors"
            />
            <p className="text-[10px] text-textMuted/80">
              💡 提示：直接填入博客或网站域名，系统将自动抓取页面探测并发现对应的 RSS/Atom 链接。
            </p>
          </div>

          {/* Optional Custom Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-textMuted flex items-center gap-1.5">
              自定义标题（选填）
            </label>
            <input
              type="text"
              placeholder="留空则自动从订阅源标题中提取"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 text-xs rounded-xl bg-surfaceRaised border border-surfaceBorder text-textPrimary focus:outline-hidden focus:border-accent placeholder:text-textMuted/50 transition-colors"
            />
          </div>

          {/* Group Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-textMuted flex items-center gap-1.5">
              <Folder size={13} className="text-accent" />
              归属分组
            </label>

            {!isCustomGroup ? (
              <div className="flex gap-2">
                <select
                  value={selectedGroup}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      setIsCustomGroup(true);
                    } else {
                      setSelectedGroup(e.target.value);
                    }
                  }}
                  disabled={isLoading}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-surfaceRaised border border-surfaceBorder text-textPrimary focus:outline-hidden focus:border-accent transition-colors cursor-pointer"
                >
                  {existingGroups.map((grp) => (
                    <option key={grp} value={grp}>{grp}</option>
                  ))}
                  <option value="__NEW__">➕ 新建分组...</option>
                </select>
                <button
                  type="button"
                  onClick={() => setIsCustomGroup(true)}
                  className="px-2.5 py-2 rounded-xl text-xs bg-surfaceRaised border border-surfaceBorder text-textMuted hover:text-textPrimary transition-colors"
                >
                  新建
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="输入新分组名称..."
                  value={customGroup}
                  onChange={(e) => setCustomGroup(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-surfaceRaised border border-surfaceBorder text-textPrimary focus:outline-hidden focus:border-accent placeholder:text-textMuted/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setIsCustomGroup(false)}
                  className="px-2.5 py-2 rounded-xl text-xs bg-surfaceRaised border border-surfaceBorder text-textMuted hover:text-textPrimary transition-colors"
                >
                  选择已有
                </button>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-surfaceBorder/60">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-medium text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading || !feedUrl.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-all shadow-xs"
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>探测校验与首抓中...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>确认添加</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
