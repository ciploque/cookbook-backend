import pinoHttp from 'pino-http';
import { env } from '../config/env';

export const requestLogger = pinoHttp({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
