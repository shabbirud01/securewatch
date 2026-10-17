import { pino } from 'pino';
import { config } from './config.js';

/**
 * The one logger for the whole server; Fastify uses it too. Development gets
 * readable coloured lines; production gets JSON lines that log tools can parse.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
    },
  }),
});
