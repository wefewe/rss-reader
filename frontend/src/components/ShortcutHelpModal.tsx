import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'J', desc: '阅读下一篇文章（列表自动平滑随动）' },
  { key: 'K', desc: '阅读上一篇文章' },
  { key: 'M', desc: '切换当前文章已读 / 未读状态' },
  { key: 'S', desc: '切换星标收藏状态' },
  { key: 'O', desc: '在新标签页跳转打开原文' },
  { key: 'Z', desc: '切换桌面专注全屏阅读模式 (Zen Mode)' },
  { key: '/', desc: '快速聚焦文章搜索输入框' },
  { key: '?', desc: '打开 / 关闭本快捷键帮助面板' },
  { key: 'Esc', desc: '关闭弹窗 / 退出放大预览' },
];

export const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div 
        className="bg-surface border border-surfaceBorder rounded-2xl w-full max-w-md shadow-2xl overflow-hidden p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surfaceBorder/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-accent/15 text-accent">
              <Keyboard size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-textPrimary">全键盘极速流快捷键</h3>
              <p className="text-[11px] text-textMuted">纯键盘操作即可流畅完成日常资讯摄取</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surfaceRaised"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 text-xs">
          {SHORTCUTS.map(sc => (
            <div 
              key={sc.key}
              className="flex items-center justify-between p-2 rounded-lg bg-surfaceRaised/50 border border-surfaceBorder/60"
            >
              <span className="text-textPrimary/90">{sc.desc}</span>
              <kbd className="px-2 py-0.5 rounded-md bg-surface border border-surfaceBorder font-mono font-bold text-accent text-xs shadow-xs">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-textMuted/60 text-center font-mono pt-1">
          提示：在任何输入框外均可直接敲击生效
        </p>
      </div>
    </div>
  );
};
