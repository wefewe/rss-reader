import datetime
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Boolean,
    Text,
    DateTime,
    JSON,
    Index,
)
from .database import Base

class FeedSource(Base):
    __tablename__ = "feed_sources"

    id = Column(String(100), primary_key=True)
    title = Column(String(255), nullable=False)
    site_url = Column(String(500), nullable=True)
    feed_url = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    group_name = Column(String(100), nullable=False)
    status = Column(String(50), default="active")
    article_count = Column(Integer, default=0)
    unread_count = Column(Integer, default=0)
    last_checked_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

class Article(Base):
    __tablename__ = "articles"

    # Composite primary key format: "source_id\nurl"
    id = Column(String(1000), primary_key=True)
    source_id = Column(String(100), nullable=False, index=True)
    source_title = Column(String(255), nullable=False)
    group_name = Column(String(100), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    clean_title = Column(String(500), nullable=True)
    url = Column(Text, nullable=False, index=True)
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    published_at = Column(DateTime, nullable=False, index=True)
    fetched_at = Column(DateTime, default=datetime.datetime.utcnow)
    image_url = Column(Text, nullable=True)
    image_alt = Column(Text, nullable=True)
    
    is_read = Column(Boolean, default=False, index=True)
    is_starred = Column(Boolean, default=False, index=True)
    feedback = Column(String(20), nullable=True) # 'like', 'dislike', or null

    # Value triage & scoring
    value_score = Column(Float, default=0.5)
    value_tier = Column(String(50), default="general", index=True) # 'featured', 'general', 'hidden'
    quality_score = Column(Float, default=0.5)
    promotion_score = Column(Float, default=0.0)
    expiry_score = Column(Float, default=0.0)
    content_type = Column(String(50), default="article")
    content_type_label = Column(String(50), default="文章")
    triage_signals = Column(JSON, default=list) # [{dimension, effect, evidence, label}]
    triage_reason = Column(Text, nullable=True)
    ai_value_score = Column(Float, nullable=True)
    ai_value_reason = Column(Text, nullable=True)
    rank_score = Column(Float, default=0.0, index=True)
    needs_triage = Column(Boolean, default=False)

    # Discussions (for LINUX DO or comments)
    discussion_posts = Column(JSON, default=list) # [{post_number, author, posted_at, content, content_html}]

class ArticleImage(Base):
    __tablename__ = "article_images"

    id = Column(String(500), primary_key=True)
    article_id = Column(String(1000), nullable=False, index=True)
    url = Column(Text, nullable=False)
    blob_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class ReaderPreference(Base):
    __tablename__ = "reader_preferences"

    id = Column(Integer, primary_key=True, default=1)
    feed_view = Column(String(50), default="all")
    show_affiliate = Column(Boolean, default=False)
    show_big_sales = Column(Boolean, default=True)
    show_deal_alerts = Column(Boolean, default=True)
    show_sponsored = Column(Boolean, default=False)
    pure_rule_mode = Column(Boolean, default=False)
    summary_model = Column(String(100), default="deepseek-v4.1-flash")
    brief_model = Column(String(100), default="gpt-5.6-terra")
    muted_keywords = Column(JSON, default=list)

class DigestRecord(Base):
    __tablename__ = "digest_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(20), nullable=False, index=True) # YYYY-MM-DD
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False) # Markdown
    is_fallback = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class ArticleHighlight(Base):
    __tablename__ = "article_highlights"

    id = Column(String(100), primary_key=True)
    article_id = Column(String(1000), nullable=False, index=True)
    article_title = Column(String(500), nullable=True)
    article_url = Column(Text, nullable=True)
    text = Column(Text, nullable=False)
    note = Column(Text, nullable=True)
    color = Column(String(20), default="yellow") # yellow, green, red, purple
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

