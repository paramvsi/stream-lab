import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const hero = (page: import('@playwright/test').Page) => page.locator('.sl-hero');
const running = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) => (a.effect as KeyframeEffect).target?.closest?.('.sl-hero') && a.playState === 'running',
        ).length,
  );

test('LAND-01 the hero animates, pauses off-screen and runs again in view; LAND-02 the two CTAs', async ({
  page,
}) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Watch Apache Flink® think, one event at a time.',
  );
  await expect.poll(() => running(page)).toBeGreaterThan(0);
  await page.getByRole('region', { name: 'Desktop app' }).scrollIntoViewIfNeeded();
  await expect(hero(page)).toHaveAttribute('data-paused', '');
  await expect.poll(() => running(page)).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(hero(page)).not.toHaveAttribute('data-paused', '');
  await page.getByRole('link', { name: 'Start building' }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Take the course' }).click();
  await expect(page).toHaveURL(/#\/learn$/);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('LAND-01 a still frame: nothing moves, the output rows and the sections are all there', async ({
    page,
  }) => {
    await page.goto('/#/');
    await expect(hero(page).getByText('12:00–12:05 · c_4471 · 1,940.00')).toBeVisible();
    expect(await running(page)).toBe(0);
    // The reveal hides the list item (not the link): every item is there, unanimated.
    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll('.sl-reveal-item')].filter((e) => getComputedStyle(e).opacity !== '1')
          .length,
    );
    expect(hidden).toBe(0);
  });
});

test('LAND-04 sections rise in once: seen once stays seen, with no second animation', async ({ page }) => {
  test.setTimeout(60_000); // waits for every reveal animation to end, twice
  await page.goto('/#/');
  const how = page.getByRole('region', { name: 'How it works' });
  await expect(how).not.toHaveAttribute('data-in', '');
  await how.scrollIntoViewIfNeeded();
  await expect(how).toHaveAttribute('data-in', 'true');
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || (a.effect as KeyframeEffect).target?.closest?.('.sl-hero')),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await how.scrollIntoViewIfNeeded();
  const again = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) => (a.effect as KeyframeEffect).target?.closest?.('.sl-reveal') && a.playState === 'running',
        ).length,
  );
  expect(again).toBe(0);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || (a.effect as KeyframeEffect).target?.closest?.('.sl-hero')),
  );
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
});

test('LAND-01 a returning learner gets Continue with their chapter (W01b)', async ({ page }) => {
  await page.goto('/#/learn');
  await page.evaluate(async () => (await import('/src/storage.ts')).setChapterStatus('windows', 'started'));
  await page.goto('/#/');
  await page.reload();
  await page.getByRole('link', { name: /Continue.*Chapter 3: Windows/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Windows' })).toBeVisible();
});

test('LAND-06 the landing, the course and the glossary do not load the simulator', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (r) => loaded.push(r.url()));
  for (const route of ['/#/', '/#/learn', '/#/glossary']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(loaded.filter((u) => /\/src\/sim\/Workspace\.tsx|@xyflow/.test(u))).toEqual([]);
  // A chapter's reading comes first; its sandbox loads the simulator after.
  await page.goto('/#/learn/windows');
  await expect(page.getByRole('region', { name: 'Sandbox' })).toBeVisible();
  expect(loaded.some((u) => /\/src\/sim\/Workspace\.tsx/.test(u))).toBe(true);
});

// ---- Audit of 2951ab2 / 56db0e4 ----
test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test('LAND-06 audit 3: no sideways scroll on the landing, the course, the glossary and the download page', async ({
    page,
  }) => {
    for (const route of ['/#/', '/#/learn', '/#/glossary', '/#/download']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(375);
    }
  });
});

test('LAND-04 audit 2+7: without IntersectionObserver the landing still shows; the Explain node stays on one line', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error an old browser
    delete window.IntersectionObserver;
  });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'How it works' })).toHaveAttribute('data-in', 'true');
  const node = page.getByText('Bursts per card', { exact: true });
  expect((await node.boundingBox())!.height).toBeLessThan(60);
});
