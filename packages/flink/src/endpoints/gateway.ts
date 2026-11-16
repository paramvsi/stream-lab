import { z } from 'zod';

/**
 * SQL Gateway: GET /v1/info, POST /v1/sessions → sessionHandle, DELETE /v1/sessions/:sh.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/table/sql-gateway/rest/
 * ponytail: from the documented responses; a recorded fixture confirms them later.
 */
export const GatewayInfoSchema = z.looseObject({ productName: z.string(), version: z.string() });
export const OpenSessionSchema = z.looseObject({ sessionHandle: z.string() });
