'use strict';

async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// GET a list that reports how many rows match in the X-Total-Count header
async function apiList(path) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  const rows = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(rows.error || `HTTP ${res.status}`);
  return { rows, total: Number(res.headers.get('X-Total-Count')) || rows.length };
}
