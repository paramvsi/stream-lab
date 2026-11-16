import { expect, test } from '@playwright/test';

// ---- Audit of 7644a54 / ed91303 / ce6fa2c ----
test('APP-LOAD-FAILED audit 1: a page whose code can not load says so, with Reload; other pages still open', async ({
  page,
}) => {
  await page.route(/\/src\/pages\/Gallery\.tsx/, (r) => r.abort());
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Start building' }).click();
  await expect(page.getByText('Part of Stream Lab could not load')).toBeVisible();
  await expect(page.getByText('Check your connection, then reload the page.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await page.evaluate(() => (location.hash = '#/learn'));
  await expect(page.getByRole('heading', { level: 1, name: 'Apache Flink®, hands on' })).toBeVisible();
});

test('APP-LOAD-FAILED audit 2: a sandbox that can not load leaves the chapter readable', async ({ page }) => {
  await page.route(/\/src\/pages\/Sandbox\.tsx/, (r) => r.abort());
  await page.goto('/#/learn/windows');
  await expect(page.getByRole('heading', { level: 1, name: 'Windows' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tumbling' })).toBeVisible();
  await expect(page.getByText('Part of Stream Lab could not load.', { exact: false })).toBeVisible();
});

test('LAND-06 audit 5: a page loading says so (not a blank screen)', async ({ page }) => {
  await page.route(/\/src\/pages\/Gallery\.tsx/, async (r) => {
    await new Promise((f) => setTimeout(f, 1500));
    await r.continue();
  });
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Start building' }).click();
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Start a pipeline' })).toBeVisible();
});

test('BROWSER-UNSUPPORTED audit 6: an unsupported browser does not download the simulator for a chapter', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error a browser without Web Workers
    delete window.Worker;
  });
  const loaded: string[] = [];
  page.on('request', (r) => loaded.push(r.url()));
  await page.goto('/#/learn/windows');
  await expect(page.getByText('This browser can not run the simulator.', { exact: false })).toBeVisible();
  expect(loaded.filter((u) => /\/src\/sim\/Workspace\.tsx|\/src\/pages\/Sandbox\.tsx/.test(u))).toEqual([]);
});

test.describe('320 CSS px (WCAG 1.4.10)', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('audit 3+4: no sideways scroll on any site page; the menu reaches every section, chapter page included', async ({
    page,
  }) => {
    for (const route of ['/#/', '/#/learn', '/#/learn/windows', '/#/glossary', '/#/download', '/#/new']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(320);
    }
    await page.goto('/#/learn/windows');
    await page.getByText('Menu', { exact: true }).click();
    const menu = page.getByRole('navigation', { name: 'Main' });
    for (const l of ['Learn', 'Simulator', 'Desktop app', 'Glossary'])
      await expect(menu.getByRole('link', { name: l })).toBeVisible();
    await menu.getByRole('link', { name: 'Glossary' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Flink concepts, in plain words' }),
    ).toBeVisible();
  });
});
