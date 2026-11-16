import { expect, test, type Page } from '@playwright/test';

// Guards for the upload audit (0672c37, 07adb37, 062b2b3), one per confirmed finding.
const CSV = [
  'payment_id,card_id,merchant_id,amount,currency,status,event_time',
  'p1,c_1,m_1,10.5,AED,approved,2026-11-15T12:00:00Z',
  'p2,c_2,m_2,7,USD,approved,2026-11-15T12:00:02Z',
  'p3,c_3,m_3,9,EUR,declined,2026-11-15T12:00:03Z',
].join('\n');
const label = (page: Page) => page.locator('.react-flow__panel.top [data-run-label]');
const payments = (page: Page) => page.locator('.react-flow__node').filter({ hasText: 'Payments' });

async function upload(page: Page) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Refunds matching/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByRole('tab', { name: 'Upload file' }).click();
  await d.getByLabel('Upload into').selectOption({ label: 'Payments' });
  await d
    .locator('input[type="file"]')
    .setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await d.getByRole('button', { name: 'Use 3 events' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}
const run = async (page: Page) => {
  await page.getByText('10×', { exact: true }).click();
  await page
    .locator('.react-flow__panel.top')
    .getByRole('button', { name: /^Run( again)?$/ })
    .click();
  await expect(label(page)).toHaveText(/^Finished/, { timeout: 15000 });
};
const opfs = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    try {
      const up = await (await navigator.storage.getDirectory()).getDirectoryHandle('uploads');
      for await (const [p, h] of (
        up as unknown as { entries(): AsyncIterable<[string, FileSystemDirectoryHandle]> }
      ).entries())
        for await (const [f] of (h as unknown as { entries(): AsyncIterable<[string]> }).entries())
          out.push(`${p}/${f}`);
    } catch {
      // no uploads folder
    }
    return out;
  });

test('upload audit 1: a duplicated pipeline still reads its upload', async ({ page }) => {
  await upload(page);
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Duplicate Refunds matching' }).click();
  await page.getByRole('link', { name: 'Refunds matching copy' }).click();
  await run(page);
  await expect(payments(page)).toContainText('in 3 · out 3');
});

test('upload audit 1: rows missing from this browser are said, at run and in the Upload tab (DATA-UPLOAD-UNUSED)', async ({
  page,
}) => {
  await upload(page);
  await page.evaluate(async () =>
    (await navigator.storage.getDirectory()).removeEntry('uploads', { recursive: true }),
  );
  await run(page);
  await expect(
    page.getByText('Payments uses the generator in this run: cards.csv is not in this browser.').first(),
  ).toBeVisible();
  // The catalog action opens the Data drawer.
  await page.getByRole('button', { name: 'Open data' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Data' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('dialog', { name: 'Data' }).getByRole('tab', { name: 'Upload file' }).click();
  await expect(
    page.getByText(/cards\.csv is not in this browser, so Payments uses the generator/),
  ).toBeVisible();
});

test('upload audit 6: the node preview shows the uploaded rows', async ({ page }) => {
  await upload(page);
  await payments(page).dblclick();
  const cards = page
    .getByRole('dialog', { name: 'Source settings' })
    .getByRole('table', { name: 'Live preview' })
    .locator('tbody td:nth-child(2)');
  await expect(cards.first()).toBeVisible();
  // Exact values: generated ids like c_1008 also contain "c_1".
  await expect.poll(async () => (await cards.allTextContents()).join(',')).toBe('c_1,c_2,c_3');
});

test('upload audit 7: deleting a pipeline frees its uploaded rows', async ({ page }) => {
  await upload(page);
  expect((await opfs(page)).length).toBe(1);
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Delete Refunds matching' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  // Deleting marks the rows (Undo and "Keep a copy" may still need them); they are freed after the grace period.
  await expect.poll(async () => (await opfs(page)).some((f) => f.endsWith('/.deleted'))).toBe(true);
  await page.evaluate(async () =>
    (await import('/src/sim/uploads.ts')).purgeDeletedUploads(new Set(), Date.now() + 11 * 60_000),
  );
  await expect.poll(() => opfs(page)).toEqual([]);
});

test('upload audit 4: a refused store shows the catalog banner in the panel (STORE-BLOCKED), not a toast', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Refunds matching/ }).click();
  await page.evaluate(() => {
    navigator.storage.getDirectory = () => Promise.reject(new DOMException('no', 'SecurityError'));
  });
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByRole('tab', { name: 'Upload file' }).click();
  await d.getByLabel('Upload into').selectOption({ label: 'Payments' });
  await d
    .locator('input[type="file"]')
    .setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await d.getByRole('button', { name: 'Use 3 events' }).click();
  await expect(d.getByText(/This browser is not letting Stream Lab save/)).toBeVisible();
});

test('upload audit 12: a file that can not be read says so (DATA-READ-FAILED), not "Reading…" forever', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Refunds matching/ }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByRole('tab', { name: 'Upload file' }).click();
  await d.locator('input[type="file"]').evaluate((el: HTMLInputElement) => {
    const f = new File(['x'], 'gone.csv');
    Object.defineProperty(f, 'stream', {
      value: () =>
        new ReadableStream({
          pull(c) {
            c.error(new DOMException('moved', 'NotReadableError'));
          },
        }),
    });
    const dt = new DataTransfer();
    dt.items.add(f);
    Object.defineProperty(el, 'files', { value: { 0: f, length: 1, item: () => f } });
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    d.getByText('gone.csv could not be read: it was moved or can no longer be opened.'),
  ).toBeVisible();
});

// ---- Fintech/upload audit (0a15d0c + 423fd75) ----
test('upload audit 2: "Keep a copy" after another tab deleted the pipeline keeps its upload', async ({
  page,
  context,
}) => {
  await upload(page);
  const other = await context.newPage();
  await other.goto('/#/pipelines');
  await other.getByRole('button', { name: 'Delete Refunds matching' }).click();
  await other.getByRole('button', { name: 'Delete pipeline' }).click();
  await expect(page.getByText('This pipeline was deleted in another tab.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep a copy' }).click();
  await expect(page.getByRole('textbox', { name: 'Pipeline name' })).toHaveValue(/\(copy\)$/);
  await run(page);
  await expect(payments(page)).toContainText('in 3 · out 3');
});

test('upload audit 3: undoing a delete keeps the upload', async ({ page }) => {
  await upload(page);
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Delete Refunds matching' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('link', { name: 'Refunds matching' }).click();
  await run(page);
  await expect(payments(page)).toContainText('in 3 · out 3');
});

test('DATA-04 My pipelines shows storage used and each pipeline’s uploaded data, and can delete it', async ({
  page,
}) => {
  await upload(page);
  await page.goto('/#/pipelines');
  await expect(
    page.getByText(/^Storage: .+ used of .+ this browser gives Stream Lab; uploaded data: \d+ KB\.$/),
  ).toBeVisible();
  const row = page
    .getByRole('table', { name: 'My pipelines' })
    .locator('tbody tr')
    .filter({ hasText: 'Refunds matching' });
  await expect(row).toContainText('1 KB');
  await page.getByRole('button', { name: 'Delete uploaded data of Refunds matching' }).click();
  const dlg = page.getByRole('dialog', { name: 'Delete uploaded data of "Refunds matching"?' });
  await expect(dlg).toContainText('The pipeline stays');
  await dlg.getByRole('button', { name: 'Delete uploaded data' }).click();
  await expect(page.getByText('Uploaded data of "Refunds matching" deleted.', { exact: true })).toBeVisible();
  await expect(row.locator('td').nth(4)).toHaveText('—');
  expect(await opfs(page)).toEqual([]);
  // The pipeline no longer claims the upload.
  await page.getByRole('link', { name: 'Refunds matching' }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('dialog', { name: 'Data' }).getByRole('tab', { name: 'Upload file' }).click();
  await expect(page.getByText(/reads cards\.csv|cards\.csv is not in this browser/)).toHaveCount(0);
});

// ---- Chaos audit (c90bf2f + b24facb) ----
test('chaos audit 3: the Data drawer opened from a toast returns focus to the Data button', async ({
  page,
}) => {
  await upload(page);
  await page.evaluate(async () =>
    (await navigator.storage.getDirectory()).removeEntry('uploads', { recursive: true }),
  );
  await page.getByText('10×', { exact: true }).click();
  await page
    .locator('.react-flow__panel.top')
    .getByRole('button', { name: /^Run( again)?$/ })
    .click();
  await page.getByRole('button', { name: 'Open data' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Data' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Data', exact: true })).toBeFocused();
});

test('chaos audit 7: Chaos is off on a run the pipeline has moved past', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await page.getByText('0.25×', { exact: true }).click();
  const pill = page.locator('.react-flow__panel.top');
  await pill.getByRole('button', { name: 'Run', exact: true }).click();
  // Edit only once the run has loaded (an edit before that is simply part of the run).
  await expect(pill.locator('[data-run-label]')).toHaveText(/^Running/);
  await page.evaluate(async () =>
    (await import('/src/sim/store.ts')).useGraph.getState().toggleDisabled(['flt']),
  );
  await expect(pill.locator('[data-run-label]')).toHaveText(/^Paused/);
  await expect(pill.getByRole('button', { name: 'Chaos' })).toHaveAttribute('aria-disabled', 'true');
});

// ---- Storage audit (34c7fad + 09be746) ----
const toMyPipelines = async (page: Page) => {
  await page.goto('/#/pipelines');
  await expect(page.getByRole('table', { name: 'My pipelines' })).toBeVisible();
};

test('storage audit 1: a failed "Delete uploaded data" says so (DATA-DELETE-FAILED), with no success toast', async ({
  page,
}) => {
  await upload(page);
  await toMyPipelines(page);
  await page.evaluate(() => {
    const orig = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function (name: string, o?: FileSystemRemoveOptions) {
      if (this.name === 'uploads')
        return Promise.reject(new DOMException('busy', 'NoModificationAllowedError'));
      return orig.call(this, name, o);
    };
  });
  await page.getByRole('button', { name: 'Delete uploaded data of Refunds matching' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete uploaded data' }).click();
  await expect(page.getByText('could not be deleted: another tab is using it.')).toBeVisible();
  expect(await page.getByText(/Uploaded data of .* deleted\./).count()).toBe(0);
});

test('storage audit 2: when the delete marker can not be written, Undo still brings the rows back', async ({
  page,
}) => {
  await upload(page);
  await toMyPipelines(page);
  await page.evaluate(() => {
    const orig = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (o?: FileSystemCreateWritableOptions) {
      if (this.name === '.deleted') return Promise.reject(new DOMException('full', 'QuotaExceededError'));
      return orig.call(this, o);
    };
  });
  await page.getByRole('button', { name: 'Delete Refunds matching' }).click();
  await page.getByRole('button', { name: 'Delete pipeline' }).click();
  // Another visit to My pipelines purges before the Undo (audit: an empty marker read as "long deleted").
  // The delete marks its rows in the background: give it a moment before the purge.
  await page.waitForTimeout(300);
  await page.evaluate(async () => (await import('/src/sim/uploads.ts')).purgeDeletedUploads(new Set()));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: 'Refunds matching' })).toBeVisible();
  await expect
    .poll(() => opfs(page))
    .toEqual(expect.arrayContaining([expect.stringMatching(/\/pay\.jsonl$/)]));
});

test('storage audit 6+7+8: focus lands on the list after freeing, usage follows Duplicate, a double click frees once', async ({
  page,
}) => {
  await upload(page);
  await toMyPipelines(page);
  await page.getByRole('button', { name: 'Duplicate Refunds matching' }).click();
  const copyRow = page
    .getByRole('table', { name: 'My pipelines' })
    .locator('tbody tr')
    .filter({ hasText: 'Refunds matching copy' });
  await expect(copyRow).toContainText('1 KB');
  await page.getByRole('button', { name: 'Delete uploaded data of Refunds matching copy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete uploaded data' }).dblclick();
  await expect(page.getByText('Uploaded data of "Refunds matching copy" deleted.').first()).toBeVisible();
  expect(
    await page.locator('li').filter({ hasText: 'Uploaded data of "Refunds matching copy" deleted.' }).count(),
  ).toBe(1);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('A');
});

// ---- Inspector/storage audit (00b017a + 8e09ce0) ----
test('purge audit 2: a copy still being saved (fresh rows, no pipeline yet) is not marked or freed', async ({
  page,
}) => {
  await upload(page);
  await page.evaluate(async () => {
    const u = await import('/src/sim/uploads.ts');
    await u.saveRows('p_race', 'pay', [{ a: 1 }]); // rows written, pipeline not saved yet
    await u.purgeDeletedUploads(new Set()); // a My pipelines visit with a list that lacks p_race
  });
  // The stale-list visit must not even mark the fresh rows (the rule under test, not the later unmark).
  expect((await opfs(page)).filter((f) => f.startsWith('p_race/'))).toEqual(['p_race/pay.jsonl']);
  await page.evaluate(async () => {
    const u = await import('/src/sim/uploads.ts');
    // The copy is saved; a later visit (after the grace period) knows it.
    await u.purgeDeletedUploads(new Set(['p_race']), Date.now() + 11 * 60_000);
  });
  expect((await opfs(page)).filter((f) => f.startsWith('p_race/'))).toEqual(['p_race/pay.jsonl']);
});

test('purge audit 3: one folder another tab holds does not stop the purge or throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await upload(page);
  await page.evaluate(async () => {
    const u = await import('/src/sim/uploads.ts');
    await u.saveRows('p_old1', 'pay', [{ a: 1 }]);
    await u.saveRows('p_old2', 'pay', [{ a: 1 }]);
    await u.deleteUploads('p_old1');
    await u.deleteUploads('p_old2');
    const orig = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function (name: string, o?: FileSystemRemoveOptions) {
      if (name === 'p_old1') return Promise.reject(new DOMException('busy', 'NoModificationAllowedError'));
      return orig.call(this, name, o);
    };
    // Must not reject (in the app that is an unhandled error), whatever order the folders come in.
    await u.purgeDeletedUploads(new Set(), Date.now() + 11 * 60_000);
  });
  const left = await opfs(page);
  expect(left.some((f) => f.startsWith('p_old1/'))).toBe(true); // held: kept for the next pass
  expect(left.some((f) => f.startsWith('p_old2/'))).toBe(false); // the pass went on
  expect(errors).toEqual([]);
});

test('purge audit 4: a failed "Delete uploaded data" leaves the pipeline using its rows', async ({
  page,
}) => {
  await upload(page);
  await page.goto('/#/pipelines');
  await page.evaluate(() => {
    const orig = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function (name: string, o?: FileSystemRemoveOptions) {
      if (this.name === 'uploads')
        return Promise.reject(new DOMException('busy', 'NoModificationAllowedError'));
      return orig.call(this, name, o);
    };
  });
  await page.getByRole('button', { name: 'Delete uploaded data of Refunds matching' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete uploaded data' }).click();
  await expect(page.getByText('could not be deleted: another tab is using it.')).toBeVisible();
  await page.getByRole('link', { name: 'Refunds matching' }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('dialog', { name: 'Data' }).getByRole('tab', { name: 'Upload file' }).click();
  await expect(page.getByText('Payments reads cards.csv (3 events).')).toBeVisible();
});

// ---- Purge audit (007dbab) ----
test('purge audit 5: a folder cleanup can not handle does not break My pipelines (usage and delete stay)', async ({
  page,
}) => {
  await upload(page);
  const bad = await page.evaluate(async () => {
    const u = await import('/src/sim/uploads.ts');
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('uploads');
    // Nine folders deleted long ago (marker time 1).
    for (let i = 0; i < 9; i++) {
      await u.saveRows(`p_old${i}`, 'pay', [{ a: 1 }]);
      const w = await (
        await (await root.getDirectoryHandle(`p_old${i}`)).getFileHandle('.deleted', { create: true })
      ).createWritable();
      await w.write('1');
      await w.close();
    }
    // OPFS listing order is not stable between runs, so the one that fails is the first listed: the pass must
    // still reach the eight after it.
    let first = '';
    for await (const [n] of (root as unknown as { entries(): AsyncIterable<[string]> }).entries())
      if (!first && n.startsWith('p_old')) first = n;
    const orig = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function (name: string, o?: FileSystemRemoveOptions) {
      if (name === first) return Promise.reject(new DOMException('odd', 'UnknownError'));
      return orig.call(this, name, o);
    };
    return first;
  });
  await page.getByRole('link', { name: 'stream lab' }).click(); // to My pipelines, same page (patch kept)
  await expect(page.getByText(/^Storage: /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete uploaded data of Refunds matching' })).toBeVisible();
  expect(await page.getByText(/not letting Stream Lab save/).count()).toBe(0);
  // The pass ran, kept the folder it could not free, and went on to free all the others.
  await expect
    .poll(async () => (await opfs(page)).filter((f) => f.startsWith('p_old')).sort())
    .toEqual([`${bad}/.deleted`, `${bad}/pay.jsonl`].sort());
});

test('purge audit 6: a stale unsaved entry in this tab does not undo another tab’s delete marker', async ({
  page,
}) => {
  await upload(page);
  await page.evaluate(async () => {
    const u = await import('/src/sim/uploads.ts');
    const s = await import('/src/storage.ts');
    await u.saveRows('p_x', 'pay', [{ a: 1 }]);
    s.unsaved.set('p_x', { id: 'p_x' } as never); // a failed autosave long ago, then the user left it
    await u.deleteUploads('p_x'); // another tab deleted it
  });
  await page.getByRole('link', { name: 'stream lab' }).click();
  await expect(page.getByText(/^Storage: /)).toBeVisible();
  await page.waitForTimeout(300);
  const files = await opfs(page);
  expect(files).toContain('p_x/.deleted');
});

test('purge audit 7: rows of a pipeline only in this tab’s memory survive a real My pipelines visit 11 min later', async ({
  page,
}) => {
  await page.clock.install();
  await upload(page);
  await page.evaluate(async () => {
    const u = await import('/src/sim/uploads.ts');
    const s = await import('/src/storage.ts');
    await u.saveRows('p_mem', 'pay', [{ a: 1 }]);
    s.unsaved.set('p_mem', { id: 'p_mem' } as never); // its first save failed; this tab still holds it
  });
  await page.clock.fastForward(11 * 60_000); // the rows are now older than the grace period
  await page.getByRole('link', { name: 'stream lab' }).click();
  await expect(page.getByText(/^Storage: /)).toBeVisible();
  await page.waitForTimeout(500); // the purge runs before the usage line; let any marker write settle
  expect((await opfs(page)).filter((f) => f.startsWith('p_mem/'))).toEqual(['p_mem/pay.jsonl']);
});
