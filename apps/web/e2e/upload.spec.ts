import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const CSV = [
  'payment_id,card_id,merchant_id,amount,currency,status,ts',
  'p1,c_1,m_1,10.5,AED,approved,2026-11-15T12:00:00Z',
  'p2,c_1,m_1,abc,AED,approved,2026-11-15T12:00:01Z',
  'p3,c_2,m_2,7,USD,approved,2026-11-15T12:00:02Z',
  'p4,c_2,m_2,8,USD,approved,not a time',
  'p5,c_3,m_3,9,EUR,declined,2026-11-15T12:00:03Z',
  'p6,c_3,m_3,1,EUR,approved,2026-11-15T12:00:04Z',
].join('\n');

test('DATA-02 upload: column mapping (DATA-SCHEMA), preview, bad rows (DATA-PARSE), stored and used by the run (W12b/W12c)', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Refunds matching/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByRole('tab', { name: 'Upload file' }).click();
  await expect(d.getByText('CSV or JSON lines · stays in your browser')).toBeVisible();
  await d.getByLabel('Upload into').selectOption({ label: 'Payments' });
  await d
    .locator('input[type="file"]')
    .setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(d.getByText('Column "event_time" is missing; the Source schema needs it.')).toBeVisible();
  await d.getByLabel('event_time').selectOption('ts');
  await expect(
    d.getByText('2 of 6 rows could not be read (first: line 3: "amount" is not a number).'),
  ).toBeVisible();
  await expect(d.getByRole('table', { name: 'Rows that could not be read' }).locator('tbody tr')).toHaveCount(
    2,
  );
  await expect(d.getByRole('table', { name: 'First rows of the upload' }).locator('tbody tr')).toHaveCount(4);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
  await d.getByRole('button', { name: 'Use 4 events' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  // The upload survives a reload (OPFS + the pipeline's data.uploads) and drives the run.
  await page.reload();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('dialog', { name: 'Data' }).getByRole('tab', { name: 'Upload file' }).click();
  await expect(page.getByText('Payments reads cards.csv (4 events).')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished/, {
    timeout: 15000,
  });
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Payments' })).toContainText(
    'in 4 · out 4',
  );
});

test('DATA-TOO-LARGE: over 200 MB offers the first 200 MB or another file (WX06)', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Refunds matching/ }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Data' });
  await d.getByRole('tab', { name: 'Upload file' }).click();
  // A File whose size is over the limit, without moving 200 MB through the test: a sparse Blob in the page.
  await d.locator('input[type="file"]').evaluate((el: HTMLInputElement) => {
    const big = new File([new Uint8Array(1)], 'payments-2025.jsonl');
    Object.defineProperty(big, 'size', { value: 1.4 * 1024 * 1024 * 1024 });
    const dt = new DataTransfer();
    dt.items.add(big);
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    d.getByText('payments-2025.jsonl is 1434 MB. The simulator handles up to 200 MB per file.'),
  ).toBeVisible();
  await expect(d.getByRole('button', { name: 'Read first 200 MB' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Choose another' })).toBeVisible();
});
