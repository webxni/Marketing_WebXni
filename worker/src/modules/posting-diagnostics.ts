import type { ClientPlatformRow } from '../types';

export interface UploadPostProfileResponse {
  success?: boolean;
  username?: string;
  social_accounts?: Record<string, unknown> | null;
  profile?: {
    username?: string;
    social_accounts?: Record<string, unknown> | null;
  } | null;
  [key: string]: unknown;
}

export interface ConnectionHealthItem {
  platform: string;
  configured: boolean;
  connected: boolean;
  status: 'connected' | 'warning' | 'failed' | 'not_configured';
  message: string;
  message_es: string;
  details?: Record<string, unknown>;
}

function hasObjectShape(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlatform(platform: string): string {
  return platform.trim().toLowerCase().replace(/[ -]+/g, '_');
}

function getMetaProbePlatform(platform: string): string {
  const normalized = normalizePlatform(platform);
  if (normalized === 'instagram' || normalized === 'threads') return 'facebook';
  return normalized;
}

function getSocialAccountDetails(
  payload: UploadPostProfileResponse | null,
  platform: string,
): Record<string, unknown> | null {
  const socialAccounts =
    (payload?.social_accounts && hasObjectShape(payload.social_accounts) ? payload.social_accounts : null)
    ?? (payload?.profile?.social_accounts && hasObjectShape(payload.profile.social_accounts) ? payload.profile.social_accounts : null);
  if (!socialAccounts) return null;

  const direct = socialAccounts[platform];
  if (hasObjectShape(direct)) return direct;

  const metaFallback = socialAccounts[getMetaProbePlatform(platform)];
  if (hasObjectShape(metaFallback)) return metaFallback;

  return null;
}

export function translatePostingError(raw: string, platform?: string): string {
  const message = raw.trim();
  const lower = message.toLowerCase();
  const platformLabel = platform ? ` en ${platform}` : '';

  if (lower.includes('invalid platforms for text post')) {
    return `La publicación se envió como texto cuando la plataforma requiere un video o imagen${platformLabel}.`;
  }
  if (lower.includes('invalid or expired token')) {
    return `La conexión${platformLabel} expiró o el token ya no es válido. Reconecta la cuenta en Upload-Post.`;
  }
  if (lower.includes('user not found')) {
    return 'El perfil configurado en Upload-Post no existe o no coincide con el cliente.';
  }
  if (lower.includes('job not found')) {
    return 'Upload-Post no encontró el trabajo programado para esta publicación.';
  }
  if (lower.includes('platform not configured')) {
    return `La plataforma${platformLabel} no está configurada para este cliente.`;
  }
  if (lower.includes('no caption')) {
    return `Falta el caption requerido${platformLabel}.`;
  }
  if (lower.includes('page id')) {
    return `Falta el identificador de página requerido${platformLabel}.`;
  }
  if (lower.includes('board id')) {
    return 'Falta el identificador del tablero de Pinterest.';
  }
  if (lower.includes('location id')) {
    return 'Falta el identificador de ubicación de Google Business.';
  }
  if (lower.includes('cta url')) {
    return 'La publicación de Google Business requiere una URL para el botón CTA.';
  }
  if (lower.includes('forbidden term')) {
    return 'El caption contiene un término restringido para este cliente.';
  }
  if (lower.includes('publish_date is more than 7 days in the past')) {
    return 'La fecha de publicación está demasiado en el pasado y la plataforma la rechazó.';
  }
  if (lower.includes('requires asset url') || lower.includes('requires a media asset')) {
    return 'La publicación necesita un archivo de video o imagen válido antes de enviarse.';
  }

  return message;
}

export function getConnectionHealth(
  platform: string,
  cfg: ClientPlatformRow | null,
  profilePayload: UploadPostProfileResponse | null,
  probe: {
    ok: boolean;
    message?: string;
    details?: Record<string, unknown>;
  },
): ConnectionHealthItem {
  const normalized = normalizePlatform(platform);
  const account = getSocialAccountDetails(profilePayload, normalized);
  const configured = !!cfg;

  if (!configured) {
    return {
      platform: normalized,
      configured: false,
      connected: false,
      status: 'not_configured',
      message: 'Platform is not configured for this client.',
      message_es: 'La plataforma no está configurada para este cliente.',
    };
  }

  if (!account) {
    return {
      platform: normalized,
      configured: true,
      connected: false,
      status: 'failed',
      message: 'No connected account found in Upload-Post for this platform.',
      message_es: 'No hay una cuenta conectada en Upload-Post para esta plataforma.',
      details: probe.details,
    };
  }

  if (!probe.ok) {
    return {
      platform: normalized,
      configured: true,
      connected: false,
      status: 'failed',
      message: probe.message ?? 'Provider probe failed.',
      message_es: translatePostingError(probe.message ?? 'La verificación de la plataforma falló.', normalized),
      details: { ...probe.details, social_account: account },
    };
  }

  return {
    platform: normalized,
    configured: true,
    connected: true,
    status: 'connected',
    message: probe.message ?? 'Connection healthy.',
    message_es: 'Conexión activa y válida.',
    details: { ...probe.details, social_account: account },
  };
}
