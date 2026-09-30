import type { Express, Request } from 'express';
import { AuthError, type AuthService, SESSION_COOKIE, sessionCookie } from './auth';
import { AiSettingsService } from './ai/settings';
import { AiError } from './ai/errors';

function objectBody(req: Request, allowed: string[]): Record<string, unknown> {
  if (
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body) ||
    Object.keys(req.body).some((name) => !allowed.includes(name))
  )
    throw new AiError('Geçerli ayar alanlarını JSON nesnesi olarak gönderin.', 400);
  return req.body;
}
// Mevcut Host/Origin ve oturum middleware'inden sonra kaydedilmelidir.
export function registerSettingsRoutes(
  app: Express,
  auth: AuthService | null,
  settings: AiSettingsService,
) {
  app.get('/api/settings/ai', (_req, res) => res.json(settings.status()));
  app.patch('/api/settings/ai', (req, res) =>
    res.json(settings.update(objectBody(req, ['apiKey', 'model']))),
  );
  app.post('/api/settings/ai/test', async (_req, res) => res.json(await settings.testConnection()));
  app.post('/api/auth/password', async (req, res) => {
    if (!auth) throw new AuthError('Parola değişimi yalnız sunucu modunda kullanılabilir.', 403);
    const input = objectBody(req, ['currentPassword', 'newPassword']);
    if (typeof input.currentPassword !== 'string' || typeof input.newPassword !== 'string')
      throw new AuthError('Mevcut ve yeni parola alanlarını kontrol edin.', 400);
    await auth.changePassword(
      input.currentPassword,
      input.newPassword,
      sessionCookie(req.headers.cookie),
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
    );
    res.clearCookie(SESSION_COOKIE, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    res.json({ changed: true });
  });
}
