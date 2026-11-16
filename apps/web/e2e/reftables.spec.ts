import { expect, test } from '@playwright/test';
import { openBlank } from './helpers';

test('DATA-03/05 a Lookup on the built-in merchants table is valid and enriches events (no LOOKUP-NO-TABLE)', async ({
  page,
}) => {
  await openBlank(page);
  await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    const g = m.useGraph.getState();
    const gen = g.addNode('Generator', { x: 0, y: 0 });
    const l = g.addNode('Lookup', { x: 260, y: 0 }, { nodeId: gen, handleId: 'main' });
    g.addNode('Sink', { x: 520, y: 0 }, { nodeId: l, handleId: 'main' });
  });
  const panel = page.getByRole('region', { name: 'Run panel' });
  await expect(panel.getByRole('tab', { name: /^Problems/ })).toBeVisible();
  await page.waitForTimeout(400); // validation debounce
  await expect(panel).not.toContainText('Reference table "merchants" is empty or missing');
  // Keyboard open (NODE-01): the node may sit outside the 1280 px viewport, where a double-click can't land.
  await page.locator('.react-flow__node').filter({ hasText: 'LOOKUP' }).focus();
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog', { name: 'Lookup settings' });
  await d.getByRole('tab', { name: 'Output preview' }).click();
  const after = d.getByRole('table', { name: 'Events after the node' });
  await expect(after.locator('thead')).toContainText('risk_tier');
  await expect(after.locator('thead')).toContainText('name');
});

test('DATA-03 reference tables list and a versioned table (W13, W13b)', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Reference tables' });
  const list = d.getByRole('table', { name: 'Reference tables' });
  await expect(list.locator('tbody tr')).toHaveCount(3);
  await expect(list.locator('tbody tr').filter({ hasText: 'merchants' })).toContainText('3 versions');
  await expect(list.locator('tbody tr').filter({ hasText: 'fx_rates' })).toContainText('per minute');
  await expect(list.locator('tbody tr').filter({ hasText: 'blocklist' }).locator('td').last()).toHaveText(
    'no',
  );
  await d.getByLabel('Search tables').fill('fx');
  await expect(list.locator('tbody tr')).toHaveCount(1);
  // Keyboard: the row opens the table.
  await list.locator('tbody tr').first().focus();
  await page.keyboard.press('Enter');
  const t = page.getByRole('dialog', { name: 'fx_rates' }); // an open table names the drawer
  await t.getByLabel('Version valid from').selectOption({ label: '2026-11-15 12:02:00' });
  await expect(t).toContainText(
    'An event from 12:02:00 up to 12:02:59 joins these rows. One at 12:03:00 or later sees the next version.',
  );
  const rows = t.getByRole('table', { name: 'fx_rates rows' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('12:02:00');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Tables', exact: true })).toBeFocused();
});

// ---- Tables audit (dff73cc + 2853e38) ----
test('tables audit 4: a table opens on the version a run starts with, names the drawer, and dates other days', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  await page.getByLabel('Search tables').fill('merchant_id'); // the key, not only the name
  await expect(page.getByRole('table', { name: 'Reference tables' }).locator('tbody tr')).toHaveCount(2);
  await page
    .getByRole('table', { name: 'Reference tables' })
    .locator('tbody tr')
    .filter({ hasText: 'merchants' })
    .click();
  const d = page.getByRole('dialog', { name: 'merchants' });
  await expect(d.getByRole('button', { name: 'All tables' })).toBeFocused();
  await expect(d).toContainText('An event from 2026-11-14 12:00:00 up to 12:00:04 joins these rows.');
  await expect(d.getByRole('button', { name: '12:00:05' })).toBeVisible();
  // A list row is not a "selected / not selected" option.
  await d.getByRole('button', { name: 'All tables' }).click();
  expect(await page.locator('table[aria-label="Reference tables"] tbody tr[aria-selected]').count()).toBe(0);
});

test('tables audit 2: the Data drawer never opens by itself on another pipeline', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Data' })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: /^Use this scenario.*Card velocity/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: 'Data' }).count()).toBe(0);
});
