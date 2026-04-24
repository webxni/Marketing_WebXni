import type { ClientPlatformRow, ClientRow } from '../types';
import { normalizePlatform } from './captions';

export interface PlatformConfigWarning {
  code: string;
  message: string;
}

const UNMAPPED_VALUES = new Set([
  '',
  'NOT_LINKED',
  'PENDING_SETUP',
  'PENDING_LINKEDIN_PAGE_ID',
]);

export function hasMappedValue(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized !== '' && !UNMAPPED_VALUES.has(normalized);
}

export function getPlatformConfigWarnings(
  client: Pick<ClientRow, 'canonical_name' | 'upload_post_profile'>,
  platform: string,
  cfg: Partial<ClientPlatformRow> | null,
): PlatformConfigWarning[] {
  if (!cfg) return [];

  const normalized = normalizePlatform(platform);
  const warnings: PlatformConfigWarning[] = [];

  if (normalized === 'linkedin') {
    if (!hasMappedValue(client.upload_post_profile)) {
      warnings.push({
        code: 'LINKEDIN_NO_UPLOAD_POST_PROFILE',
        message: `LinkedIn is enabled for ${client.canonical_name}, but the Upload-Post profile is missing.`,
      });
    }

    if (!hasMappedValue(cfg.page_id)) {
      warnings.push({
        code: 'LINKEDIN_NO_PAGE_MAPPING',
        message: 'LinkedIn is enabled but no LinkedIn page/account is mapped. Set the LinkedIn page ID before posting.',
      });
    }
  }

  return warnings;
}
