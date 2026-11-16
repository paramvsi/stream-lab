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
