import type { Schema } from '@sl/graph';
import type { RefTable } from './engine';
import { BASE_TIME, rng, type Event } from './random';

/**
 * DATA-05 fintech pack, the reference tables (MVP): merchants (versioned), FX rates (versioned per minute) and a
 * blocklist. Deterministic, and keyed to what the generator emits (merchant ids m_100…m_111, AED/USD/EUR).
 * ponytail: the pack's built-in fraud patterns (bursts, card testing, impossible travel) are a later slice.
 */
export interface BuiltinTable extends RefTable {
  name: string;
  key: string;
  description: string;
}

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const NAMES = [
  'Gold Souk Jewellers',
  'Marina Cafe',
  'Desert Fuel',
  'Skyline Electronics',
  'Corniche Pharmacy',
  'Palm Grocers',
  'Creek Travel',
  'Dune Fashion',
  'Harbour Books',
  'Oasis Gym',
  'Falcon Rides',
  'Pearl Hotels',
];
const CATEGORIES = ['jewellery', 'food', 'fuel', 'electronics', 'health', 'groceries', 'travel', 'retail'];

function merchants(): BuiltinTable {
  const r = rng(101);
  const rows: Event[] = [];
  // Three versions: a day before the run, then 5 s and 12 s into it, so a default run (1,000 events at 50/s,
  // 20 s) sees risk tiers change.
  [BASE_TIME - 86_400_000, BASE_TIME + 5_000, BASE_TIME + 12_000].forEach((from, v) =>
    NAMES.forEach((name, i) =>
      rows.push({
        merchant_id: `m_${100 + i}`,
        name,
        category: CATEGORIES[i % CATEGORIES.length]!,
        country: i % 4 === 3 ? 'OM' : 'AE',
        risk_tier: v === 0 ? 'low' : ['low', 'medium', 'high'][Math.floor(r() * 3)]!,
        valid_from: iso(from),
      }),
    ),
  );
  return {
    name: 'merchants',
    key: 'merchant_id',
    description: 'Merchant name, category, country and risk tier; 3 versions',
    versioned: true,
    columns: [
      { name: 'merchant_id', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'category', type: 'string', required: true },
      { name: 'country', type: 'string', required: true },
      { name: 'risk_tier', type: 'string', required: true },
    ],
    rows,
  };
}

function fxRates(): BuiltinTable {
  const r = rng(202);
  const base: Record<string, number> = { AED: 0.2723, EUR: 1.0841, USD: 1 };
  const rows: Event[] = [];
  // Per minute for 8 hours around the run (board W13: "per minute"), from an hour before it.
  for (let m = 0; m < 480; m++)
    for (const currency of ['AED', 'EUR', 'USD'])
      rows.push({
        currency,
        rate_to_usd:
          currency === 'USD' ? 1 : Math.round(base[currency]! * (1 + (r() - 0.5) * 0.004) * 10_000) / 10_000,
        valid_from: iso(BASE_TIME - 60 * MIN + m * MIN),
      });
  return {
    name: 'fx_rates',
    key: 'currency',
    description: 'Rate to USD per currency, a new version every minute',
    versioned: true,
    columns: [
      { name: 'currency', type: 'string', required: true },
      { name: 'rate_to_usd', type: 'number', required: true },
    ],
    rows,
  };
}

function blocklist(): BuiltinTable {
  const listed = [103, 107, 110];
  return {
    name: 'blocklist',
    key: 'merchant_id',
    description: 'Merchants that must not be paid',
    versioned: false,
    columns: [
      { name: 'merchant_id', type: 'string', required: true },
      { name: 'blocked_reason', type: 'string', required: true },
    ],
    rows: listed.map((m, i) => ({
      merchant_id: `m_${m}`,
      blocked_reason: ['sanctions match', 'chargeback ratio', 'card testing'][i]!,
    })),
  };
}

export const BUILTIN_TABLES: Record<string, BuiltinTable> = Object.fromEntries(
  [merchants(), fxRates(), blocklist()].map((t) => [t.name, t]),
);

/** Table schemas for validation and schema propagation (SchemaCtx.refTables). */
export const refSchemas = (tables: Record<string, RefTable>): Record<string, Schema> =>
  Object.fromEntries(Object.entries(tables).map(([n, t]) => [n, t.columns]));
