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
