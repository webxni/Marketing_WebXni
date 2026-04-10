/**
 * Notion API client + import/export helpers
 *
 * Import strategy:
 *   1. Fetch all pages from the Notion DB
 *   2. Match each page to a local record by notion_page_id, then by slug/name
 *   3. Upsert fields — never overwrite a non-empty local field with an empty Notion value
 *   4. Store notion_page_id so future syncs are fast
 *
 * Export strategy:
 *   After a post is published, PATCH the Notion page to set the posting status field.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Raw Notion types
// ─────────────────────────────────────────────────────────────────────────────

export interface NotionPage {
  id:         string;
  properties: Record<string, NotionProp>;
  url:        string;
  created_time: string;
  last_edited_time: string;
}

export type NotionProp =
  | { type: 'title';        title:        { plain_text: string }[] }
  | { type: 'rich_text';    rich_text:    { plain_text: string }[] }
  | { type: 'select';       select:       { name: string } | null }
  | { type: 'multi_select'; multi_select: { name: string }[] }
  | { type: 'checkbox';     checkbox:     boolean }
  | { type: 'date';         date:         { start: string; end?: string | null } | null }
  | { type: 'url';          url:          string | null }
  | { type: 'email';        email:        string | null }
  | { type: 'phone_number'; phone_number: string | null }
  | { type: 'number';       number:       number | null }
  | { type: 'status';       status:       { name: string } | null }
  | { type: 'formula';      formula:      { string?: string; number?: number; boolean?: boolean } }
  | { type: 'relation';     relation:     { id: string }[] };

// ─────────────────────────────────────────────────────────────────────────────
// Property helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getText(prop: NotionProp | undefined): string {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return prop.title.map(t => t.plain_text).join('').trim();
    case 'rich_text':    return prop.rich_text.map(t => t.plain_text).join('').trim();
    case 'select':       return prop.select?.name ?? '';
    case 'url':          return prop.url ?? '';
    case 'email':        return prop.email ?? '';
    case 'phone_number': return prop.phone_number ?? '';
    case 'status':       return prop.status?.name ?? '';
    case 'formula':      return prop.formula.string ?? '';
    default: return '';
  }
}

export function getDate(prop: NotionProp | undefined): string | null {
  if (!prop || prop.type !== 'date') return null;
  return prop.date?.start ?? null;
}

export function getChecked(prop: NotionProp | undefined): boolean {
  return prop?.type === 'checkbox' ? prop.checkbox : false;
}

export function getMultiSelect(prop: NotionProp | undefined): string[] {
  return prop?.type === 'multi_select' ? prop.multi_select.map(s => s.name) : [];
}

/** Return text only if the Notion value is non-empty; otherwise return undefined */
export function getTextOrUndefined(prop: NotionProp | undefined): string | undefined {
  const v = getText(prop);
  return v !== '' ? v : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// NotionClient
// ─────────────────────────────────────────────────────────────────────────────

export class NotionClient {
  private readonly base = 'https://api.notion.com/v1';
  private readonly headers: Record<string, string>;

  constructor(token: string) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
  }

  /** Query all pages from a Notion database, handling pagination */
  async queryDatabase(
    databaseId: string,
    filter?: unknown,
  ): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (filter) body.filter = filter;
      if (cursor) body.start_cursor = cursor;

      const res = await fetch(`${this.base}/databases/${databaseId}/query`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion query failed HTTP ${res.status}: ${err}`);
      }

      const data = await res.json() as {
        results:     NotionPage[];
        has_more:    boolean;
        next_cursor: string | null;
      };

      pages.push(...data.results);
      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    return pages;
  }

  /** PATCH a Notion page property (used to write posting status back) */
  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.base}/pages/${pageId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion update failed HTTP ${res.status}: ${err}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Import helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge a Notion-sourced value into an existing local value.
 * Rule: never replace a non-empty local value with an empty Notion value.
 */
export function mergeField(
  existing: string | null | undefined,
  fromNotion: string | undefined,
): string | null {
  if (fromNotion && fromNotion.trim() !== '') return fromNotion.trim();
  // Notion value is empty — keep local value
  if (existing && existing.trim() !== '') return existing.trim();
  return null;
}

/**
 * Build the slug from a Notion business-name property.
 * Used for initial matching when notion_page_id is not yet stored.
 */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Notion property builders (for writing back to Notion)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a Notion status property update payload */
export function notionStatus(name: string): { status: { name: string } } {
  return { status: { name } };
}

/** Build a Notion rich_text property update payload */
export function notionRichText(text: string): { rich_text: { text: { content: string } }[] } {
  return { rich_text: [{ text: { content: text.slice(0, 2000) } }] };
}

/** Build a Notion url property update payload */
export function notionUrl(url: string): { url: string } {
  return { url };
}
