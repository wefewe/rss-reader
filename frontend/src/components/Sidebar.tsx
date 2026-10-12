import React from 'react';
import { 
  BookOpen, 
  Sparkles, 
  Coffee, 
  Settings, 
  RefreshCw, 
  CheckCheck, 
  Folder, 
  Rss, 
  Star, 
  Layers, 
  Flame,
  ChevronRight,
  ChevronDown,
  Sun,
  Moon,
  Eye,
  Bookmark,
} from 'lucide-react';
import { FeedSource, ViewType, ThemeMode } from '../types';

interface SidebarProps {
  sources: FeedSource[];
  currentGroup: string;
  currentSourceId: string;
  currentView: ViewType;
  currentTheme: ThemeMode;
  onSelectGroup: (group: string) => void;
  onSelectSource: (sourceId: string) => void;
  onSelectView: (view: ViewType) => void;
  onSelectTheme: (theme: ThemeMode) => void;
  onRefresh: () => void;
  onOpenBrief: () => void;
  onOpenSettings: () => void;
  onMarkAllRead: () => void;
  isRefreshing: boolean;
  totalUnread: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sources,
  currentGroup,
  currentSourceId,
  currentView,
  currentTheme,
  onSelectGroup,
  onSelectSource,
  onSelectView,
  onSelectTheme,
  onRefresh,
  onOpenBrief,
  onOpenSettings,
  onMarkAllRead,
  isRefreshing,
  totalUnread,
}) => {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({});

  // Group sources by group_name
  const groupedSources = React.useMemo(() => {
    const map: Record<string, FeedSource[]> = {};
    for (const s of sources) {
      if (!map[s.group_name]) map[s.group_name] = [];
      map[s.group_name].push(s);
    }
    return map;
  }, [sources]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <aside className="w-64 bg-surface border-r border-surfaceBorder flex flex-col h-screen select-none shrink-0">
      {/* Brand & Action Header */}
      <div className="p-4 border-b border-surfaceBorder flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-accent/15 text-accent">
            <BookOpen size={20} />
          </div>
          <div>
            <h1 className="font-semibold text-textPrimary text-sm tracking-tight flex items-center gap-1.5">
              数字图书馆
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent uppercase font-bold">
                AI
              </span>
            </h1>
            <p className="text-[11px] text-textMuted">常驻阅读与信息流</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="立即刷新订阅"
          className="p-1.5 rounded-md hover:bg-surfaceRaised text-textMuted hover:text-textPrimary transition-colors"
        >
          <RefreshCw size={16} className={isRefreshing ? "animate-spin text-accent" : ""} />
        </button>
      </div>

      {/* Main View Filters */}
      <div className="p-3 space-y-1 border-b border-surfaceBorder">
        <button
          onClick={() => { onSelectGroup('全部'); onSelectSource(''); onSelectView('all'); }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            currentView === 'all' && currentGroup === '全部' && !currentSourceId
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Layers size={15} />
            <span>全部文章</span>
          </div>
          {totalUnread > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent/20 text-accent font-mono font-semibold">
              {totalUnread}
            </span>
          )}
        </button>

        <button
          onClick={() => { onSelectView('featured'); onSelectGroup('全部'); onSelectSource(''); }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            currentView === 'featured'
              ? 'bg-featuredBadge/15 text-featuredBadge font-semibold'
              : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Flame size={15} />
            <span>精选高价值</span>
          </div>
          <span className="text-[10px] text-featuredBadge">AI Triage</span>
        </button>

        <button
          onClick={() => { onSelectView('unread'); onSelectGroup('全部'); onSelectSource(''); }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            currentView === 'unread'
              ? 'bg-accentGreen/15 text-accentGreen font-semibold'
              : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={15} />
            <span>未读流</span>
          </div>
        </button>

        <button
          onClick={() => { onSelectView('starred'); onSelectGroup('全部'); onSelectSource(''); }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            currentView === 'starred'
              ? 'bg-accentGold/15 text-accentGold font-semibold'
              : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Star size={15} />
            <span>星标收藏</span>
          </div>
        </button>

        <button
          onClick={() => { onSelectView('highlights'); onSelectGroup('全部'); onSelectSource(''); }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            currentView === 'highlights'
              ? 'bg-amber-400/15 text-amber-300 font-semibold'
              : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Bookmark size={15} />
            <span>灵感划线库</span>
          </div>
          <span className="text-[10px] text-amber-400 font-mono">Readwise</span>
        </button>
      </div>

      {/* Subscription Groups Tree */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold text-textMuted uppercase tracking-wider">
            订阅源分组 ({Object.keys(groupedSources).length})
          </span>
          <button
            onClick={onMarkAllRead}
            title="全部标为已读"
            className="text-[11px] text-textMuted hover:text-accent flex items-center gap-1 transition-colors"
          >
            <CheckCheck size={12} />
            全部标读
          </button>
        </div>

        <div className="space-y-3">
          {Object.entries(groupedSources).map(([group, groupSources]) => {
            const isGroupActive = currentGroup === group && !currentSourceId;
            const isCollapsed = collapsedGroups[group];
            const groupUnread = groupSources.reduce((acc, s) => acc + s.unread_count, 0);

            return (
              <div key={group} className="space-y-0.5">
                {/* Group Item */}
                <div
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    isGroupActive
                      ? 'bg-surfaceRaised text-textPrimary'
                      : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/40'
                  }`}
                >
                  <div 
                    className="flex items-center gap-1.5 flex-1 truncate"
                    onClick={() => { onSelectGroup(group); onSelectSource(''); }}
                  >
                    <Folder size={14} className="shrink-0 text-textMuted" />
                    <span className="truncate">{group}</span>
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    {groupUnread > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-surfaceBorder text-textMuted font-mono">
                        {groupUnread}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleGroup(group); }}
                      className="p-0.5 hover:text-textPrimary text-textMuted"
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>
                </div>

                {/* Feed Sources in Group */}
                {!isCollapsed && (
                  <div className="pl-4 space-y-0.5 border-l border-surfaceBorder/60 ml-2">
                    {groupSources.map(s => {
                      const isSourceActive = currentSourceId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => onSelectSource(s.id)}
                          className={`flex items-center justify-between px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                            isSourceActive
                              ? 'bg-accent/15 text-accent font-medium'
                              : 'text-textMuted hover:text-textPrimary hover:bg-surfaceRaised/30'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate flex-1">
                            <Rss size={12} className="shrink-0 opacity-60" />
                            <span className="truncate">{s.title}</span>
                          </div>
                          {s.unread_count > 0 && (
                            <span className="text-[10px] text-accent/80 font-mono">
                              {s.unread_count}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="p-2.5 border-t border-surfaceBorder flex items-center justify-between bg-surface/50 gap-1.5">
        <button
          onClick={onOpenBrief}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-all"
        >
          <Coffee size={14} className="text-accentGold" />
          <span>早报</span>
        </button>

        {/* 3-Theme Selector */}
        <div className="flex items-center p-0.5 rounded-lg bg-surfaceRaised/80 border border-surfaceBorder text-[11px]">
          <button
            onClick={() => onSelectTheme('dark')}
            className={`p-1 rounded-md transition-colors ${
              currentTheme === 'dark' ? 'bg-surface text-indigo-400 shadow-xs' : 'text-textMuted hover:text-textPrimary'
            }`}
            title="极夜暗黑模式"
          >
            <Moon size={13} />
          </button>
          <button
            onClick={() => onSelectTheme('light')}
            className={`p-1 rounded-md transition-colors ${
              currentTheme === 'light' ? 'bg-surface text-amber-500 shadow-xs' : 'text-textMuted hover:text-textPrimary'
            }`}
            title="纯净明亮模式"
          >
            <Sun size={13} />
          </button>
          <button
            onClick={() => onSelectTheme('sepia')}
            className={`p-1 rounded-md transition-colors ${
              currentTheme === 'sepia' ? 'bg-surface text-amber-700 dark:text-amber-300 shadow-xs' : 'text-textMuted hover:text-textPrimary'
            }`}
            title="暖白护眼模式"
          >
            <Eye size={13} />
          </button>
        </div>

        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surfaceRaised transition-colors"
          title="系统与偏好设置"
        >
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
};
