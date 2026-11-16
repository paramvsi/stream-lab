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

// ---- Run panel audit (4d80476 + b2ee3b2) ----
const pill = (page: Page) => page.locator('.react-flow__panel.top');
const panel = (page: Page) => page.getByRole('region', { name: 'Run panel' });

test('panel audit 1: a change that blocks the run offers no "Run again" and nothing runs', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await pill(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(label(page)).toHaveText(/^Running/);
  await store(page, "m.useGraph.getState().toggleDisabled(['gen'])");
  const toast = page.getByText('The pipeline changed, so the run paused. Run again to use your changes.', {
    exact: true,
  });
  await expect(toast).toBeVisible();
  // Count once, now (the toast closes by itself, so a retrying toHaveCount(0) would always pass).
  expect(await page.locator('button:not(.react-flow__panel *)', { hasText: 'Run again' }).count()).toBe(0);
  await page.evaluate(async () => (await import('/src/sim/run.ts')).runner.play());
  await page.waitForTimeout(800);
  await expect(label(page)).not.toHaveText(/^(Running|Finished)/);
});

test('panel audit 2: a wall-clock jump (sleep, frozen tab) is not an engine crash', async ({ page }) => {
  await page.clock.install();
  await scenario(page, 'Card fraud bursts');
  await pill(page).getByRole('button', { name: 'Step' }).click();
  await expect(label(page)).toHaveText('Paused at event 1');
  await page.clock.fastForward(5000);
  await page.waitForTimeout(300);
  await expect(page.getByText('Your pipeline is safe.')).toHaveCount(0);
});

test('panel audit 3: a Route counts every branch as "out"', async ({ page }) => {
  await scenario(page, 'Card velocity');
  await page.getByText('10×', { exact: true }).click();
  await pill(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(label(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await expect(page.locator('.react-flow__node').filter({ hasText: 'ROUTE' })).toContainText(
    /in ([\d,]+) · out \1/,
  );
});

test('panel audit 6: when a run finishes, focus in the panel stays in the panel', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await pill(page).getByRole('button', { name: 'Run', exact: true }).click();
  await panel(page)
    .getByRole('tab', { name: /^Problems/ })
    .click();
  // Focus inside the tab's content (its filter), which unmounts if the panel switches tabs.
  await panel(page).getByRole('tabpanel').getByRole('button').first().focus();
  await expect(label(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Run panel"]'))).toBe(true);
});

test('panel audit 7: an edit after a finished run does not say the run paused', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await pill(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(label(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await store(page, "m.useGraph.getState().toggleDisabled(['flt'])");
  await page.waitForTimeout(800);
  // Count once, now: toHaveCount(0) would retry until the toast closes by itself.
  expect(await page.getByText(/The pipeline changed, so the run paused/).count()).toBe(0);
});

test('panel audit renames: renaming a node during a run pauses it (labels reach the output)', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('0.25×', { exact: true }).click();
  await pill(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(label(page)).toHaveText(/^Running/);
  await store(page, "m.useGraph.getState().rename('gen', 'Card payments')");
  await expect(label(page)).toHaveText(/^Paused/);
});

test('panel audit 9: when the pipeline stops being runnable, the Problems tab opens', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await pill(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(label(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } }); // focus out of the panel
  await store(page, "m.useGraph.getState().toggleDisabled(['gen'])");
  await expect(panel(page).getByRole('tab', { name: /^Problems/ })).toHaveAttribute('aria-selected', 'true');
});
