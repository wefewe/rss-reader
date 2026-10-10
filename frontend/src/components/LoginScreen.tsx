import React, { useState } from 'react';
import { BookOpen, Lock, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { login } from '../api';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('请输入访问密码');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const ok = await login(password.trim());
      if (ok) {
        onLoginSuccess();
      } else {
        setError('密码错误，请重新输入');
      }
    } catch (err: any) {
      setError(err?.message || '连接失败，请检查网络');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Background ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm z-10 space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-surfaceRaised border border-surfaceBorder text-accent shadow-lg mb-1">
            <BookOpen size={28} />
          </div>
          <h1 className="text-xl font-bold text-textPrimary tracking-tight flex items-center justify-center gap-2">
            数字图书馆
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent/20 text-accent uppercase font-bold">
              AI Reader
            </span>
          </h1>
          <p className="text-xs text-textMuted">私人订阅流 • 全文提纯 • 智能早报</p>
        </div>

        {/* Login form card */}
        <div className="bg-surface border border-surfaceBorder rounded-2xl p-6 shadow-2xl space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-textMuted flex items-center justify-between">
                <span>访问门禁口令</span>
                <span className="text-[10px] text-textMuted/70 flex items-center gap-1 font-mono">
                  <ShieldCheck size={11} className="text-accentGreen" />
                  30天免密会话
                </span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={15} />
                <input
                  type="password"
                  autoFocus
                  placeholder="请输入密码..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-surfaceRaised border border-surfaceBorder rounded-xl pl-9 pr-3 py-2 text-sm text-textPrimary placeholder:text-textMuted/50 focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-accentRed/10 border border-accentRed/30 text-accentRed text-xs flex items-center gap-2 animate-in fade-in">
                <AlertCircle size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-all flex items-center justify-center gap-2 shadow-md shadow-accent/20 disabled:opacity-50 cursor-pointer"
            >
              <span>{isLoading ? '正在验证...' : '进入阅读空间'}</span>
              <ArrowRight size={14} />
            </button>
          </form>
        </div>

        <p className="text-[11px] text-textMuted/60 text-center font-mono">
          Powered by AxonHub • Swarm Reachable
        </p>
      </div>
    </div>
  );
};
