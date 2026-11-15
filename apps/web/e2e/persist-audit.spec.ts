import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBlank } from './helpers';

const nodes = (page: Page) => page.locator('.react-flow__node');
const addNode = (page: Page, t: string) =>
  page.getByRole('button', { name: new RegExp(`^${t}`) }).press('Enter');
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();

async function useScenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(nodes(page).first()).toBeVisible();
}

test('P1 a rename on My pipelines shows when the pipeline is reopened (store does not win over IndexedDB)', async ({
  page,
}) => {
  await useScenario(page, 'Late payments');
  await page.getByRole('link', { name: 'stream lab' }).click();
  await page.getByRole('button', { name: 'Rename Late payments' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Renamed');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('link', { name: 'Renamed' }).click();
  await expect(page.getByRole('textbox', { name: 'Pipeline name' })).toHaveValue('Renamed');
});

test('P2 a deleted pipeline stays deleted: Back shows not-found, a reload does not bring it back', async ({
  page,
}) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await page.getByRole('link', { name: 'stream lab' }).click(); // leave within the debounce
  await page.getByRole('button', { name: 'Delete Untitled pipeline' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('No saved pipelines yet')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('This pipeline is not saved in this browser')).toBeVisible();
  await page.reload();
  await expect(page.getByText('This pipeline is not saved in this browser')).toBeVisible();
  await page.goto('/#/pipelines');
  await expect(page.getByText('No saved pipelines yet')).toBeVisible();
});

test('P3 deleting in one tab tells the other tab, which stops saving it', async ({ page, context }) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await saved(page);
  const list = await context.newPage();
  await list.goto('/#/pipelines');
  await list.getByRole('button', { name: 'Delete Untitled pipeline' }).click();
  await list.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toBeVisible();
  await addNode(page, 'Sink');
  await page.waitForTimeout(900);
  await list.reload();
  await expect(list.getByText('No saved pipelines yet')).toBeVisible();
});

test('P4 "Load newer version" does not bounce the conflict back to the other tab', async ({
  page,
  context,
}) => {
  await openBlank(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByText('Start with a source')).toBeVisible();
  await addNode(other, 'Source');
  await page.getByRole('button', { name: 'Load newer version' }).click();
  await expect(nodes(page)).toHaveCount(1);
  await other.waitForTimeout(1200);
  await expect(other.getByText('This pipeline is open in another tab')).toHaveCount(0);
});

test('P5 storage full on create: the workspace says so (banner, "Not saved"), not "Saved"', async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
  });
  await useScenario(page, 'Card fraud bursts');
  await expect(page.getByRole('status').filter({ hasText: /^Not saved$/ })).toBeVisible();
  await expect(
    page
      .getByRole('alert')
      .or(page.getByRole('status'))
      .filter({ hasText: /not letting Stream Lab save|storage is full/ }),
  ).toBeVisible();
});

test('P8 after confirming a delete, focus lands on the list (not <body>)', async ({ page }) => {
  await useScenario(page, 'Late payments');
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Merchant top-N/ }).click();
  await expect(page.getByRole('textbox', { name: 'Pipeline name' })).toHaveValue('Merchant top-N');
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Delete Merchant top-N' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete pipeline' }).press('Enter');
  await expect(page.getByRole('link', { name: 'Late payments' })).toBeFocused();
});

test('P13 the 404 page has landmarks (axe)', async ({ page }) => {
  await page.goto('/#/nope');
  await expect(page.getByText('404 · event arrived after the watermark')).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test('P7 a delete that fails shows the storage banner and no "Deleted" toast', async ({ page }) => {
  await useScenario(page, 'Late payments');
  await page.goto('/#/pipelines');
  await page.evaluate(() => {
    IDBObjectStore.prototype.delete = function () {
      throw Object.assign(new Error('blocked'), { name: 'InvalidStateError' });
    };
  });
  await page.getByRole('button', { name: 'Delete Late payments' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('This browser is not letting Stream Lab save.')).toBeVisible();
  // An absence check passes at once; give a wrongly-sent toast time to appear first.
  await page.waitForTimeout(800);
  await expect(page.getByText('Deleted "Late payments".')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Late payments' })).toBeVisible();
});
