/**
 * Audit log routes
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';

export const logRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

/** GET /api/logs — paginated audit log */
logRoutes.get('/', requirePermission('logs.view'), async (c) => {
  const { action, user: userFilter, page, limit } = c.req.query();

  const pageNum  = page ? Math.max(1, parseInt(page)) : 1;
  const limitNum = limit ? Math.min(200, parseInt(limit)) : 50;
  const offset   = (pageNum - 1) * limitNum;

  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (action) {
    conditions.push('al.action LIKE ?');
    binds.push(`%${action}%`);
  }
  if (userFilter) {
    conditions.push('(u.email LIKE ? OR u.name LIKE ?)');
    binds.push(`%${userFilter}%`, `%${userFilter}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    c.env.DB
      .prepare(`
        SELECT al.id, al.user_id, u.email as user_email, al.action,
               al.entity_type as resource, al.entity_id, al.old_value, al.new_value,
               al.ip, al.created_at
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .bind(...binds, limitNum, offset)
      .all<{
        id: string; user_id: string | null; user_email: string | null;
        action: string; resource: string | null; entity_id: string | null;
        old_value: string | null; new_value: string | null;
        ip: string | null; created_at: number;
      }>(),
    c.env.DB
      .prepare(`SELECT COUNT(*) as n FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ]);

  return c.json({ logs: rows.results, total: countRow?.n ?? rows.results.length });
});
