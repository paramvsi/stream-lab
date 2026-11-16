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
      // Whatever loads late (the chapter sandbox) is there before measuring.
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0, { timeout: 30_000 }); // a cold dev server compiles the simulator
      if (route.includes('/learn/'))
        await expect(page.getByRole('region', { name: 'Sandbox' })).toBeVisible({ timeout: 30_000 });
      for (const el of await page.locator('.sl-reveal').all()) await el.scrollIntoViewIfNeeded();
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

// ---- Audit of 5ffc8f2 / fbb1f7f ----
test('APP-LOAD-FAILED audit 2+3: the failed page has the site header, an h1 and a title; the next visit retries', async ({
  page,
}) => {
  await page.route(/\/src\/pages\/Gallery\.tsx/, (r) => r.abort());
  await page.goto('/#/new');
  await expect(page.getByText('Part of Stream Lab could not load')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Could not load this page');
  await expect(page).toHaveTitle('Could not load · Stream Lab');
  await expect(page.locator('header')).toHaveCount(1);
  await page.unroute(/\/src\/pages\/Gallery\.tsx/);
  await page.evaluate(() => (location.hash = '#/learn'));
  await expect(page.getByRole('heading', { level: 1, name: 'Apache Flink®, hands on' })).toBeVisible();
  await page.evaluate(() => (location.hash = '#/new'));
  await expect(page.getByRole('heading', { level: 1, name: 'Start a pipeline' })).toBeVisible();
});

test('audit 4: going to another page does not mount the page being left again', async ({ page }) => {
  await page.goto('/#/learn/windows');
  await expect(page.getByRole('heading', { level: 1, name: 'Windows' })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __h1: string[] };
    w.__h1 = [];
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes)
          if (n instanceof HTMLElement)
            for (const h of [n, ...n.querySelectorAll('h1')])
              if (h.tagName === 'H1') w.__h1.push(h.textContent ?? '');
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.evaluate(() => (location.hash = '#/glossary'));
  await expect(page.getByRole('heading', { level: 1, name: 'Flink concepts, in plain words' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __h1: string[] }).__h1)).toEqual([
    'Flink concepts, in plain words',
  ]);
});

test.describe('phone menu', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('audit 5: Escape closes it and returns to Menu; a click outside closes it', async ({ page }) => {
    await page.goto('/#/glossary');
    const summary = page.getByText('Menu', { exact: true });
    const menu = page.getByRole('navigation', { name: 'Main' });
    await summary.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(summary).toBeFocused();
    await summary.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(160, 500);
    await expect(menu).toBeHidden();
  });
});

test.describe('phone menu focus', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('audit 12: Escape in a field stays there; tabbing out of the menu closes it', async ({ page }) => {
    await page.goto('/#/glossary');
    const summary = page.getByText('Menu', { exact: true });
    const menu = page.getByRole('navigation', { name: 'Main' });
    await summary.click();
    await expect(menu).toBeVisible();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab'); // four links, then out
    await expect(menu).toBeHidden();
    // Open with focus on the page (Safari does not focus <summary> on click): Escape still closes it.
    await summary.click();
    await expect(menu).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // Escape in a field (menu closed) stays in the field.
    const search = page.getByLabel('Search the glossary');
    await search.focus();
    await page.keyboard.press('Escape');
    await expect(search).toBeFocused();
  });
});
