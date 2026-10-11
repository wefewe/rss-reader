import { Article, FeedSource, ReaderPreferences, DigestRecord, ViewType } from './types';

const API_BASE = '/api/reader';
const TOKEN_KEY = 'reader_auth_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && !url.includes('/auth/')) {
    // Session expired or invalid
    removeAuthToken();
    window.dispatchEvent(new Event('reader_unauthorized'));
  }
  return res;
}

export async function checkAuth(): Promise<{ authed: boolean; auth_required: boolean }> {
  try {
    const res = await request(`${API_BASE}/auth/check`);
    if (res.ok) {
      return res.json();
    }
  } catch (e) {
    console.error(e);
  }
  return { authed: false, auth_required: true };
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data.token) {
      setAuthToken(data.token);
      return true;
    }
  }
  return false;
}

export async function logout(): Promise<void> {
  try {
    await request(`${API_BASE}/auth/logout`, { method: 'POST' });
  } finally {
    removeAuthToken();
    window.dispatchEvent(new Event('reader_unauthorized'));
  }
}

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

  const res = await request(`${API_BASE}/listreader?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to list articles: ${res.statusText}`);
  return res.json();
}

export async function getArticle(id: string): Promise<Article | null> {
  const res = await request(`${API_BASE}/getarticle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.article;
}

export async function refreshFeeds(): Promise<void> {
  await request(`${API_BASE}/refreshfeeds`, { method: 'POST' });
}

export async function fetchArticleFullText(id: string): Promise<Article> {
  const res = await request(`${API_BASE}/fetcharticlefulltext`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || '正文抓取失败');
  return data.article;
}

export async function summarizeArticle(id: string): Promise<Article> {
  const res = await request(`${API_BASE}/summarizearticle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || '摘要生成失败');
  return data.article;
}

export async function setArticleRead(id: string, is_read: boolean): Promise<void> {
  await request(`${API_BASE}/setarticleread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_read }),
  });
}

export async function setArticleStarred(id: string, is_starred: boolean): Promise<void> {
  await request(`${API_BASE}/setarticlestarred`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_starred }),
  });
}

export async function setArticleFeedback(id: string, feedback: 'like' | 'dislike' | null): Promise<void> {
  await request(`${API_BASE}/setarticlefeedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, feedback }),
  });
}

export async function markAllRead(params: { group_name?: string; source_id?: string }): Promise<void> {
  await request(`${API_BASE}/markallread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function updateReaderPreferences(preferences: Partial<ReaderPreferences>): Promise<ReaderPreferences> {
  const res = await request(`${API_BASE}/updatereaderpreferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences }),
  });
  const data = await res.json();
  return data.preferences;
}

export async function generateDailyBrief(): Promise<DigestRecord> {
  const res = await request(`${API_BASE}/generatedailybrief`, { method: 'POST' });
  const data = await res.json();
  return data.brief;
}

export async function getDailyBriefs(): Promise<DigestRecord[]> {
  const res = await request(`${API_BASE}/dailybriefs`);
  const data = await res.json();
  return data.briefs || [];
}

export async function askArticle(
  id: string,
  question: string,
  history?: { role: string; content: string }[]
): Promise<string> {
  const res = await request(`${API_BASE}/article/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, question, history: history || [] }),
  });
  const data = await res.json();
  return data.answer || '未能获取回答，请稍后重试。';
}

