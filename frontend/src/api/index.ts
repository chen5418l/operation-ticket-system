/* API 请求封装 */

const BASE_URL = 'http://localhost:8000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }
  return res.json();
}

export const api = {
  getDashboardSummary: () =>
    request<any>('/api/dashboard/summary'),

  getDataObjects: () =>
    request<any>('/api/data-management/objects'),

  getDataRules: () =>
    request<any>('/api/data-management/rules'),

  getForecastRisks: () =>
    request<any>('/api/forecast/risks'),

  judgeBoundary: (data: any) =>
    request<any>('/api/boundary/judge', { method: 'POST', body: JSON.stringify(data) }),

  decideTransfer: (data: any) =>
    request<any>('/api/transfer/decide', { method: 'POST', body: JSON.stringify(data) }),

  generateSequence: (data: any) =>
    request<any>('/api/sequence/generate', { method: 'POST', body: JSON.stringify(data) }),

  generateTicket: (data: any) =>
    request<any>('/api/ticket/generate', { method: 'POST', body: JSON.stringify(data) }),

  checkSafety: (data: any) =>
    request<any>('/api/safety/check', { method: 'POST', body: JSON.stringify(data) }),

  getStatistics: () =>
    request<any>('/api/test/statistics'),

  getTicket: (ticketId: string) =>
    request<any>(`/api/ticket/${ticketId}`),

  exportTicket: (ticketId: string) =>
    request<any>(`/api/ticket/${ticketId}/export`),
};
