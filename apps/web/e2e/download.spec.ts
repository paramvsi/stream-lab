import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const [ua, name, others] of [
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'macOS',
    ['Windows', 'Linux'],
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'Windows',
    ['macOS', 'Linux'],
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'Linux',
    ['macOS', 'Windows'],
  ],
] as const) {
  test.describe(name, () => {
    test.use({ userAgent: ua });
    test(`LAND-03 detects ${name} and puts it first; the other two are listed under it (W02)`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgentData', { value: undefined });
      });
      await page.goto('/#/download');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Stream Lab for ${name}`);
      const list = page.getByRole('region', { name: 'Other platforms' }).getByRole('button');
      await expect(list).toHaveCount(2);
      for (const [i, o] of others.entries()) await expect(list.nth(i)).toContainText(o);
      // No release yet: no download, size or checksum is invented.
      await expect(page.getByRole('button', { name: /^Download / })).toBeDisabled();
      await expect(page.getByText('The desktop app is in development and has no release yet.')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Checksums' })).toHaveCount(0);
      await list.nth(0).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Stream Lab for ${others[0]}`);
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => v.id)).toEqual([]);
    });
  });
}

test('LAND-03 audit 2: picking another platform by keyboard moves focus to its heading', async ({ page }) => {
  await page.goto('/#/download');
  const first = page.getByRole('region', { name: 'Other platforms' }).getByRole('button').first();
  const name = (await first.locator('span').first().innerText()).trim();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Stream Lab for ${name}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});
