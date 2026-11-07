import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';

export function createRateLimits({
  redisUrl = process.env.REDIS_URL,
  prefix = 'agentzuno:rate:',
} = {}) {
  const redis = redisUrl
    ? new Redis(redisUrl, {
        connectTimeout: 3000,
        commandTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: true,
      })
    : null;
  // Report a generic unavailable response; connection errors may contain infrastructure details.
  redis?.on('error', () => {});
  return {
    middleware(scope, options = {}) {
      const limiter = rateLimit({
        windowMs: 60000,
        limit: 120,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many attempts. Try again in a minute.' },
        ...options,
        passOnStoreError: false,
        ...(redis
          ? {
              store: new RedisStore({
                prefix: `${prefix}${scope}:`,
                sendCommand: async (...args) => {
                  try {
                    return await redis.call(...args);
                  } catch {
                    throw new Error('Rate-limit storage unavailable.');
                  }
                },
              }),
            }
          : {}),
      });
      return (request, response, next) =>
        limiter(request, response, (error) => {
          if (error)
            return response
              .status(503)
              .json({ error: 'Request protection is unavailable. Try again shortly.' });
          next();
        });
    },
    close: async () => redis?.disconnect(),
  };
}

export function createRateLimiter(app, scope, options) {
  app.locals.rateLimits ||= createRateLimits();
  return app.locals.rateLimits.middleware(scope, options);
}
