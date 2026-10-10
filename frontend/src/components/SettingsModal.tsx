import React, { useState } from 'react';
import { X, Settings, Check, ShieldCheck, Sparkles, Sliders } from 'lucide-react';
import { ReaderPreferences } from '../types';
import { updateReaderPreferences } from '../api';

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
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    setForm(preferences);
  }, [preferences]);

  if (!isOpen) return null;

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
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-surfaceBorder flex items-center justify-end gap-2 bg-surfaceRaised/40">
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
  );
};
