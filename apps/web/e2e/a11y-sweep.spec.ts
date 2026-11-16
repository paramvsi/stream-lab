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
  '/s/not-a-link', // SHARE-BROKEN
  '/sim/p_missing', // PIPELINE-NOT-FOUND
])
  test(`M11 axe ${route}`, async ({ page }) => {
    await page.goto(`/#${route}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
    // Every reveal section seen (one scroll to the bottom skips the middle ones).
    for (const el of await page.locator('.sl-reveal').all()) await el.scrollIntoViewIfNeeded();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0, { timeout: 30_000 }); // a cold dev server compiles the simulator
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

test('M11 axe the share view, the page-load failure and the open phone menu', async ({ page }) => {
  await page.goto('/#/new');
  const link = await page.evaluate(async () => {
    const { encodeShare } = await import('/src/share.ts');
    const { SCENARIOS, fromScenario } = await import('/src/sim/scenarios.ts');
    return encodeShare(
      fromScenario(
        SCENARIOS.find((x) => x.title === 'Late payments')!,
        'p_s',
      ),
    );
  });
  await page.goto(`/#/s/${link}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await check(page, 'share view');
  await page.route(/\/src\/pages\/MyPipelines\.tsx/, (r) => r.abort());
  await page.goto('/#/pipelines');
  await expect(page.getByText('Part of Stream Lab could not load')).toBeVisible();
  await check(page, 'APP-LOAD-FAILED');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/learn');
  await page.getByText('Menu', { exact: true }).click();
  await check(page, 'phone menu');
});
