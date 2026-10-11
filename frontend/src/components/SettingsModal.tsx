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
  Loader2 
} from 'lucide-react';
import { ReaderPreferences } from '../types';
import { updateReaderPreferences, logout, downloadOpmlExport, importOpmlFile } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: ReaderPreferences;
  onPreferencesUpdated: (newPref: ReaderPreferences) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  preferences,
  onPreferencesUpdated,
}) => {
  const [form, setForm] = useState<ReaderPreferences>(preferences);
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingOpml, setIsExportingOpml] = useState(false);
  const [isImportingOpml, setIsImportingOpml] = useState(false);
  const [importResult, setImportResult] = useState<{ message: string; success: boolean } | null>(null);
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
        message: `成功导入 ${res.imported_count} 个新订阅源（跳过已存在 ${res.skipped_count} 个），正在后台首轮抓取！`
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

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-surfaceBorder rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in duration-200">
        {/* Header */}
        <div className="p-4 px-6 border-b border-surfaceBorder flex items-center justify-between bg-surfaceRaised/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent/15 text-accent">
              <Settings size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-textPrimary">阅读偏好与 AI 模型设置</h2>
              <p className="text-xs text-textMuted">按需定制促销类型放行与大模型调度</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surfaceBorder text-textMuted hover:text-textPrimary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs text-textPrimary max-h-[70vh] overflow-y-auto">
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

              {/* Tag Cloud */}
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

              {/* Add Input */}
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

          {/* AI Settings Section */}
          <div className="space-y-3">
            <h3 className="font-semibold text-textMuted uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Sparkles size={13} className="text-featuredBadge" />
              AxonHub 模型调度
            </h3>
            <div className="space-y-3 bg-surfaceRaised/50 p-3.5 rounded-xl border border-surfaceBorder">
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

              <div className="space-y-1">
                <label className="text-[11px] text-textMuted">日常文章摘要模型</label>
                <input
                  type="text"
                  value={form.summary_model}
                  onChange={(e) => setForm({ ...form, summary_model: e.target.value })}
                  placeholder="deepseek-v4.1-flash"
                  className="w-full bg-surface border border-surfaceBorder rounded-lg px-3 py-1.5 text-xs text-textPrimary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-textMuted">每日 09:00 早报生成模型</label>
                <input
                  type="text"
                  value={form.brief_model}
                  onChange={(e) => setForm({ ...form, brief_model: e.target.value })}
                  placeholder="gpt-5.6-terra"
                  className="w-full bg-surface border border-surfaceBorder rounded-lg px-3 py-1.5 text-xs text-textPrimary font-mono focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          {/* OPML Management Section */}
          <div className="space-y-3">
            <h3 className="font-semibold text-textMuted uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Download size={13} className="text-accent" />
              订阅源管理与 OPML 备份 / 迁移
            </h3>
            <div className="space-y-3 bg-surfaceRaised/50 p-3.5 rounded-xl border border-surfaceBorder">
              <p className="text-[11px] text-textMuted">
                导出通用标准 OPML 订阅树，或从 Inoreader、Feedly、NetNewsWire 导入其他 RSS 订阅源。
              </p>

              <div className="flex items-center gap-2">
                {/* Export Button */}
                <button
                  type="button"
                  onClick={handleExportOpml}
                  disabled={isExportingOpml}
                  className="flex-1 py-2 px-3 rounded-xl bg-surface border border-surfaceBorder hover:border-accent hover:text-accent text-xs font-medium text-textPrimary transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  {isExportingOpml ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span>导出 OPML 备份</span>
                </button>

                {/* Import Button */}
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
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-surfaceBorder flex items-center justify-between bg-surfaceRaised/40">
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
