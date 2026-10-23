import React, { useState, useRef } from 'react';
import { 
  X, 
  Settings, 
  Check, 
  ShieldCheck, 
  Sparkles, 
  Sliders, 
  LogOut, 
  VolumeX, 
  Plus, 
  Download, 
  Upload, 
  Loader2,
  Trash2,
  Rss,
  ExternalLink,
  AlertCircle,
  Clock,
  RefreshCw,
  Pause,
  Play
} from 'lucide-react';
import { ReaderPreferences, FeedSource } from '../types';
import { updateReaderPreferences, logout, downloadOpmlExport, importOpmlFile, refreshSingleSource, toggleSourceStatus } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: ReaderPreferences;
  onPreferencesUpdated: (newPref: ReaderPreferences) => void;
  sources?: FeedSource[];
  onDeleteSource?: (id: string) => Promise<void>;
  onOpenAddSource?: () => void;
  onSourceUpdated?: (updatedSource: FeedSource) => void;
}

type TabType = 'preferences' | 'ai' | 'sources';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  preferences,
  onPreferencesUpdated,
  sources = [],
  onDeleteSource,
  onOpenAddSource,
  onSourceUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('preferences');
  const [form, setForm] = useState<ReaderPreferences>(preferences);
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingOpml, setIsExportingOpml] = useState(false);
  const [isImportingOpml, setIsImportingOpml] = useState(false);
  const [importResult, setImportResult] = useState<{ message: string; success: boolean } | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const [togglingSourceId, setTogglingSourceId] = useState<string | null>(null);
  const opmlFileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setForm(preferences);
  }, [preferences]);

  if (!isOpen) return null;

  const handleExportOpml = async () => {
    setIsExportingOpml(true);
    try {
      await downloadOpmlExport();
    } catch (err: any) {
      alert(err.message || '导出 OPML 失败');
    } finally {
      setIsExportingOpml(false);
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingOpml(true);
    setImportResult(null);
    try {
      const res = await importOpmlFile(file);
      setImportResult({
        success: true,
        message: `成功导入 ${res.imported_count} 个新订阅源（跳过已存在 ${res.skipped_count} 个），正在后台触发首轮抓取！`
      });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setImportResult({
        success: false,
        message: `导入失败: ${err.message || '文件格式不正确'}`
      });
    } finally {
      setIsImportingOpml(false);
      if (opmlFileInputRef.current) opmlFileInputRef.current.value = '';
    }
  };

  const handleAddKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    const current = form.muted_keywords || [];
    if (!current.includes(kw)) {
      setForm({ ...form, muted_keywords: [...current, kw] });
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (kwToRemove: string) => {
    const current = form.muted_keywords || [];
    setForm({ ...form, muted_keywords: current.filter(k => k !== kwToRemove) });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await updateReaderPreferences(form);
      onPreferencesUpdated(updated);
      onClose();
    } catch (e) {
      alert('保存设置失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSourceClick = async (source: FeedSource) => {
    if (!onDeleteSource) return;
    if (!confirm(`确定要移除订阅源《${source.title}》吗？其已抓取的历史文章也将一并清理。`)) return;
    setDeletingSourceId(source.id);
    try {
      await onDeleteSource(source.id);
    } finally {
      setDeletingSourceId(null);
    }
  };

  const handleRefreshSourceClick = async (source: FeedSource) => {
    setRefreshingSourceId(source.id);
    try {
      const updated = await refreshSingleSource(source.id);
      if (onSourceUpdated) onSourceUpdated(updated);
    } catch (err: any) {
      alert(err.message || '刷新订阅源失败');
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const handleToggleSourceStatusClick = async (source: FeedSource) => {
    setTogglingSourceId(source.id);
    try {
      const res = await toggleSourceStatus(source.id);
      if (onSourceUpdated) onSourceUpdated(res.source);
    } catch (err: any) {
      alert(err.message || '切换状态失败');
    } finally {
      setTogglingSourceId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-surfaceBorder rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in duration-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-surfaceBorder flex items-center justify-between bg-surfaceRaised/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent/15 text-accent">
              <Settings size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-textPrimary">阅读偏好与订阅中枢</h2>
              <p className="text-xs text-textMuted">定制过滤规则、AI 调度与订阅源生命周期</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surfaceBorder text-textMuted hover:text-textPrimary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center border-b border-surfaceBorder bg-surfaceRaised/30 px-6 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('preferences')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'preferences'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-textMuted hover:text-textPrimary'
            }`}
          >
            <Sliders size={13} />
            <span>促销与静音规则</span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'ai'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-textMuted hover:text-textPrimary'
            }`}
          >
            <Sparkles size={13} />
            <span>AI 模型与早报</span>
          </button>

          <button
            onClick={() => setActiveTab('sources')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'sources'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-textMuted hover:text-textPrimary'
            }`}
          >
            <Rss size={13} />
            <span>订阅源健康与 OPML ({sources.length})</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-xs text-textPrimary overflow-y-auto flex-1">
          {/* TAB 1: Preferences & Mute */}
          {activeTab === 'preferences' && (
            <div className="space-y-5">
              {/* Promotion filters section */}
              <div className="space-y-3">
                <h3 className="font-semibold text-textMuted uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Sliders size={13} />
                  促销与推广类型开关
                </h3>
                <div className="space-y-2 bg-surfaceRaised/50 p-3.5 rounded-xl border border-surfaceBorder">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-medium text-textPrimary">电商大促活动</span>
                      <p className="text-[11px] text-textMuted">如双十一、618、黑五等集中折扣</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.show_big_sales}
                      onChange={(e) => setForm({ ...form, show_big_sales: e.target.checked })}
                      className="rounded border-surfaceBorder text-accent focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <div className="h-px bg-surfaceBorder/60" />

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-medium text-textPrimary">实时线报优惠</span>
                      <p className="text-[11px] text-textMuted">如羊毛立减、限时免费、优惠券领用</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.show_deal_alerts}
                      onChange={(e) => setForm({ ...form, show_deal_alerts: e.target.checked })}
                      className="rounded border-surfaceBorder text-accent focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <div className="h-px bg-surfaceBorder/60" />

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-medium text-textPrimary">返利推广链接</span>
                      <p className="text-[11px] text-textMuted">默认过滤带佣金返利的纯引流内容</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.show_affiliate}
                      onChange={(e) => setForm({ ...form, show_affiliate: e.target.checked })}
                      className="rounded border-surfaceBorder text-accent focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <div className="h-px bg-surfaceBorder/60" />

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-medium text-textPrimary">品牌软文投放</span>
                      <p className="text-[11px] text-textMuted">由厂商付费赞助发表的宣传软文</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.show_sponsored}
                      onChange={(e) => setForm({ ...form, show_sponsored: e.target.checked })}
                      className="rounded border-surfaceBorder text-accent focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* Muted Keywords section */}
              <div className="space-y-3">
                <h3 className="font-semibold text-textMuted uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <VolumeX size={13} className="text-accentRed" />
                  关键词静音与黑名单 (Keyword Mute)
                </h3>
                <div className="space-y-3 bg-surfaceRaised/50 p-3.5 rounded-xl border border-surfaceBorder">
                  <p className="text-[11px] text-textMuted">
                    包含所设关键词的文章将自动降权并收拢至“低价值折叠”层，绝不打扰常驻精选阅读。
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap min-h-[30px]">
                    {form.muted_keywords && form.muted_keywords.length > 0 ? (
                      form.muted_keywords.map((kw, idx) => (
                        <span 
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-surfaceBorder text-textPrimary text-xs shadow-2xs"
                        >
                          <span>{kw}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveKeyword(kw)}
                            className="text-textMuted hover:text-accentRed transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-textMuted/60 italic">暂无静音关键词</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddKeyword();
                        }
                      }}
                      placeholder="输入静音词（如：拼多多、邀请码、助力）后按回车..."
                      className="flex-1 bg-surface border border-surfaceBorder rounded-lg px-3 py-1.5 text-xs text-textPrimary focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={handleAddKeyword}
                      disabled={!newKeyword.trim()}
                      className="px-3 py-1.5 rounded-lg bg-surfaceRaised hover:bg-surfaceBorder border border-surfaceBorder text-xs text-textPrimary hover:text-accent disabled:opacity-40 transition-colors flex items-center gap-1"
                    >
                      <Plus size={13} />
                      <span>添加</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI Settings */}
          {activeTab === 'ai' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-textMuted uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Sparkles size={13} className="text-featuredBadge" />
                AxonHub 模型调度与推理配置
              </h3>
              <div className="space-y-3.5 bg-surfaceRaised/50 p-4 rounded-xl border border-surfaceBorder">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="font-medium text-textPrimary">纯规则免 LLM 模式</span>
                    <p className="text-[11px] text-textMuted">开启后不调用任何大模型，仅按本地规则分流</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.pure_rule_mode}
                    onChange={(e) => setForm({ ...form, pure_rule_mode: e.target.checked })}
                    className="rounded border-surfaceBorder text-accent focus:ring-0 w-4 h-4 cursor-pointer"
                  />
                </label>

                <div className="h-px bg-surfaceBorder/60" />

                <div className="space-y-1.5">
                  <label className="text-[11px] text-textMuted font-medium">日常文章摘要模型</label>
                  <input
                    type="text"
                    value={form.summary_model}
                    onChange={(e) => setForm({ ...form, summary_model: e.target.value })}
                    placeholder="deepseek-v4.1-flash"
                    className="w-full bg-surface border border-surfaceBorder rounded-lg px-3 py-1.5 text-xs text-textPrimary font-mono focus:outline-none focus:border-accent"
                  />
                  <span className="text-[10px] text-textMuted">推荐：`deepseek-v4.1-flash`（高性价比极速推理）</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-textMuted font-medium">每日 09:00 早报生成模型</label>
                  <input
                    type="text"
                    value={form.brief_model}
                    onChange={(e) => setForm({ ...form, brief_model: e.target.value })}
                    placeholder="gpt-5.6-terra"
                    className="w-full bg-surface border border-surfaceBorder rounded-lg px-3 py-1.5 text-xs text-textPrimary font-mono focus:outline-none focus:border-accent"
                  />
                  <span className="text-[10px] text-textMuted">推荐：`gpt-5.6-terra` 或 `claude-sonnet-4-6`（宏观叙事提炼）</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Sources & OPML Management */}
          {activeTab === 'sources' && (
            <div className="space-y-5">
              {/* OPML Backup / Import */}
              <div className="space-y-2.5 bg-surfaceRaised/50 p-4 rounded-xl border border-surfaceBorder">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-textPrimary">OPML 备份与迁移</span>
                  <span className="text-[11px] text-textMuted">支持 Inoreader / Feedly / NetNewsWire</span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleExportOpml}
                    disabled={isExportingOpml}
                    className="flex-1 py-2 px-3 rounded-xl bg-surface border border-surfaceBorder hover:border-accent hover:text-accent text-xs font-medium text-textPrimary transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    {isExportingOpml ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    <span>导出 OPML 备份</span>
                  </button>

                  <input
                    type="file"
                    ref={opmlFileInputRef}
                    onChange={handleImportFileChange}
                    accept=".opml,.xml"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => opmlFileInputRef.current?.click()}
                    disabled={isImportingOpml}
                    className="flex-1 py-2 px-3 rounded-xl bg-surface border border-surfaceBorder hover:border-accent hover:text-accent text-xs font-medium text-textPrimary transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    {isImportingOpml ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    <span>导入 OPML 文件</span>
                  </button>
                </div>

                {importResult && (
                  <div className={`p-2.5 rounded-lg text-xs leading-relaxed border ${
                    importResult.success 
                      ? 'bg-accentGreen/10 border-accentGreen/30 text-accentGreen' 
                      : 'bg-accentRed/10 border-accentRed/30 text-accentRed'
                  }`}>
                    {importResult.message}
                  </div>
                )}
              </div>

              {/* Fever API Native Client Sync */}
              <div className="space-y-2.5 bg-surfaceRaised/50 p-4 rounded-xl border border-surfaceBorder text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-textPrimary flex items-center gap-1.5">
                    <span>📱 Fever 客户端集成 (Reeder / NetNewsWire)</span>
                  </span>
                  <span className="text-[10px] text-accent font-mono font-medium">Fever API v3</span>
                </div>
                <p className="text-[11px] text-textMuted">
                  在 iOS / macOS / Android 上的原生阅读器中添加 Fever 账号，直接同步自建阅读流。
                </p>

                <div className="bg-surface p-2.5 rounded-lg border border-surfaceBorder space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between items-center">
                    <span className="text-textMuted">服务器 (Endpoint):</span>
                    <span className="text-textPrimary select-all">https://reader.cwsub.indevs.in/api/reader/fever</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-textMuted">用户名 (Username):</span>
                    <span className="text-textPrimary">admin</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-textMuted">密码 (Password):</span>
                    <span className="text-textPrimary">同阅读器口令</span>
                  </div>
                </div>
              </div>

              {/* Live Feed Sources List Inspector */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-textMuted uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Rss size={13} className="text-accent" />
                    全量订阅源运行监控 ({sources.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    {onOpenAddSource && (
                      <button
                        type="button"
                        onClick={onOpenAddSource}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-accent/15 text-accent hover:bg-accent/25 font-medium transition-colors flex items-center gap-1"
                      >
                        <Plus size={11} />
                        添加订阅
                      </button>
                    )}
                    <span className="text-[11px] text-textMuted">实时状态与单源运维</span>
                  </div>
                </div>

                <div className="divide-y divide-surfaceBorder/60 border border-surfaceBorder rounded-xl bg-surfaceRaised/40 overflow-hidden">
                  {sources.map((s) => {
                    const isAutoDisabled = s.status === 'disabled';
                    const isUserPaused = s.status === 'user_paused';
                    const isError = s.status === 'error' || (!isAutoDisabled && !isUserPaused && !!s.last_error);
                    const isDeleting = deletingSourceId === s.id;
                    const isRefreshing = refreshingSourceId === s.id;
                    const isToggling = togglingSourceId === s.id;

                    let statusDotColor = 'bg-accentGreen';
                    if (isAutoDisabled) statusDotColor = 'bg-accentRed ring-2 ring-accentRed/40';
                    else if (isUserPaused) statusDotColor = 'bg-amber-400 ring-2 ring-amber-400/40';
                    else if (isError) statusDotColor = 'bg-accentRed animate-pulse';

                    return (
                      <div key={s.id} className="p-3 hover:bg-surfaceRaised/80 transition-colors flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor}`} />
                            <span className="font-semibold text-textPrimary truncate">{s.title}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-surfaceBorder text-textMuted">
                              {s.group_name}
                            </span>
                            {isAutoDisabled && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-accentRed/30 text-accentRed border border-accentRed/50 flex items-center gap-1 font-semibold">
                                <AlertCircle size={10} />
                                连续失败熔断停用 ({s.consecutive_failures || 10}次)
                              </span>
                            )}
                            {isUserPaused && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center gap-1 font-medium">
                                <Pause size={10} />
                                用户手动暂停
                              </span>
                            )}
                            {isError && !isAutoDisabled && !isUserPaused && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-accentRed/20 text-accentRed border border-accentRed/30 flex items-center gap-1">
                                <AlertCircle size={10} />
                                抓取异常
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-textMuted font-mono">
                            <span>文章: {s.article_count}</span>
                            <span>•</span>
                            <span>未读: {s.unread_count}</span>
                            {s.last_checked_at && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1 text-[10px]">
                                  <Clock size={10} />
                                  {s.last_checked_at.replace('T', ' ').slice(5, 16)}
                                </span>
                              </>
                            )}
                          </div>

                          {s.last_error && (
                            <p className="text-[10px] text-accentRed bg-accentRed/10 p-1.5 rounded border border-accentRed/20 truncate" title={s.last_error}>
                              ⚠️ {s.last_error}
                            </p>
                          )}
                        </div>

                        {/* Actions (单源刷新、启用/停用、站点跳转、删除) */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* 单源刷新 */}
                          <button
                            type="button"
                            onClick={() => handleRefreshSourceClick(s)}
                            disabled={isRefreshing || isAutoDisabled || isUserPaused}
                            className="p-1.5 rounded-lg text-textMuted hover:text-accent hover:bg-surface transition-colors disabled:opacity-30"
                            title={isUserPaused ? "已暂停源请先恢复后再刷新" : "单源立即刷新抓取"}
                          >
                            <RefreshCw size={13} className={isRefreshing ? "animate-spin text-accent" : ""} />
                          </button>

                          {/* 暂停 / 恢复 */}
                          <button
                            type="button"
                            onClick={() => handleToggleSourceStatusClick(s)}
                            disabled={isToggling}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                              isUserPaused || isAutoDisabled
                                ? 'text-amber-400 hover:bg-amber-400/10'
                                : 'text-textMuted hover:text-amber-300 hover:bg-surface'
                            }`}
                            title={isUserPaused || isAutoDisabled ? "恢复定时抓取" : "暂停定时抓取"}
                          >
                            {isToggling ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : isUserPaused || isAutoDisabled ? (
                              <Play size={13} />
                            ) : (
                              <Pause size={13} />
                            )}
                          </button>

                          {s.site_url && (
                            <a
                              href={s.site_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface transition-colors"
                              title="访问源站点"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}

                          {onDeleteSource && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSourceClick(s)}
                              disabled={isDeleting}
                              className="p-1.5 rounded-lg text-textMuted hover:text-accentRed hover:bg-accentRed/10 transition-colors disabled:opacity-40"
                              title="移除此订阅源"
                            >
                              {isDeleting ? <Loader2 size={13} className="animate-spin text-accentRed" /> : <Trash2 size={13} />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-surfaceBorder flex items-center justify-between bg-surfaceRaised/40 shrink-0">
          <button
            type="button"
            onClick={async () => {
              if (confirm('确定要退出当前阅读器会话吗？')) {
                await logout();
                onClose();
              }
            }}
            className="px-3 py-1.5 rounded-lg border border-surfaceBorder hover:bg-accentRed/10 hover:text-accentRed hover:border-accentRed/30 text-xs text-textMuted transition-colors flex items-center gap-1.5"
          >
            <LogOut size={13} />
            <span>退出登录</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg hover:bg-surfaceBorder text-xs text-textMuted hover:text-textPrimary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>{isSaving ? "正在保存..." : "保存更改"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
