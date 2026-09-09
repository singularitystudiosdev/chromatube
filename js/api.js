/* ChromaTube API client. One place that knows every endpoint and the error shape. */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (err) { data = null; }
  }

  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const Api = {
  signup: (email, password) => request('/api/auth/signup', { method: 'POST', body: { email, password } }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  catalog: () => request('/api/catalog'),
  checkout: (pack_id) => request('/api/checkout', { method: 'POST', body: { pack_id } }),
  paypalConfig: () => request('/api/paypal/config'),
  paypalOrder: (pack_id) => request('/api/paypal/order', { method: 'POST', body: { pack_id } }),
  paypalCapture: (order_id) => request('/api/paypal/capture', { method: 'POST', body: { order_id } }),
  connectChannel: (payload) =>
    request('/api/channel/connect', { method: 'POST', body: payload }),
  channelCredentials: () => request('/api/channel/credentials'),
  createSchedule: (niche_idea, cadence, time_utc) =>
    request('/api/schedules', { method: 'POST', body: { niche_idea, cadence, time_utc } }),
  schedules: () => request('/api/schedules'),
  videos: () => request('/api/videos'),
  earnings: () => request('/api/earnings'),
  learnings: () => request('/api/learnings'),
  experimentAssignment: () => request('/api/experiments/assignment'),
  experimentEvent: (event, detail) =>
    request('/api/experiments/event', { method: 'POST', body: { event, detail } }),
};
