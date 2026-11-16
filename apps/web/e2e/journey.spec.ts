import { expect, test } from '@playwright/test';
import { openBlank } from './helpers';

/** M11 (TESTING.md "E2E web"): a pipeline from blank → run → explain → export, with no errors on the way. */
test('M11 journey: blank → Source → Sink → run → explain → export SQL', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await openBlank(page);
  const pane = page.locator('.react-flow__pane');
  await page.getByRole('button', { name: /^Source/ }).dragTo(pane, { targetPosition: { x: 200, y: 200 } });
  await page.getByRole('button', { name: /^Sink/ }).dragTo(pane, { targetPosition: { x: 600, y: 200 } });
  const nodes = page.locator('.react-flow__node');
  await expect(nodes).toHaveCount(2);
  await nodes
    .nth(0)
    .locator('.react-flow__handle-right')
    .dragTo(nodes.nth(1).locator('.react-flow__handle-left'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished/, {
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Explain run', exact: true }).click();
  const card = page.locator('[data-explain-card]');
  await expect(card).toContainText('An event arrives');
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('It reaches');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const sql = page.getByRole('dialog').getByRole('region', { name: 'Flink SQL' });
  await expect(sql).toContainText('CREATE TABLE');
  await expect(sql).toContainText('INSERT INTO');
  expect(errors).toEqual([]);
});
