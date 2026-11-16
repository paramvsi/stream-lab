import type { Connection } from './connection';

/**
 * CONN-01 / board C01 "where does your cluster run?": the platforms of FLINK_API.md "Supported platforms", with
 * how well each is supported. Confluent Cloud uses a different API (CONN-KIND-UNSUPPORTED).
 */
export type Support = 'full' | 'limited' | 'unsupported';
export type KindChoice = Connection['kind'] | 'confluent';
export const KINDS: {
  kind: KindChoice;
  label: string;
  hint: string;
  support: Support;
}[] = [
  {
    kind: 'standalone',
    label: 'Self-managed (standalone / session)',
    hint: 'REST at host:8081',
    support: 'full',
  },
  {
    kind: 'kubernetes',
    label: 'Kubernetes (Flink Operator or native)',
    hint: 'port-forward a Service, or an Ingress URL',
    support: 'full',
  },
  {
    kind: 'yarn',
    label: 'YARN',
    hint: 'through the ResourceManager proxy: /proxy/application_…/',
    support: 'full',
  },
  {
    kind: 'gateway',
    label: 'Behind a gateway / reverse proxy',
    hint: 'base path + custom headers (OIDC, API key)',
    support: 'full',
  },
  {
    kind: 'ververica',
    label: 'Ververica Platform',
    hint: 'per-deployment Flink UI URL + API token',
    support: 'limited',
  },
  {
    kind: 'amazon',
    label: 'Amazon Managed Service for Apache Flink',
    hint: 'Flink UI via pre-signed URL (expires); read-only',
    support: 'limited',
  },
  {
    kind: 'confluent',
    label: 'Confluent Cloud for Apache Flink',
    hint: 'different API (statements only); not supported in v1',
    support: 'unsupported',
  },
];
