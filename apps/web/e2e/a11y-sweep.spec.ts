import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** M11 (TESTING.md "A11y"): axe on every web route, AA, 0 violations, at both board sizes. */
const settle = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || (a.effect as KeyframeEffect).target?.closest?.('.sl-hero')),
  );
const check = async (page: Page, where: string) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${where} ${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
};

for (const route of [
  '/',
  '/learn',
  '/learn/event-time',
  '/learn/watermarks',
  '/learn/windows',
  '/learn/aggregations',
  '/learn/deduplication',
  '/learn/joins',
  '/glossary',
  '/download',
  '/new',
  '/pipelines',
  '/no/such/page',
])
  test(`M11 axe ${route}`, async ({ page }) => {
    await page.goto(`/#${route}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); // every section revealed
    await check(page, route);
  });

test('M11 axe the workspace: a scenario, then after a run', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await check(page, 'workspace');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished/, {
    timeout: 30000,
  });
  await check(page, 'workspace finished');
});
