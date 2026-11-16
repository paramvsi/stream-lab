import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function finished(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished/, {
    timeout: 20000,
  });
}
const card = (page: Page) => page.getByRole('dialog', { name: /./ }).filter({ hasText: /EXPLAIN THIS RUN/ });

test('EXPL-02 explain an output row: its path, step badges, dimmed nodes, narration with values; ←/→ and Esc', async ({
  page,
}) => {
  await finished(page, 'Card fraud bursts');
  const panel = page.getByRole('region', { name: 'Run panel' });
  await panel.getByRole('tab', { name: 'Output' }).click();
  await panel
    .getByRole('table', { name: /^Output of / })
    .locator('tbody tr')
    .first()
    .click();
  // Picking a row traces it (EXPL-03); Explain step by step walks one path (EXPL-02).
  await panel.getByRole('button', { name: 'Explain step by step' }).click();
  await expect(card(page)).toContainText('EXPLAIN THIS RUN · 1 OF');
  await expect(card(page)).toContainText('An event arrives');
  await expect(card(page)).toContainText(/Payment c_\d+ · [\d,]+\.\d\d enters from /);
  // Off the path: dimmed. On it: a step badge.
  const dimmed = await page.locator('.react-flow__node > div[style*="opacity: 0.35"]').count();
  expect(dimmed).toBeGreaterThan(0); // the Dead-letter is not on an alert's path
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Explain step 1' })).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(card(page)).toContainText('· 2 OF');
  await page.keyboard.press('ArrowLeft');
  await expect(card(page)).toContainText('· 1 OF');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight'); // arrives, rules, window
  await expect(card(page)).toContainText('The window fires');
  // Measured at rest: the card has the dialogs' entrance (sl-pop).
  await card(page).evaluate((e) => Promise.all(e.getAnimations().map((x) => x.finished)));
  expect((await new AxeBuilder({ page }).include('[data-explain-card]').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  // The row stays traced (its marks stay) until the trace is cleared.
  await panel.getByRole('button', { name: 'Clear trace' }).click();
  expect(await page.locator('.react-flow__node > div[style*="opacity: 0.35"]').count()).toBe(0);
});

test('EXPL-02 the header Explain run picks an output row by itself; the last step is the sink', async ({
  page,
}) => {
  await finished(page, 'Card fraud bursts');
  await page.getByRole('button', { name: 'Explain run', exact: true }).click();
  await expect(card(page)).toContainText('EXPLAIN THIS RUN · 1 OF');
  const total = Number((await card(page).innerText()).match(/1 OF (\d+)/)![1]);
  for (let i = 1; i < total; i++) await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).toContainText('It reaches Fraud alerts');
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(card(page)).toHaveCount(0);
});

test('EXPL-03 trace: picking an output row lists every node behind it (E06) and marks them on the canvas', async ({
  page,
}) => {
  await finished(page, 'Card fraud bursts');
  const panel = page.getByRole('region', { name: 'Run panel' });
  await panel.getByRole('tab', { name: 'Output' }).click();
  await panel
    .getByRole('table', { name: /^Output of / })
    .locator('tbody tr')
    .first()
    .click();
  await expect(panel.getByRole('tab', { name: 'Trace' })).toHaveAttribute('aria-selected', 'true');
  const list = panel.getByRole('list');
  await expect(list).toContainText('Payments');
  await expect(list).toContainText(/\d+ events?, \d\d:\d\d:\d\d|1 event at/);
  await expect(list).toContainText('Bursts per card');
  await expect(list).toContainText('Fired at watermark');
  // On the canvas: contributors numbered, the rest dimmed (the Dead-letter did not contribute).
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Explain step 1' })).toHaveCount(1);
  expect(await page.locator('.react-flow__node > div[style*="opacity: 0.35"]').count()).toBeGreaterThan(0);
  await panel.getByRole('button', { name: 'Clear trace' }).click();
  expect(await page.locator('.react-flow__node > div[style*="opacity: 0.35"]').count()).toBe(0);
});
