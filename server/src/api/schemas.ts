/** Validation for everything that comes in over HTTP. Handlers only ever see clean data. */
import { z } from 'zod';
import { normalizeTarget } from '../domains/normalize.js';

/** Route params such as /api/domains/:id. The "3" in the URL becomes the number 3. */
export const IdParams = z.object({ id: z.coerce.number().int().positive() });

/** POST /api/domains body. Validates and normalises the hostname in one step. */
export const AddDomainBody = z
  .object({
    hostname: z.string().max(300),
    port: z.number().optional(),
  })
  .transform((body, ctx) => {
    const target = normalizeTarget(body.hostname, body.port);
    if ('error' in target) {
      ctx.addIssue({ code: 'custom', message: target.error, path: ['hostname'] });
      return z.NEVER;
    }
    return target;
  });

/** GET /api/domains/:id/scans?limit=50 */
export const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
