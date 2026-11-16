import { z } from 'zod';

/**
 * GET /config — the dashboard configuration: the version decides which features the app shows.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/rest_api/#config
 * Only the fields the app reads; others pass through. ponytail: checked against the documented response,
 * not yet against a recorded fixture (FLINK_API.md "Fixtures": `pnpm fixtures:record` needs the docker clusters).
 */
export const ConfigSchema = z.looseObject({
  'flink-version': z.string(),
  'refresh-interval': z.number().optional(),
  features: z
    .looseObject({
      'web-submit': z.boolean().optional(),
      'web-cancel': z.boolean().optional(),
    })
    .optional(),
});
export type FlinkConfig = z.infer<typeof ConfigSchema>;

/** 1.20 and 2.x are supported; older is read-only best effort (CONN-VERSION-OLD). */
export function versionSupported(v: string): boolean {
  const [maj = 0, min = 0] = v
    .replace(/^v/i, '')
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  return maj > 1 || (maj === 1 && min >= 20);
}
