import { useState } from 'react';

export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined
    ? { method: 'GET' }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json() as { error: string };
    throw new Error(result.error);
  }
  return response.json() as Promise<T>;
}

export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function run(action: () => Promise<void>, message = '') {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, success, run };
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function displayDate(value: string | null) {
  if (!value) return '未安排';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return new Intl.DateTimeFormat('zh-CN', { year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric' }).format(date);
}
