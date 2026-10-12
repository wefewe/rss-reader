export interface DiscussionPost {
  post_number: number;
  author: string;
  posted_at?: string;
  content: string;
  content_html?: string;
}

export interface TriageSignal {
  dimension: string;
  effect: number;
  evidence: string;
  label: string;
}

export interface Article {
  id: string;
  source_id: string;
  source_title: string;
  group_name: string;
  title: string;
  clean_title?: string;
  url: string;
  summary?: string;
  content?: string;
  bilingual_content?: string;
  published_at: string;
  fetched_at: string;
  image_url?: string;
  image_alt?: string;
  is_read: boolean;
  is_starred: boolean;
  feedback?: 'like' | 'dislike' | null;
  value_score: number;
  value_tier: 'featured' | 'general' | 'hidden';
  quality_score: number;
  promotion_score: number;
  expiry_score: number;
  content_type: string;
  content_type_label: string;
  triage_signals?: TriageSignal[];
  triage_reason?: string;
  rank_score: number;
  discussion_posts?: DiscussionPost[];
}

export interface FeedSource {
  id: string;
  title: string;
  site_url?: string;
  feed_url: string;
  description?: string;
  group_name: string;
  status: string;
  article_count: number;
  unread_count: number;
  last_checked_at?: string;
  last_success_at?: string;
  last_error?: string;
}

export interface ReaderPreferences {
  feed_view: string;
  show_affiliate: boolean;
  show_big_sales: boolean;
  show_deal_alerts: boolean;
  show_sponsored: boolean;
  pure_rule_mode: boolean;
  summary_model: string;
  brief_model: string;
  muted_keywords?: string[];
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DigestRecord {
  id: number;
  date: string;
  title: string;
  content: string;
  is_fallback: boolean;
  created_at: string;
}

export interface ArticleHighlight {
  id: string;
  article_id: string;
  article_title?: string;
  article_url?: string;
  text: string;
  note?: string;
  color: 'yellow' | 'green' | 'red' | 'purple';
  created_at: string;
}

export type ViewType = 'all' | 'unread' | 'starred' | 'featured' | 'highlights';
export type ThemeMode = 'dark' | 'light' | 'sepia';
