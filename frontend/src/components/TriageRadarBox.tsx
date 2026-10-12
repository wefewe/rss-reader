import React, { useState } from 'react';
import { ShieldCheck, ChevronDown, ChevronUp, Flame, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Article } from '../types';

interface TriageRadarBoxProps {
  article: Article;
}

export const TriageRadarBox: React.FC<TriageRadarBoxProps> = ({ article }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const rankPercent = Math.round((article.rank_score ?? 0.5) * 100);
  const qualityPercent = Math.round((article.quality_score ?? 0.5) * 100);
  const promoPercent = Math.round((article.promotion_score ?? 0) * 100);
  const expiryPercent = Math.round((article.expiry_score ?? 0) * 100);
  const postCount = article.discussion_posts ? article.discussion_posts.length : 0;

  const tierLabel = article.value_tier === 'featured'
    ? '精选高优'
    : article.value_tier === 'hidden'
    ? '低价值折叠'
    : '常规推荐';

  const tierColor = article.value_tier === 'featured'
    ? 'text-featuredBadge bg-featuredBadge/15 border-featuredBadge/30'
    : article.value_tier === 'hidden'
    ? 'text-textMuted bg-surfaceRaised border-surfaceBorder'
    : 'text-accent bg-accent/15 border-accent/30';

  return (
    <div className="pt-2 border-t border-surfaceBorder/60 select-none">
      {/* Clickable Header Bar */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between cursor-pointer py-1 px-1 rounded-lg hover:bg-surfaceRaised/50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="flex items-center gap-1 font-semibold text-textPrimary text-[11px]">
            <ShieldCheck size={13} className="text-accent" />
            AI 价值研判透镜:
          </span>

          <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${tierColor}`}>
            {tierLabel} ({rankPercent}分)
          </span>

          {article.triage_signals && article.triage_signals.length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {article.triage_signals.slice(0, 3).map((sig, idx) => (
                <span
                  key={idx}
                  className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                    sig.effect > 0 
                      ? 'bg-accentGreen/10 text-accentGreen border border-accentGreen/20' 
                      : 'bg-accentRed/10 text-accentRed border border-accentRed/20'
                  }`}
                  title={sig.evidence}
                >
                  {sig.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <button className="text-[11px] text-textMuted flex items-center gap-0.5 hover:text-textPrimary transition-colors">
          <span>{isExpanded ? '收起透镜' : '展开多维分析'}</span>
          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Expanded Multi-Dimensional Breakdown */}
      {isExpanded && (
        <div className="mt-3 p-3.5 rounded-xl bg-surface/80 border border-surfaceBorder space-y-3.5 text-xs animate-in fade-in duration-150">
          {/* Main verdict rationale */}
          {article.triage_reason && (
            <div className="flex items-start gap-2 text-[11px] text-textPrimary/90 bg-surfaceRaised/60 p-2 rounded-lg border border-surfaceBorder/80">
              <Info size={13} className="text-accent shrink-0 mt-0.5" />
              <span><b>判决依据</b>：{article.triage_reason}</span>
            </div>
          )}

          {/* 4-Dimension Progress Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            {/* Quality Score */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-textMuted">
                <span>💎 信息质量 (Quality)</span>
                <span className="font-mono font-medium text-textPrimary">{qualityPercent}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-surfaceRaised overflow-hidden">
                <div 
                  className="h-full bg-accentGreen transition-all" 
                  style={{ width: `${qualityPercent}%` }} 
                />
              </div>
            </div>

            {/* Promotion Score */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-textMuted">
                <span>📢 营销推广 (Promotion)</span>
                <span className={`font-mono font-medium ${promoPercent >= 60 ? 'text-accentRed' : 'text-textPrimary'}`}>
                  {promoPercent}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-surfaceRaised overflow-hidden">
                <div 
                  className={`h-full transition-all ${promoPercent >= 60 ? 'bg-accentRed' : 'bg-accent'}`} 
                  style={{ width: `${promoPercent}%` }} 
                />
              </div>
            </div>

            {/* Expiry Score */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-textMuted">
                <span>⏳ 时效失效 (Expiry)</span>
                <span className={`font-mono font-medium ${expiryPercent >= 50 ? 'text-accentRed' : 'text-textPrimary'}`}>
                  {expiryPercent}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-surfaceRaised overflow-hidden">
                <div 
                  className={`h-full transition-all ${expiryPercent >= 50 ? 'bg-accentRed' : 'bg-textMuted/60'}`} 
                  style={{ width: `${expiryPercent}%` }} 
                />
              </div>
            </div>

            {/* Engagement Discussion */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-textMuted">
                <span>💬 社区互动热度</span>
                <span className="font-mono font-medium text-textPrimary">{postCount} 楼回帖</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-surfaceRaised overflow-hidden">
                <div 
                  className="h-full bg-featuredBadge transition-all" 
                  style={{ width: `${Math.min(100, postCount * 5)}%` }} 
                />
              </div>
            </div>
          </div>

          {/* Full Signals List with evidence */}
          {article.triage_signals && article.triage_signals.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-surfaceBorder/60">
              <span className="text-[10px] font-semibold text-textMuted uppercase tracking-wider">
                判定信号流证据清单
              </span>
              <div className="grid grid-cols-1 gap-1.5">
                {article.triage_signals.map((sig, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between text-[11px] p-1.5 px-2 rounded-lg bg-surfaceRaised/40 border border-surfaceBorder/60"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sig.effect > 0 ? 'bg-accentGreen' : 'bg-accentRed'}`} />
                      <span className="font-medium text-textPrimary shrink-0">{sig.label}</span>
                      <span className="text-textMuted/70 truncate text-[10px]">({sig.evidence})</span>
                    </div>
                    <span className={`font-mono text-[10px] font-semibold shrink-0 ${sig.effect > 0 ? 'text-accentGreen' : 'text-accentRed'}`}>
                      {sig.effect > 0 ? `+${sig.effect}` : sig.effect}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
