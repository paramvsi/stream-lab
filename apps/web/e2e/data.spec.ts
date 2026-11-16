import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openBlank } from './helpers';

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
  await d.getByLabel('Events', { exact: true }).fill('100');
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

// ---- Data audit (f5f384a + a779898) ----
const openData = async (page: import('@playwright/test').Page, scenario: string) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${scenario}`) }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  return page.getByRole('dialog', { name: 'Data' });
};

test('data audit 4: the node preview uses the Data drawer’s settings (one card → one card in the preview)', async ({
  page,
}) => {
  const d = await openData(page, 'Refunds matching');
  await d.getByLabel('Distinct cards').fill('1');
  await d.getByRole('button', { name: 'Apply and regenerate' }).click();
  await page.locator('.react-flow__node').filter({ hasText: 'Payments' }).dblclick();
  const cards = page
    .getByRole('dialog', { name: 'Source settings' })
    .getByRole('table', { name: 'Live preview' })
    .locator('tbody tr td:nth-child(2)');
  await expect(cards.first()).toBeVisible();
  expect(new Set(await cards.allTextContents())).toEqual(new Set(['c_1000']));
});

test('data audit 5+7: the seed hint and units are tied to their fields; Copy seed refuses an invalid seed', async ({
  page,
}) => {
  const d = await openData(page, 'Card fraud bursts');
  await expect(d.getByLabel('Seed')).toHaveAccessibleDescription(/Same seed, same run\./);
  await expect(d.getByLabel('Rate')).toHaveAccessibleName(/events per second/);
  await d.getByLabel('Seed').fill('-3');
  await expect(d.getByText('Seed must be at least 0.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Copy seed' })).toHaveAttribute('aria-disabled', 'true');
  await d.getByLabel('Out of order').fill('0.5');
  await expect(d.getByText(/Out of order must/)).toHaveCount(0);
});

test('data audit 7: Apply without changes does not interrupt a run', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await page.getByText('0.25×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Data' })
    .getByRole('button', { name: 'Apply and regenerate' })
    .click();
  await page.waitForTimeout(500);
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Running/);
});

test('DATA-05 key skew and fraud patterns in the Data drawer (board W12): validated, applied, kept', async ({
  page,
}) => {
  await openBlank(page);
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByLabel('Key skew (percent)').fill('120');
  await expect(d).toContainText('Key skew must be at most 100 %.');
  await d.getByLabel('Key skew (percent)').fill('30');
  await d.getByRole('checkbox', { name: /Burst of small payments/ }).check();
  await d.getByRole('button', { name: 'Apply and regenerate' }).click();
  const gen = await page.evaluate(
    async () => (await import('/src/sim/store.ts')).useGraph.getState().data.generator,
  );
  expect(gen).toMatchObject({ skewPct: 30, patterns: { burst: true, blocklisted: false } });
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(d.getByLabel('Key skew (percent)')).toHaveValue('30');
  await expect(d.getByRole('checkbox', { name: /Burst of small payments/ })).toBeChecked();
});
