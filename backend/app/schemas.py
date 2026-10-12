from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
import datetime

# Discussion Post Item
class DiscussionPost(BaseModel):
    post_number: int
    author: str
    posted_at: Optional[str] = None
    content: Optional[str] = ""
    content_html: Optional[str] = ""

# Triage Signal
class TriageSignal(BaseModel):
    dimension: str # quality, promotion, expiry
    effect: float
    evidence: str
    label: str

# Article Schema
class ArticleSchema(BaseModel):
    id: str
    source_id: str
    source_title: str
    group_name: str
    title: str
    clean_title: Optional[str] = None
    url: str
    summary: Optional[str] = None
    content: Optional[str] = None
    bilingual_content: Optional[str] = None
    published_at: datetime.datetime
    fetched_at: datetime.datetime
    image_url: Optional[str] = None
    image_alt: Optional[str] = None
    is_read: bool = False
    is_starred: bool = False
    feedback: Optional[str] = None
    value_score: float = 0.5
    value_tier: str = "general"
    quality_score: float = 0.5
    promotion_score: float = 0.0
    expiry_score: float = 0.0
    content_type: str = "article"
    content_type_label: str = "文章"
    triage_signals: List[Dict[str, Any]] = []
    triage_reason: Optional[str] = None
    ai_value_score: Optional[float] = None
    ai_value_reason: Optional[str] = None
    rank_score: float = 0.0
    needs_triage: bool = False
    discussion_posts: List[Dict[str, Any]] = []

    class Config:
        from_attributes = True

# Feed Source Schema
class FeedSourceSchema(BaseModel):
    id: str
    title: str
    site_url: Optional[str] = None
    feed_url: str
    description: Optional[str] = None
    group_name: str
    status: str = "active"
    article_count: int = 0
    unread_count: int = 0
    last_checked_at: Optional[datetime.datetime] = None
    last_success_at: Optional[datetime.datetime] = None
    last_error: Optional[str] = None

    class Config:
        from_attributes = True

# Reader Preferences Schema
class ReaderPreferencesSchema(BaseModel):
    feed_view: str = "all"
    show_affiliate: bool = False
    show_big_sales: bool = True
    show_deal_alerts: bool = True
    show_sponsored: bool = False
    pure_rule_mode: bool = False
    summary_model: str = "deepseek-v4.1-flash"
    brief_model: str = "gpt-5.6-terra"
    muted_keywords: List[str] = []

    class Config:
        from_attributes = True

# API Action Payloads & Responses
class ListReaderResponse(BaseModel):
    articles: List[ArticleSchema]
    sources: List[FeedSourceSchema]
    preferences: ReaderPreferencesSchema
    last_checked_at: Optional[str] = None
    tier_counts: Optional[Dict[str, int]] = None

class GetArticleInput(BaseModel):
    id: str

class IngestEntry(BaseModel):
    title: str
    url: str
    published_at: Optional[str] = None
    summary: Optional[str] = None
    discussion_posts: Optional[List[Dict[str, Any]]] = None
    image_url: Optional[str] = None

class IngestExternalFeedInput(BaseModel):
    feed_url: str
    entries: List[IngestEntry]

class ActionIDInput(BaseModel):
    id: str

class SetArticleReadInput(BaseModel):
    id: str
    is_read: bool = True

class SetArticleStarredInput(BaseModel):
    id: str
    is_starred: bool = True

class SetArticleFeedbackInput(BaseModel):
    id: str
    feedback: Optional[str] = None # 'like', 'dislike', or None

class MarkAllReadInput(BaseModel):
    group_name: Optional[str] = None
    source_id: Optional[str] = None
    article_ids: Optional[List[str]] = None

class DeleteSourceInput(BaseModel):
    id: str

class UpdateReaderPreferencesInput(BaseModel):
    preferences: Dict[str, Any]

class LoginInput(BaseModel):
    password: str

class AskArticleInput(BaseModel):
    id: str
    question: str
    history: Optional[List[Dict[str, str]]] = []

class AskArticleResponse(BaseModel):
    status: str = "ok"
    answer: str

class ForwardTelegramInput(BaseModel):
    id: str

class ImportOpmlResponse(BaseModel):
    status: str = "ok"
    imported_count: int
    skipped_count: int
    new_sources: List[str]

class DigestRecordSchema(BaseModel):
    id: int
    date: str
    title: str
    content: str
    is_fallback: bool = False
    created_at: datetime.datetime

    class Config:
        from_attributes = True

# Highlights & Annotations Schemas
class ArticleHighlightSchema(BaseModel):
    id: str
    article_id: str
    article_title: Optional[str] = None
    article_url: Optional[str] = None
    text: str
    note: Optional[str] = None
    color: str = "yellow"
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class CreateHighlightInput(BaseModel):
    article_id: str
    text: str
    note: Optional[str] = None
    color: str = "yellow"

class UpdateHighlightInput(BaseModel):
    id: str
    note: Optional[str] = None
    color: Optional[str] = None

class DeleteHighlightInput(BaseModel):
    id: str

class ListHighlightsInput(BaseModel):
    article_id: Optional[str] = None
    limit: int = 100

class ExplainSelectionInput(BaseModel):
    selected_text: str
    article_title: Optional[str] = None
    surrounding_context: Optional[str] = None

class ExplainSelectionResponse(BaseModel):
    status: str = "ok"
    explanation: str

