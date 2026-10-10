import React from 'react';
import { MessageSquare, User, Clock } from 'lucide-react';
import { DiscussionPost } from '../types';

interface DiscussionPostsProps {
  posts: DiscussionPost[];
}

export const DiscussionPosts: React.FC<DiscussionPostsProps> = ({ posts }) => {
  if (!posts || posts.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-surfaceBorder space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-textPrimary">
          社区回帖讨论 ({posts.length} 条)
        </h3>
      </div>

      <div className="space-y-3">
        {posts.map((post) => (
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
                className="text-xs text-textPrimary/90 leading-relaxed prose prose-invert prose-sm max-w-none break-words"
                dangerouslySetInnerHTML={{ __html: post.content_html }}
              />
            ) : (
              <p className="text-xs text-textPrimary/90 leading-relaxed whitespace-pre-wrap break-words">
                {post.content}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
