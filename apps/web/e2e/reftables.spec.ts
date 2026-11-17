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

test('DATA-03 an imported table (IndexedDB refTables) is seen by checks, the preview and the run', async ({
  page,
}) => {
  await openBlank(page);
  await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    const r = await import('/src/sim/refTables.ts');
    const ids = [...new Set(r.allTables()['merchants']!.rows.map((x) => String(x['merchant_id'])))];
    await s.saveRefTable({
      name: 'merchant_flags',
      key: 'merchant_id',
      description: 'Imported: merchants under watch',
      columns: [
        { name: 'merchant_id', type: 'string', required: true },
        { name: 'flag', type: 'string', required: true },
      ],
      rows: ids.map((id) => ({ merchant_id: id, flag: 'watch' })),
    } as never);
  });
  await openBlank(page); // a workspace opened after the import loads it
  await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    const g = m.useGraph.getState();
    const gen = g.addNode('Generator', { x: 0, y: 0 });
    const l = g.addNode('Lookup', { x: 260, y: 0 }, { nodeId: gen, handleId: 'main' });
    g.updateConfig(l, {
      table: 'merchant_flags',
      key: 'merchant_id',
      tableKey: 'merchant_id',
      asOf: false,
      onMiss: 'pass',
    });
    g.addNode('Sink', { x: 520, y: 0 }, { nodeId: l, handleId: 'main' });
  });
  const panel = page.getByRole('region', { name: 'Run panel' });
  await page.waitForTimeout(400); // validation debounce
  await expect(panel).not.toContainText('Reference table "merchant_flags" is empty or missing');
  await page.locator('.react-flow__node').filter({ hasText: 'LOOKUP' }).focus();
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog', { name: 'Lookup settings' });
  await d.getByRole('tab', { name: 'Output preview' }).click();
  await expect(d.getByRole('table', { name: 'Events after the node' }).locator('tbody')).toContainText(
    'watch',
  );
  await page.keyboard.press('Escape');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished/, {
    timeout: 20000,
  });
  await panel.getByRole('tab', { name: 'Output' }).click();
  await expect(panel.getByRole('table', { name: /^Output of / })).toContainText('watch');
});

// ---- DATA-03 Upload table (board W13 button) ----
const CSV = 'merchant_id,flag,limit\nm_001,watch,100\nm_002,ok,250\n';
async function uploadTable(page: import('@playwright/test').Page, name: string, body: string) {
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Reference tables' });
  const chooser = page.waitForEvent('filechooser');
  await d.getByRole('button', { name: 'Upload table' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(body) });
  return page.getByRole('dialog', { name: 'Upload table' });
}

test('DATA-03 upload a table: saved in this browser, listed, kept after a reload, usable by a Lookup', async ({
  page,
}) => {
  await openBlank(page);
  const d = await uploadTable(page, 'Merchant flags.csv', CSV);
  await expect(d.getByLabel('Table name')).toHaveValue('merchant_flags');
  await expect(d.getByLabel('Key column')).toHaveValue('merchant_id');
  await d.getByRole('button', { name: 'Save table' }).click();
  await expect(page.getByText('Table merchant_flags saved (2 rows).').first()).toBeVisible();
  const list = page
    .getByRole('dialog', { name: 'Reference tables' })
    .getByRole('table', { name: 'Reference tables' });
  await expect(list).toContainText('merchant_flags');
  await page.reload();
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Reference tables' })).toContainText('merchant_flags');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    const g = m.useGraph.getState();
    const gen = g.addNode('Generator', { x: 0, y: 0 });
    const l = g.addNode('Lookup', { x: 260, y: 0 }, { nodeId: gen, handleId: 'main' });
    g.updateConfig(l, {
      table: 'merchant_flags',
      key: 'merchant_id',
      tableKey: 'merchant_id',
      asOf: false,
      onMiss: 'pass',
    });
    g.addNode('Sink', { x: 520, y: 0 }, { nodeId: l, handleId: 'main' });
  });
  await page.waitForTimeout(400);
  await expect(page.getByRole('region', { name: 'Run panel' })).not.toContainText(
    'Reference table "merchant_flags"',
  );
});

test('DATA-03 REF-NAME-TAKEN and REF-NO-VALID-FROM on the form; nothing saved', async ({ page }) => {
  await openBlank(page);
  const d = await uploadTable(page, 'm.csv', CSV);
  await d.getByLabel('Table name').fill('merchants');
  await d.getByLabel('Versioned').check();
  await d.getByRole('button', { name: 'Save table' }).click();
  await expect(d).toContainText('A table called "merchants" is built in; pick another name.');
  await expect(d).toContainText(
    'A versioned table needs a "valid_from" column (ISO time); this file has none.',
  );
  expect(
    await page.evaluate(async () => (await (await import('/src/storage.ts')).listRefTables()).length),
  ).toBe(0);
});

test('DATA-03 rows with a blank key are left out and said so (DATA-PARSE)', async ({ page }) => {
  await openBlank(page);
  const d = await uploadTable(page, 'm.csv', CSV + ',blank,5\n');
  await expect(d).toContainText(
    '1 of 3 rows could not be read (first: line 4: no merchant_id). They are left out.',
  );
  await expect(d).toContainText('2 rows');
});

test('DATA-03 a failed save says why (STORE-BLOCKED) and the form keeps its content', async ({ page }) => {
  await openBlank(page);
  const d = await uploadTable(page, 'm.csv', CSV);
  await d.getByLabel('Table name').fill('my_flags');
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('no', 'UnknownError');
    };
  });
  await d.getByRole('button', { name: 'Save table' }).click();
  await expect(d).toContainText('This browser is not letting Stream Lab save.');
  await expect(d.getByLabel('Table name')).toHaveValue('my_flags');
});

test('DATA-03 delete an imported table, after a confirmation; built-in ones have no delete', async ({
  page,
}) => {
  await openBlank(page);
  const d = await uploadTable(page, 'Merchant flags.csv', CSV);
  await d.getByRole('button', { name: 'Save table' }).click();
  const drawer = page.getByRole('dialog', { name: 'Reference tables' });
  await drawer.getByRole('row', { name: /merchants/ }).click();
  await expect(page.getByRole('button', { name: 'Delete table' })).toHaveCount(0);
  await page.getByRole('button', { name: 'All tables' }).click();
  await drawer.getByRole('row', { name: /merchant_flags/ }).click();
  await page.getByRole('button', { name: 'Delete table' }).click();
  const confirm = page
    .getByRole('alertdialog', { name: 'Delete table merchant_flags?' })
    .or(page.getByRole('dialog', { name: 'Delete table merchant_flags?' }));
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Table merchant_flags deleted.').first()).toBeVisible();
  await expect(drawer.getByRole('table', { name: 'Reference tables' })).not.toContainText('merchant_flags');
  expect(
    await page.evaluate(async () => (await (await import('/src/storage.ts')).listRefTables()).length),
  ).toBe(0);
});

// ---- DATA-03 audit (971f5ed) ----
test('DATA-03 audit: a tab still open on the old database version does not hang this one (STORE-UPGRADE-BLOCKED)', async ({
  context,
}) => {
  const old = await context.newPage();
  // Same origin, no app code: an old deploy's tab holding a version 1 connection. A real static file: a missing one
  // falls back to index.html, whose app opens version 2 first, and this open then fails.
  await old.goto('/logo-mark.svg');
  await old.evaluate(
    () =>
      new Promise<void>((ok, fail) => {
        const r = indexedDB.open('streamlab', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('pipelines', { keyPath: 'id' });
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          (window as unknown as { keep: IDBDatabase }).keep = r.result;
          ok();
        };
      }),
  );
  const page = await context.newPage();
  await page.goto('/#/pipelines');
  await expect(
    page.getByText('Stream Lab was updated in another tab. Close its other tabs, then reload this one.'),
  ).toBeVisible({
    timeout: 8000,
  });
});

test('DATA-03 audit: a table change during a paused run marks it changed (Run again)', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  const pill = page.locator('.react-flow__panel.top');
  await pill.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(pill.locator('[data-run-label]')).toHaveText(/^Paused/);
  await page.evaluate(async () => {
    const r = await import('/src/sim/refTables.ts');
    r.useRefTables.setState({
      user: { extra: { name: 'extra', key: 'id', description: '', columns: [], rows: [] } },
    });
  });
  await expect(pill.getByRole('button', { name: 'Run again' })).toBeVisible();
});

test('DATA-03 audit: tables that can not be loaded show the storage banner (catalog: banner), not a stray rejection', async ({
  page,
}) => {
  const rejections: string[] = [];
  page.on('pageerror', (e) => rejections.push(e.message));
  await page.addInitScript(() => {
    const orig = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...a: Parameters<typeof orig>) {
      if (this.name === 'refTables') throw new DOMException('no', 'UnknownError');
      return orig.apply(this, a);
    };
  });
  await openBlank(page);
  await expect(page.getByText('This browser is not letting Stream Lab save.').first()).toBeVisible();
  expect(rejections).toEqual([]);
});

// ---- DATA-03 upload audit (81fc521): focus and the way back ----
test('DATA-03 audit: focus returns to "Upload table" after Cancel, Save and Delete; a cancelled chooser has a way back', async ({
  page,
}) => {
  await openBlank(page);
  const upload = page
    .getByRole('dialog', { name: 'Reference tables' })
    .getByRole('button', { name: 'Upload table' });
  // Cancel.
  let d = await uploadTable(page, 'm.csv', CSV);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(upload).toBeFocused();
  // Save.
  const chooser = page.waitForEvent('filechooser');
  await upload.click();
  await (await chooser).setFiles({ name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  d = page.getByRole('dialog', { name: 'Upload table' });
  await d.getByRole('button', { name: 'Save table' }).click();
  await expect(upload).toBeFocused();
  // Delete.
  await page.getByRole('dialog', { name: 'Reference tables' }).getByRole('row', { name: /^m / }).click();
  await page.getByRole('button', { name: 'Delete table' }).click();
  await page
    .getByRole('dialog', { name: 'Delete table m?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(upload).toBeFocused();
  // A cancelled chooser: the empty form has a way back.
  const c2 = page.waitForEvent('filechooser');
  await upload.click();
  await (await c2).setFiles([]);
  await page
    .getByRole('dialog', { name: 'Upload table' })
    .getByRole('button', { name: 'Back to tables' })
    .click();
  await expect(upload).toBeFocused();
});
