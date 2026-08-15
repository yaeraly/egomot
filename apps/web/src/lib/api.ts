const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

function formatMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const data = payload as { message?: unknown; errors?: unknown };
  if (Array.isArray(data.message)) return data.message.join('\n');
  if (typeof data.message === 'string') return data.message;
  if (Array.isArray(data.errors)) return data.errors.join('\n');
  return fallback;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('egomot_token');
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('egomot_token', token);
  else localStorage.removeItem('egomot_token');
}

export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${API_URL}${path}`;
}

export function loginErrorMessage(status: number, backendMessage?: string): string {
  if (status === 401) {
    return 'Email же пароль туура эмес';
  }
  if (status === 0) {
    return `API жеткиликтүү эмес (${API_URL}). Серверди иштетиңиз: npm run dev:api`;
  }
  return backendMessage || 'Кирүү ишке ашкан жок';
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isForm && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(loginErrorMessage(0), 0);
  }

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    setToken(null);
    window.location.href = '/login';
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(
        path.startsWith('/auth/login')
          ? loginErrorMessage(0)
          : 'Серверден туура эмес жооп алынды',
        res.status,
      );
    }
  }

  if (!res.ok) {
    const backendMessage = formatMessage(payload, 'Ошибка запроса');
    const message = path.startsWith('/auth/login')
      ? loginErrorMessage(res.status, backendMessage)
      : backendMessage;
    throw new ApiError(message, res.status, payload);
  }
  return payload as T;
}
