import { Article, FeedSource, ReaderPreferences, DigestRecord, ViewType } from './types';

const API_BASE = '/api/reader';

export async function listReader(params: {
  group_name?: string;
  source_id?: string;
  view?: ViewType;
  search?: string;
}): Promise<{
  articles: Article[];
  sources: FeedSource[];
  preferences: ReaderPreferences;
  last_checked_at: string;
}> {
  const query = new URLSearchParams();
  if (params.group_name && params.group_name !== '全部') query.set('group_name', params.group_name);
  if (params.source_id) query.set('source_id', params.source_id);
  if (params.view) query.set('view', params.view);
  if (params.search) query.set('search', params.search);

  const res = await fetch(`${API_BASE}/listreader?${query.toString()}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Failed to list articles: ${res.statusText}`);
  return res.json();
}

export async function getArticle(id: string): Promise<Article | null> {
  const res = await fetch(`${API_BASE}/getarticle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.article;
}

export async function refreshFeeds(): Promise<void> {
  await fetch(`${API_BASE}/refreshfeeds`, { method: 'POST' });
}

export async function fetchArticleFullText(id: string): Promise<Article> {
  const res = await fetch(`${API_BASE}/fetcharticlefulltext`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || '正文抓取失败');
  return data.article;
}

export async function summarizeArticle(id: string): Promise<Article> {
  const res = await fetch(`${API_BASE}/summarizearticle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || '摘要生成失败');
  return data.article;
}

export async function setArticleRead(id: string, is_read: boolean): Promise<void> {
  await fetch(`${API_BASE}/setarticleread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_read }),
  });
}

export async function setArticleStarred(id: string, is_starred: boolean): Promise<void> {
  await fetch(`${API_BASE}/setarticlestarred`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_starred }),
  });
}

export async function setArticleFeedback(id: string, feedback: 'like' | 'dislike' | null): Promise<void> {
  await fetch(`${API_BASE}/setarticlefeedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, feedback }),
  });
}

export async function markAllRead(params: { group_name?: string; source_id?: string }): Promise<void> {
  await fetch(`${API_BASE}/markallread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function updateReaderPreferences(preferences: Partial<ReaderPreferences>): Promise<ReaderPreferences> {
  const res = await fetch(`${API_BASE}/updatereaderpreferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences }),
  });
  const data = await res.json();
  return data.preferences;
}

export async function generateDailyBrief(): Promise<DigestRecord> {
  const res = await fetch(`${API_BASE}/generatedailybrief`, { method: 'POST' });
  const data = await res.json();
  return data.brief;
}

export async function getDailyBriefs(): Promise<DigestRecord[]> {
  const res = await fetch(`${API_BASE}/dailybriefs`);
  const data = await res.json();
  return data.briefs || [];
}
