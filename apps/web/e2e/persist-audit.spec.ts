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
  // Not toHaveCount(0): that retries for 5 s and a wrongly-sent success toast closes itself after 4 s.
  await page.waitForTimeout(800);
  expect(await page.getByText('Deleted "Late payments".').count()).toBe(0);
  await expect(page.getByRole('link', { name: 'Late payments' })).toBeVisible();
});

/* ---------- audit 4 ---------- */

const fullStorage = (page: Page) =>
  page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
  });

test('Q1 a pending autosave does not bring back a pipeline deleted in another tab', async ({
  page,
  context,
}) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await saved(page);
  const list = await context.newPage();
  await list.goto('/#/pipelines');
  await addNode(page, 'Sink'); // pending (500 ms)
  await list.getByRole('button', { name: 'Delete Untitled pipeline' }).click();
  await list.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toBeVisible();
  await page.waitForTimeout(900);
  await list.reload();
  await expect(list.getByText('No saved pipelines yet')).toBeVisible();
});

test('Q2 never-saved pipeline: edits survive "Manage storage" and Back', async ({ page }) => {
  await fullStorage(page);
  await openBlank(page);
  await addNode(page, 'Source');
  await addNode(page, 'Sink');
  await expect(page.getByRole('status').filter({ hasText: /^Not saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Manage storage' }).click();
  await page.goBack();
  await expect(nodes(page)).toHaveCount(2);
});

test('Q3 Q4 after Undo of a delete elsewhere the banner goes away and saving resumes; meanwhile "Not saved"', async ({
  page,
  context,
}) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await saved(page);
  const list = await context.newPage();
  await list.goto('/#/pipelines');
  await list.getByRole('button', { name: 'Delete Untitled pipeline' }).click();
  await list.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toBeVisible();
  await addNode(page, 'Filter');
  await expect(page.getByRole('status').filter({ hasText: /^Not saved$/ })).toBeVisible();
  await list.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toHaveCount(0);
});

test('Q5 never-saved pipeline: a reload inside the debounce brings back the rescue copy', async ({
  page,
}) => {
  await fullStorage(page);
  await openBlank(page);
  await addNode(page, 'Source');
  await page.reload();
  await expect(nodes(page)).toHaveCount(1);
});

test('Q6 the palette keeps the active option in view', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('ArrowDown', { delay: 0 });
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowDown');
  const active = page.locator('[role="option"][aria-selected="true"]');
  await expect(active).toBeInViewport();
});

test('Q7 an edit pending during "Load newer version" does not bounce the conflict', async ({
  page,
  context,
}) => {
  await openBlank(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByText('Start with a source')).toBeVisible();
  await addNode(other, 'Source');
  await expect(page.getByText('This pipeline is open in another tab')).toBeVisible();
  await addNode(page, 'Sink'); // pending save of the old version
  await page.getByRole('button', { name: 'Load newer version' }).click();
  await other.waitForTimeout(1200);
  await expect(other.getByText('This pipeline is open in another tab')).toHaveCount(0);
});

test('Q9 palette Undo is disabled with the catalog reason when there is nothing to undo', async ({
  page,
}) => {
  await openBlank(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('undo');
  const undo = page.getByRole('option', { name: /^Undo/ });
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(undo).toContainText('Nothing to undo.');
});

/* ---------- audit 5 ---------- */

/** Make every IndexedDB write fail from now on (storage full), in this page only. */
const fillStorage = (page: Page) =>
  page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
  });

test('R1 a pipeline with a failed edit, deleted to free space, does not come back on Back', async ({
  page,
}) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await saved(page);
  await fillStorage(page);
  await addNode(page, 'Sink');
  await expect(page.getByRole('status').filter({ hasText: /^Not saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Manage storage' }).click();
  await page.getByRole('button', { name: 'Delete Untitled pipeline' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('No saved pipelines yet')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('This pipeline is not saved in this browser')).toBeVisible();
});

test("R2 Cancel on the delete dialog returns focus to that row's Delete button", async ({ page }) => {
  await useScenario(page, 'Late payments');
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Merchant top-N/ }).click();
  await expect(page.getByRole('textbox', { name: 'Pipeline name' })).toHaveValue('Merchant top-N');
  await page.goto('/#/pipelines');
  const del = page.getByRole('button', { name: 'Delete Late payments' });
  await del.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(del).toBeFocused();
});

test('R3 a double click on "Delete pipeline" deletes once (one toast, one Undo)', async ({ page }) => {
  await useScenario(page, 'Late payments');
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Delete Late payments' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).dblclick();
  await expect(page.getByText('No saved pipelines yet')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.getByRole('button', { name: 'Undo', exact: true }).count()).toBe(1);
});

test('R4 after Undo of a delete elsewhere, the header is not left at "Not saved"', async ({
  page,
  context,
}) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await saved(page);
  const list = await context.newPage();
  await list.goto('/#/pipelines');
  await list.getByRole('button', { name: 'Delete Untitled pipeline' }).click();
  await list.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toBeVisible();
  await list.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toHaveCount(0);
  expect(
    await page
      .getByRole('status')
      .filter({ hasText: /^Not saved$/ })
      .count(),
  ).toBe(0);
});

test('R5 a saved pipeline\'s failed edit survives "Manage storage" and Back (still "Not saved")', async ({
  page,
}) => {
  await openBlank(page);
  await addNode(page, 'Source');
  await saved(page);
  await fillStorage(page);
  await addNode(page, 'Sink');
  await expect(page.getByRole('status').filter({ hasText: /^Not saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Manage storage' }).click();
  await page.goBack();
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: /^Not saved$/ })).toBeVisible();
});
