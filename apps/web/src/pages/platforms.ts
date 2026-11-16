/** LAND-03: the three desktop platforms (boards W02, W02b, W02c) and which one this browser runs on. */
export type Os = 'mac' | 'win' | 'linux';

export const PLATFORMS: Record<Os, { name: string; ext: string; detail: string; firstLaunch: string }> = {
  mac: {
    name: 'macOS',
    ext: '.dmg',
    detail: 'Universal · Apple silicon and Intel',
    firstLaunch:
      'The first time, macOS may say the app is from an unidentified developer. Right-click Stream Lab in Applications and choose Open, then Open again.',
  },
  win: {
    name: 'Windows',
    ext: '.exe',
    detail: 'Windows 10 and 11 · 64-bit',
    firstLaunch:
      'Windows SmartScreen may show "Windows protected your PC". Click More info, then Run anyway.',
  },
  linux: {
    name: 'Linux',
    ext: '.AppImage',
    detail: 'AppImage, .deb or .rpm',
    firstLaunch:
      'Make the AppImage executable (chmod +x) and run it. On Ubuntu, the .deb installs it into your app menu.',
  },
};

/**
 * The OS from the browser's platform hints (userAgentData.platform, else the user agent). Phones and anything
 * unknown fall back to macOS, the board's default (W02).
 */
export function detectOs(platform: string | undefined, ua: string): Os {
  const s = `${platform ?? ''} ${ua}`.toLowerCase();
  if (/android|iphone|ipad/.test(s)) return 'mac';
  if (/\bwin/.test(s)) return 'win'; // not "darwin"
  if (/mac/.test(s)) return 'mac';
  if (/linux|x11|cros/.test(s)) return 'linux';
  return 'mac';
}

/**
 * The published desktop release, or null while there is none. ponytail: filled by hand when a release is
 * published (version, files, sizes and sha256 from the release); no installer, size or checksum is shown before.
 */
export interface Release {
  version: string;
  notes: string;
  files: Record<Os, { file: string; url: string; size: string; sha256: string }>;
}
export const RELEASE: Release | null = null;
