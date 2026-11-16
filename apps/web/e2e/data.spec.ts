import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('DATA-01 generator settings: GEN-INVALID inline, seed copyable, applied settings persist and drive the run (W12)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/new');
  // Refunds matching reads from two Sources, which use the pipeline's generator.
  await page.getByRole('button', { name: /^Use this scenario.*Refunds matching/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByLabel('Rate').fill('0');
  await expect(d.getByText('Rate must be at least 1.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Apply and regenerate' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await d.getByLabel('Late (beyond the out-of-orderness)').fill('120');
  await expect(d.getByText('Late must be at most 100 %.')).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await d.getByLabel('Rate').fill('500');
  await d.getByLabel('Late (beyond the out-of-orderness)').fill('0');
  await d.getByLabel('Events').fill('100');
  await d.getByLabel('Duplicates').fill('0');
  await d.getByLabel('Seed').fill('7');
  await d.getByRole('button', { name: 'Copy seed' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('7');
  await d.getByRole('button', { name: 'Apply and regenerate' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Data' }).getByLabel('Seed')).toHaveValue('7');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished · 200 events/, {
    timeout: 15000,
  });
});
