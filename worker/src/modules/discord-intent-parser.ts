/**
 * Discord Intent Parser
 *
 * Parses natural language commands from Marvin in Spanish and English.
 * Extracts semantic intent, client names, date ranges, and action modifiers.
 *
 * Fixes misunderstandings like:
 * - "todos los clientes" → all active clients
 * - "revisa todos los posts de esta semana" → review + list posts for this week
 * - "Junio 1 hasta 5" → date range June 1-5
 * - "#5" → resolve to item 5 from previous numbered list
 */

export interface ParsedIntent {
  intent: string;
  // 'list_all_clients' | 'list_posts' | 'review_posts' | 'repair_captions'
  // | 'replace_post' | 'delete_and_regenerate' | 'get_status' | 'general_chat'

  clients?: string[];
  // Client slugs or names mentioned

  dateRange?: {
    start: string; // ISO date YYYY-MM-DD
    end: string; // ISO date YYYY-MM-DD
  };

  postTitle?: string;
  postId?: string;

  numberReference?: number;
  // When user says "#5" — the index (1-based) to resolve

  actionModifiers?: {
    repair?: boolean;
    replace?: boolean;
    delete?: boolean;
    regenerate?: boolean;
    review?: boolean;
  };

  confidence: number;
  // 0.0-1.0: how confident the parser is in this intent
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────────────────────────────────────

const ENGLISH_PATTERNS = {
  list_all_clients: /\b(all\s+clients?|all\s+active\s+clients?|every\s+client|all\s+accounts)\b/i,
  list_posts: /\b(list|show|fetch|get|view)\s+posts?\b/i,
  review_posts: /\b(review|audit|check|examine)\s+(all\s+)?posts?\b/i,
  repair_captions: /\b(repair|fix|rewrite|update)\s+(the\s+)?(captions?|copy|content)\b/i,
  replace_post: /\b(replace|rewrite|redo|redo|redo|recreate|regenerate)\s+(this|that|the)?\s+post\b/i,
  delete_and_regenerate: /\b(delete|remove|drop)\s+(all\s+)?(posts?|content|drafts?)\s+(and|then|and then)\s+(regenerate|recreate|redo)\b/i,
  get_status: /\b(status|health|check|how\s+are\s+things?|what\s+is|latest)\b/i,
  period_this_week: /\bthis\s+week\b/i,
  period_next_week: /\bnext\s+week\b/i,
};

const SPANISH_PATTERNS = {
  list_all_clients: /\b(todos\s+los\s+clientes?|todos\s+los\s+clientes?\s+activos?|cada\s+cliente|todas\s+las\s+cuentas?)\b/i,
  list_posts: /\b(lista|muestra|obtén?|ve?r|fetch|traer)\s+(los\s+)?(posts?|publicaciones?|contenido)\b/i,
  review_posts: /\b(revisa|audita|chequea|examina)\s+(todos?\s+)?(los\s+)?(posts?|publicaciones?|contenido)\b/i,
  repair_captions: /\b(repara|arregla|reescribe|actualiza)\s+(el\s+)?(caption|captions?|texto|copia|contenido)\b/i,
  replace_post: /\b(reemplaza|reescribe|rehace?|recrea)\s+(este?|ese|el|la)?\s+(post|publicación?|contenido)\b/i,
  delete_and_regenerate: /\b(elimina|borra|suprime)\s+(todos?\s+)?(los\s+)?(posts?|publicaciones?|contenido|borradores?)\s+(y|luego|y luego)\s+(regenera|recrea|rehace?)\b/i,
  period_this_week: /\b(esta\s+semana?)\b/i,
  period_next_week: /\b(próxima\s+semana?|siguiente\s+semana?)\b/i,
};

// ─────────────────────────────────────────────────────────────────────────────
// Date Range Parsing
// ─────────────────────────────────────────────────────────────────────────────

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const SPANISH_MONTH_ABBR: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

export function parseSpanishDateRange(text: string): { start: string; end: string } | null {
  // Pattern: "Junio 1 hasta 5 de junio"
  // Expected: June 1 to June 5
  const monthNames = Object.keys(SPANISH_MONTHS).join('|');
  const pattern = new RegExp(
    `(${monthNames})\\s+(\\d{1,2})\\s+(hasta|al?)\\s+(\\d{1,2})\\s+de\\s+(${monthNames})?`,
    'i'
  );
  const match = text.match(pattern);
  if (!match) return null;

  const startMonth = SPANISH_MONTHS[match[1].toLowerCase()] || 1;
  const startDay = parseInt(match[2], 10);
  const endDay = parseInt(match[4], 10);
  const endMonth = match[5] ? SPANISH_MONTHS[match[5].toLowerCase()] : startMonth;

  const year = new Date().getFullYear();
  const start = new Date(Date.UTC(year, startMonth - 1, startDay)).toISOString().split('T')[0];
  const end = new Date(Date.UTC(year, endMonth - 1, endDay)).toISOString().split('T')[0];

  return { start, end };
}

export function parseEnglishDateRange(text: string): { start: string; end: string } | null {
  // Pattern: "June 1 to 5" or "June 1 through June 5"
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ].join('|');
  const pattern = new RegExp(
    `(${monthNames})\\s+(\\d{1,2})\\s+(to|through|\\-)\\s+(?:(\\d{1,2})\\s+)?(${monthNames})?`,
    'i'
  );
  const match = text.match(pattern);
  if (!match) return null;

  const monthMap: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const startMonth = monthMap[match[1].toLowerCase()] || 1;
  const startDay = parseInt(match[2], 10);
  const endDay = match[4] ? parseInt(match[4], 10) : startDay;
  const endMonth = match[5] ? monthMap[match[5].toLowerCase()] : startMonth;

  const year = new Date().getFullYear();
  const start = new Date(Date.UTC(year, startMonth - 1, startDay)).toISOString().split('T')[0];
  const end = new Date(Date.UTC(year, endMonth - 1, endDay)).toISOString().split('T')[0];

  return { start, end };
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent Parser
// ─────────────────────────────────────────────────────────────────────────────

export function parseIntent(message: string): ParsedIntent {
  const normalized = message.toLowerCase();
  const isSpanish = /[À-ſ]/.test(message) || // has accents
    /\b(todos|el|la|los|las|y|que|de|en|para|por|clientes?|posts?|semana)\b/i.test(message);

  // Check for number reference: "#5", "#10", etc.
  const numberMatch = message.match(/#(\d+)/);
  const numberReference = numberMatch ? parseInt(numberMatch[1], 10) : undefined;

  if (numberReference) {
    return {
      intent: 'resolve_numbered_item',
      numberReference,
      confidence: 0.95,
    };
  }

  const patterns = isSpanish ? SPANISH_PATTERNS : ENGLISH_PATTERNS;
  let highestConfidence = 0;
  let matchedIntent = 'general_chat';

  for (const [intent, regex] of Object.entries(patterns)) {
    if (intent.startsWith('period_')) continue;
    if (regex.test(normalized)) {
      highestConfidence = 0.85;
      matchedIntent = intent;
      break;
    }
  }

  // Parse date range
  let dateRange: { start: string; end: string } | undefined;
  if (patterns.period_this_week?.test(normalized) || /\bthis\s+week\b/i.test(message)) {
    const today = new Date();
    const dayOfWeek = today.getUTCDay();
    const monday = new Date(today);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setUTCDate(today.getUTCDate() + daysToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    dateRange = {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
    };
  } else if (patterns.period_next_week?.test(normalized) || /\bnext\s+week\b/i.test(message)) {
    const today = new Date();
    const dayOfWeek = today.getUTCDay();
    const nextMonday = new Date(today);
    const daysToNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    nextMonday.setUTCDate(today.getUTCDate() + daysToNextMonday);
    const sunday = new Date(nextMonday);
    sunday.setUTCDate(nextMonday.getUTCDate() + 6);
    dateRange = {
      start: nextMonday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
    };
  } else {
    const spanishRange = parseSpanishDateRange(message);
    if (spanishRange) {
      dateRange = spanishRange;
    } else {
      const englishRange = parseEnglishDateRange(message);
      if (englishRange) {
        dateRange = englishRange;
      }
    }
  }

  // Extract client names (look for known patterns)
  const clients: string[] = [];
  if (matchedIntent.includes('all_clients')) {
    clients.push('all_active_clients');
  }

  // Extract post title for "replace this post" commands
  let postTitle: string | undefined;
  const titleMatch = message.match(/post[:\s]+["\']?([^"\';\n]+)["\']?/i) ||
    message.match(/publicación[:\s]+["\']?([^"\';\n]+)["\']?/i);
  if (titleMatch) {
    postTitle = titleMatch[1].trim();
  }

  // Action modifiers
  const actionModifiers = {
    repair: /\b(repair|fix|repara|arregla)\b/i.test(message),
    replace: /\b(replace|reemplaza)\b/i.test(message),
    delete: /\b(delete|elimina|borra)\b/i.test(message),
    regenerate: /\b(regenerate|recrea)\b/i.test(message),
    review: /\b(review|revisa)\b/i.test(message),
  };

  return {
    intent: matchedIntent,
    clients: clients.length > 0 ? clients : undefined,
    dateRange,
    postTitle,
    numberReference,
    actionModifiers,
    confidence: highestConfidence,
  };
}
