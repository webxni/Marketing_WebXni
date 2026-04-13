import { api } from './client';
import type { SessionUser } from '../types';

export type LoginResponse =
  | { ok: true; user: SessionUser }
  | { ok: false; requires_2fa: true; totp_token: string };

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/login', { email, password }),

  verify2fa: (totp_token: string, code: string) =>
    api.post<{ ok: boolean; user: SessionUser }>('/api/auth/2fa/verify', { totp_token, code }),

  logout: () =>
    api.post<{ ok: boolean }>('/api/auth/logout'),

  me: () =>
    api.get<{ user: SessionUser }>('/api/auth/me'),

  totpStatus: () =>
    api.get<{ enabled: boolean }>('/api/auth/2fa/status'),

  totpSetup: () =>
    api.get<{ uri: string; secret: string }>('/api/auth/2fa/setup'),

  totpEnable: (secret: string, code: string) =>
    api.post<{ ok: boolean }>('/api/auth/2fa/enable', { secret, code }),

  totpDisable: (code: string) =>
    api.post<{ ok: boolean }>('/api/auth/2fa/disable', { code }),
};
