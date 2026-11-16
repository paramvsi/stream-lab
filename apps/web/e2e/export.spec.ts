import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function scenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

test('EXP-01 Export shows the pipeline as Flink SQL (W17), downloads a .sql, copies it; axe clean', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await scenario(page, 'Refunds matching');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const d = page.getByRole('dialog', { name: /^Export "/ });
  const sql = d.getByRole('region', { name: 'Flink SQL' });
  await expect(sql).toContainText('CREATE TABLE `payments` (');
  await expect(sql).toContainText('INSERT INTO `matched_refunds`');
  await expect(d).toContainText('Generated for Flink 1.20 and 2.x. Connector options are placeholders.');
  const dl = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Download .sql' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.sql$/);
  await d.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('SQL copied').first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'INSERT INTO `matched_refunds`',
  );
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(axe.violations).toEqual([]);
  // The first Escape closes the "SQL copied" toast (the top layer, as everywhere in the app), the second the dialog.
  await page.keyboard.press('Escape');
  await expect(page.getByText('SQL copied')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
});

test('EXPORT-UNSUPPORTED a node with no direct SQL is named in a banner; the run panel tab shows the same SQL', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts'); // its window has a late output, which SQL can not express
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const d = page.getByRole('dialog', { name: /^Export "/ });
  await expect(d).toContainText(
    'Bursts per card has no direct Flink SQL; it is exported as a comment with a TODO.',
  );
  await page.keyboard.press('Escape');
  const panel = page.getByRole('region', { name: 'Run panel' });
  await panel.getByRole('tab', { name: 'Flink SQL' }).click();
  await expect(panel.getByRole('region', { name: 'Flink SQL' })).toContainText('TUMBLE(TABLE');
  await expect(panel).toContainText('Bursts per card has no direct Flink SQL');
});
