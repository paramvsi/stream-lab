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
