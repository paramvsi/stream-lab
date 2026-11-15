import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBlank } from './helpers';

const nodes = (page: Page) => page.locator('.react-flow__node');
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const axe = async (page: Page) => {
  await settled(page);
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

test('SIM-01 gallery: blank + five fintech scenarios + e-commerce marked v1; a scenario opens built', async ({
  page,
}) => {
  await page.goto('/#/new');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Blank pipeline',
    'Card fraud bursts',
    'Refunds matching',
    'Card velocity',
    'Merchant top-N',
    'Late payments',
    'Cart abandonment',
  ]);
  await expect(page.getByText('Coming in v1')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await expect(nodes(page)).toHaveCount(6);
  await expect(page.getByRole('textbox', { name: 'Pipeline name' })).toHaveValue('Card fraud bursts');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).not.toHaveAccessibleDescription(/Fix/);
});

test('SIM-20 autosave: changes survive a reload; the header says Saved', async ({ page }) => {
  await openBlank(page);
  await page.getByRole('button', { name: /^Source/ }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.reload();
  await expect(nodes(page)).toHaveCount(1);
});

test('SIM-20 the unload flush saves a change made just before leaving', async ({ page }) => {
  await openBlank(page);
  await page.getByRole('button', { name: /^Sink/ }).press('Enter');
  // Reload at once, inside the 500 ms debounce: a real unload, so only the beforeunload flush can have
  // saved it (a hash navigation would keep the in-memory store and prove nothing).
  await page.reload();
  await expect(nodes(page)).toHaveCount(1);
});

test('SIM-02 my pipelines: list, rename, duplicate, delete with confirm and Undo', async ({ page }) => {
  await page.goto('/#/pipelines');
  await expect(page.getByText('No saved pipelines yet')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Late payments/ }).click();
  await expect(nodes(page)).toHaveCount(4);
  await page.goto('/#/pipelines');
  const table = page.getByRole('table', { name: 'My pipelines' });
  await expect(table.getByRole('link', { name: 'Late payments' })).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await page.getByRole('button', { name: 'Rename Late payments' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Late AED payments');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
  await expect(table.getByRole('link', { name: 'Late AED payments' })).toBeVisible();

  await page.getByRole('button', { name: 'Duplicate Late AED payments' }).click();
  await expect(table.getByRole('link', { name: 'Late AED payments copy' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete Late AED payments copy' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete "Late AED payments copy"?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(table.getByRole('link', { name: 'Late AED payments copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(table.getByRole('link', { name: 'Late AED payments copy' })).toBeVisible();
});

test('SIM-02 IMPORT-INVALID dialog for a non-pipeline file; a valid export imports', async ({ page }) => {
  await page.goto('/#/pipelines');
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'pipeline.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":1}'),
  });
  await expect(page.getByRole('dialog')).toContainText(
    'pipeline.json could not be imported: it is not a Stream Lab pipeline',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  const good = {
    schemaVersion: 1,
    id: 'p_x',
    name: 'Imported',
    updatedAt: '2026-11-15T00:00:00Z',
    seed: 42,
    nodes: [],
    edges: [],
    data: { refTables: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  await input.setInputFiles({
    name: 'ok.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(good)),
  });
  await expect(page.getByRole('link', { name: 'Imported' })).toBeVisible();
});

test('PIPELINE-NOT-FOUND for an id not saved in this browser', async ({ page }) => {
  await page.goto('/#/sim/p_nope');
  await expect(page.getByText('This pipeline is not saved in this browser')).toBeVisible();
  await page.getByRole('button', { name: 'My pipelines' }).click();
  await expect(page).toHaveURL(/#\/pipelines$/);
});

test('SIM-TAB-CONFLICT banner when another tab saves the same pipeline', async ({ page, context }) => {
  await openBlank(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByText('Start with a source')).toBeVisible();
  await other.getByRole('button', { name: /^Source/ }).press('Enter');
  await expect(
    page.getByText('This pipeline is open in another tab, which saved a newer version.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load newer version' }).click();
  await expect(nodes(page)).toHaveCount(1);
});
