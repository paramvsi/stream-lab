import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.locator('.react-flow__panel.top').getByRole('status');
async function scenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

test('SIM-16 run, pause, step, reset and speed (W09i/W09j)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await expect(status(page)).toHaveText('Ready');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(status(page)).toHaveText('Paused at event 1');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(status(page)).toHaveText('Paused at event 2');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(status(page)).toHaveText(/^Running · event [\d,]+ of [\d,]+$/);
  await expect(page.getByText(/^WM \d\d:\d\d:\d\d$/)).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(status(page)).toHaveText(/^Paused at event [\d,]+$/);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(status(page)).toHaveText('Ready');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('.react-flow__panel.top').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test('SIM-16 at 10× a 1,000-event run finishes and says so (W09k)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished · [\d,]+ events · [\d,]+ errors?$/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
});

test('SIM-ENGINE-CRASH shows its dialog; the pipeline is untouched (WX03)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const before = await page.locator('.react-flow__node').count();
  await page.evaluate(async () => {
    const m = await import('/src/sim/run.ts');
    m.useRun.setState({ state: 'crashed', crash: { n: 812, reason: 'out of memory' } });
  });
  const d = page.getByRole('dialog');
  await expect(d).toContainText('The simulator stopped at event 812: out of memory');
  await expect(d).toContainText('Your pipeline is safe.');
  await d.getByRole('button', { name: 'Reload simulator' }).click();
  await expect(d).toHaveCount(0);
  await expect(status(page)).toHaveText('Ready');
  await expect(page.locator('.react-flow__node')).toHaveCount(before);
});

test('SIM-17 while running: edges animate, node counts tick at least 5×/s, the busiest node glows', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const val = page.locator('.react-flow__node').filter({ hasText: 'Rules' });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__edge-path.sl-flow').first()).toBeAttached();
  await expect(val).toContainText(/in [\d,]+ · out [\d,]+/);
  // Sample the label for 1 s: at least 5 distinct values.
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    seen.add((await val.textContent()) ?? '');
    await page.waitForTimeout(50);
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);
  await expect(page.locator('.react-flow__node .sl-glow')).toHaveCount(1);
  // Edge counts show without hovering: not inside the hover-only tools (opacity 0 until hover).
  const label = page
    .locator('.react-flow__edgelabel-renderer')
    .getByText(/^[\d,]+$/)
    .first();
  await expect(label).toBeVisible();
  expect(await label.evaluate((e) => getComputedStyle(e.closest('.sl-edge-tools') ?? e).opacity)).toBe('1');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('.react-flow__edge-path.sl-flow')).toHaveCount(0);
});

test('SIM-18 runtime expression failures are counted on the node, in words', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  // The generator's bad rows have no amount: the Validate rule cannot evaluate them.
  await expect(
    page
      .locator('.react-flow__node')
      .filter({ hasText: 'Rules' })
      .getByText(/events failed in this node/),
  ).toHaveCount(1);
});

test('SIM-21 run panel: Timeline while running, Output opens when finished, Problems, Trace and Flink SQL explained', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await scenario(page, 'Card fraud bursts');
  const panel = page.getByRole('region', { name: 'Run panel' });
  await expect(panel.getByRole('tab')).toHaveText(['Timeline', 'Output', 'Trace', 'Flink SQL', /^Problems/]);
  await page.getByText('10×', { exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('img', { name: 'Timeline chart' })).toBeVisible();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await expect(panel.getByRole('tab', { name: /^Output/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('table', { name: /^Output of / })).toBeVisible();
  await panel.getByRole('tab', { name: 'Timeline' }).click();
  await expect(panel).toContainText(/\d+ window fires · \d+ late events/);
  await panel.getByRole('tab', { name: 'Trace' }).click();
  await expect(panel).toContainText('Tracing an event is not available yet');
  await page.screenshot({ path: `test-results/shots/${test.info().project.name}-W09k-finished.png` });
  expect(errors.filter((e) => /Maximum update depth|getSnapshot/.test(e))).toEqual([]);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('[aria-label="Run panel"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
});
