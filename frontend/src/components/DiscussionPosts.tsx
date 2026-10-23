import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import { MessageSquare, User, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { DiscussionPost } from '../types';

interface DiscussionPostsProps {
  posts: DiscussionPost[];
}

const COLLAPSED_LIMIT = 5;

export const DiscussionPosts: React.FC<DiscussionPostsProps> = ({ posts }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (!posts || posts.length === 0) return null;

  const visiblePosts = isExpanded || posts.length <= COLLAPSED_LIMIT 
    ? posts 
    : posts.slice(0, COLLAPSED_LIMIT);

  return (
    <div className="mt-8 pt-6 border-t border-surfaceBorder space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-textPrimary">
            社区回帖讨论 ({posts.length} 条)
          </h3>
        </div>

        {posts.length > COLLAPSED_LIMIT && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-accent hover:underline flex items-center gap-1 font-medium select-none"
          >
            <span>{isExpanded ? '收起讨论' : `展开全部 (${posts.length} 条)`}</span>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {visiblePosts.map((post) => (
          <div
            key={post.post_number}
            className="p-3.5 rounded-xl bg-surface/60 border border-surfaceBorder/80 space-y-2 hover:border-surfaceBorder transition-colors"
          >
            {/* Header: Author + Post Number + Time */}
            <div className="flex items-center justify-between text-xs text-textMuted border-b border-surfaceBorder/40 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-[10px]">
                  {post.author ? post.author.slice(0, 1).toUpperCase() : <User size={10} />}
                </div>
                <span className="font-medium text-textPrimary">{post.author}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                {post.posted_at && (
                  <span className="flex items-center gap-1 text-textMuted/70">
                    <Clock size={11} />
                    {post.posted_at.split('T')[0]}
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-surfaceRaised text-textMuted">
                  #{post.post_number}
                </span>
              </div>
            </div>

            {/* Post Content */}
            {post.content_html ? (
              <div 
                className="text-xs text-textPrimary/90 leading-relaxed prose prose-sm max-w-none break-words"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content_html) }}
              />
            ) : (
              <p className="text-xs text-textPrimary/90 leading-relaxed whitespace-pre-wrap break-words">
                {post.content}
              </p>
            )}
          </div>
        ))}
      </div>

      {posts.length > COLLAPSED_LIMIT && !isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full py-2.5 rounded-xl border border-dashed border-surfaceBorder text-xs text-textMuted hover:text-accent hover:border-accent/40 bg-surfaceRaised/30 transition-colors flex items-center justify-center gap-1.5"
        >
          <ChevronDown size={14} />
          <span>点击展开其余 {posts.length - COLLAPSED_LIMIT} 条社区回复</span>
        </button>
      )}
    </div>
  );
};
