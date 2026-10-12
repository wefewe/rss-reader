import React from 'react';

/**
 * Bionic Reading (仿生阅读) 算法：
 * 对词汇的前半部分进行视觉加粗 (Fixation Point)，引导眼跳定焦，大幅提升长文跳读扫读效率。
 */
export function formatBionicContent(text: string): React.ReactNode[] {
  if (!text) return [];

  // Split text by word boundaries, spaces, and punctuations while preserving delimiters
  const tokens = text.split(/(\s+|[，。！？、；：“”‘’（）《》\n\t])/);

  return tokens.map((token, idx) => {
    if (!token || /^\s+$/.test(token) || /^[，。！？、；：“”‘’（）《》]+$/.test(token)) {
      return token;
    }

    // English word or code/number identifier
    if (/^[a-zA-Z0-9_\-\.]+$/.test(token)) {
      const mid = Math.max(1, Math.ceil(token.length * 0.45));
      const boldPart = token.slice(0, mid);
      const rest = token.slice(mid);
      return (
        <span key={idx} className="bionic-word">
          <strong className="font-bold text-textPrimary">{boldPart}</strong>
          <span className="opacity-80">{rest}</span>
        </span>
      );
    }

    // Chinese characters phrase
    if (/[\u4e00-\u9fa5]/.test(token)) {
      const elements: React.ReactNode[] = [];
      for (let i = 0; i < token.length; i++) {
        // Alternate bolding to guide saccadic reading rhythm
        if (i % 2 === 0) {
          elements.push(
            <strong key={i} className="font-bold text-textPrimary">
              {token[i]}
            </strong>
          );
        } else {
          elements.push(
            <span key={i} className="opacity-80">
              {token[i]}
            </span>
          );
        }
      }
      return <span key={idx} className="bionic-zh">{elements}</span>;
    }

    return token;
  });
}
