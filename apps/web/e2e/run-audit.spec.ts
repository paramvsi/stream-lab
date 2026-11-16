import { expect, test, type Page } from '@playwright/test';

// Guards for the run audit (1d93888 + a3b04df), one per confirmed finding.
// The visible label (before this fix the status element itself was the label).
const label = (page: Page) =>
  page.locator('.react-flow__panel.top').locator('[data-run-label], [role="status"]').first();
const node = (page: Page, text: string) => page.locator('.react-flow__node').filter({ hasText: text });
async function scenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}
const finish = async (page: Page) => {
  await page.getByText('10×', { exact: true }).click();
  await page
    .locator('.react-flow__panel.top')
    .getByRole('button', { name: /^Run( again)?$/ })
    .click();
  await expect(label(page)).toHaveText(/^Finished/, { timeout: 15000 });
};
const store = (page: Page, src: string) =>
  page.evaluate(async (s) => new Function('m', s)(await import('/src/sim/store.ts')), src);

test('run audit 1: after Reset, Run uses the pipeline as it is now', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await finish(page);
  await expect(node(page, 'Rules').getByText(/failed/)).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset' }).click();
  await store(page, "m.useGraph.getState().toggleDisabled(['val'])");
  await finish(page);
  await expect(node(page, 'Rules').getByText(/failed/)).toHaveCount(0);
});

test('run audit 1+4: an edit or undo during a run pauses it and says so; Run again uses the change', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(label(page)).toHaveText(/^Running/);
  await store(page, "m.useGraph.getState().toggleDisabled(['val'])");
  await expect(label(page)).toHaveText(/^Paused/);
  await expect(
    page.getByText('The pipeline changed, so the run paused. Run again to use your changes.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Undo/ }).first().click(); // undo while paused-stale: still stale
  await finish(page);
  await expect(node(page, 'Rules').getByText(/failed/)).toHaveCount(1);
});

test('run audit 2: "out" is the main output; a sink shows what it wrote; a source shows in = out', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await finish(page);
  const sinkText = (await node(page, 'Fraud alerts').textContent()) ?? '';
  const m = sinkText.match(/in ([\d,]+) · out ([\d,]+)/)!;
  expect(m[1]).toBe(m[2]);
  const filterOut = ((await node(page, 'More than 3').textContent()) ?? '').match(/out ([\d,]+)/)![1];
  expect(filterOut).toBe(m[1]); // everything the Filter passes reaches the Sink
  await expect(node(page, 'Payments')).toContainText(/in ([\d,]+) · out \1/);
});

test('run audit 3: the live region does not tick with the event counter', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const status = page.locator('.react-flow__panel.top').getByRole('status');
  await expect(label(page)).toHaveText(/^Running/);
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    seen.add((await status.textContent()) ?? '');
    await page.waitForTimeout(100);
  }
  expect([...seen]).toHaveLength(1);
});

test('run audit 5: under reduced motion the busiest node keeps a static ring, and says so in words', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario(page, 'Card fraud bursts');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const glow = page.locator('.react-flow__node .sl-glow');
  await expect(glow).toHaveCount(1);
  expect(await glow.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe('none');
  await expect(page.locator('.react-flow__node').getByText('Busiest node right now.')).toHaveCount(1);
});

test('run audit 8: the failure badge has an icon and the catalog words (SIM-RUNTIME-EXPR)', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await finish(page);
  const badge = node(page, 'Rules').locator('[title*="events failed in Rules"]');
  await expect(badge).toHaveCount(1);
  await expect(badge.locator('svg')).toHaveCount(1);
  await expect(badge).toContainText('They were sent to Dead-letter.');
});
