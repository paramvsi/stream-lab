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
  await expect(list.locator('tbody tr').filter({ hasText: 'blocklist' })).toContainText('no');
  await d.getByLabel('Search tables').fill('fx');
  await expect(list.locator('tbody tr')).toHaveCount(1);
  // Keyboard: the row opens the table.
  await list.locator('tbody tr').first().focus();
  await page.keyboard.press('Enter');
  await d.getByLabel('Version valid from').selectOption({ label: '2026-11-15 12:02:00' });
  await expect(d).toContainText(
    'An event from 12:02:00 up to 12:02:59 joins these rows. One at 12:03:00 or later sees the next version.',
  );
  const rows = d.getByRole('table', { name: 'fx_rates rows' }).locator('tbody tr');
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
