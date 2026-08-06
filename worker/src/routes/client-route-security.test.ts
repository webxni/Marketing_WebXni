import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env, SessionData } from '../types';
import { clientRoutes } from './clients';
import { wordpressRoutes } from './wordpress';

function clientRoleApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'portal-user',
      email: 'client@example.com',
      name: 'Client User',
      role: 'client',
      clientId: 'client-1',
    });
    await next();
  });
  app.route('/api/clients', clientRoutes);
  app.route('/api/clients', wordpressRoutes);
  return app;
}

describe('client route authorization', () => {
  it.each([
    ['GET', '/api/clients'],
    ['GET', '/api/clients/other-client'],
    ['GET', '/api/clients/other-client/connection-check'],
    ['PUT', '/api/clients/other-client'],
    ['GET', '/api/clients/other-client/wordpress/status'],
    ['POST', '/api/clients/other-client/wordpress/test'],
  ])('rejects client-role access: %s %s', async (method, path) => {
    const response = await clientRoleApp().request(path, { method }, {} as Env);
    expect(response.status).toBe(403);
  });
});
