import { describe, expect, it } from 'vitest';
import { detectOs } from './platforms';

describe('LAND-03 detectOs', () => {
  it.each([
    ['macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)', 'mac'],
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'win'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    [undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'win'],
    [undefined, 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64)', 'linux'],
    [undefined, 'Mozilla/5.0 (Linux; Android 14)', 'mac'],
    [undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'mac'],
    [undefined, 'Mozilla/5.0 (X11; CrOS x86_64 15000)', 'linux'],
    [undefined, '', 'mac'],
    ['Darwin', '', 'mac'],
  ] as const)('%s / %s → %s', (platform, ua, os) => {
    expect(detectOs(platform, ua)).toBe(os);
  });
});
