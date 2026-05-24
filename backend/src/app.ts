import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env';
import { buildCorsOptions } from './lib/cors';
import { requestId } from './middleware/request-id.middleware';
import { errorMiddleware } from './middleware/error.middleware';
import { redis } from './lib/redis';
import { logger } from './config/logger';
import { renderMetrics } from './lib/metrics';
import { authRoutes } from './modules/auth/auth.routes';
import { usersRoutes } from './modules/users/users.routes';
import { sitesRoutes } from './modules/sites/sites.routes';
import { contentRoutes } from './modules/content/content.routes';
import { deployRoutes } from './modules/deploy/deploy.routes';
import { templatesRoutes } from './modules/templates/templates.routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // honor X-Forwarded-For for rate-limit IP keying
  app.use(helmet());
  app.use(cors(buildCorsOptions(env.CORS_ORIGINS)));
  app.use(express.json({ limit: '25mb' })); // template imports upload a base64 .zip
  app.use(requestId);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/readyz', async (_req, res) => {
    try {
      if (redis.status !== 'ready' && redis.status !== 'connecting') {
        await redis.connect().catch(() => undefined);
      }
      const pong = await redis.ping();
      res.json({ ok: true, redis: pong === 'PONG' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn({ err: message }, 'readyz_failed');
      res.status(503).json({ ok: false, error: message });
    }
  });

  if (env.METRICS_ENABLED) {
    app.get('/metrics', async (_req, res) => {
      try {
        const { contentType, body } = await renderMetrics();
        res.set('content-type', contentType);
        res.send(body);
      } catch (e) {
        logger.error(
          { err: e instanceof Error ? e.message : String(e) },
          'metrics_render_failed',
        );
        res.status(500).type('text/plain').send('# metrics render failed\n');
      }
    });
  }

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/sites', sitesRoutes);
  app.use('/api/sites', contentRoutes); // /api/sites/:siteId/products...
  app.use('/api/sites', deployRoutes); // /api/sites/:siteId/deploy-theme
  app.use('/api/templates', templatesRoutes);

  app.use(errorMiddleware);
  return app;
}
