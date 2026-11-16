import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// A first visit: no "tour done" flag (the config marks every other test as a returning visitor).
test.use({ storageState: { cookies: [], origins: [] } });

const card = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: /./ }).filter({ hasText: /STEP \d OF 5|You know your way around/ });

test('EXPL-01 the tour starts on a first visit, walks 5 steps (T01–T05) to the done card (T06), and is not shown again', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Start blank/ }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  await expect(card(page)).toContainText('Your node library');
  await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
  await page.getByRole('button', { name: 'Next' }).click();
  // T02: a Source is there to drag ("We added payments for you").
  await expect(card(page)).toContainText('Drop a Source');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  for (const t of ['Drop a Source', 'Configure from below', 'Run, step or break it', 'Watch the watermark']) {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(card(page)).toContainText(t);
  }
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(card(page)).toContainText('You know your way around');
  await page.getByRole('button', { name: 'Start building' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('EXPL-01 Esc skips the tour (stored); the header Tour replays it; running moves step 4 on', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sl.tour.done'))).toBe('1');
  await page.getByRole('button', { name: 'Tour', exact: true }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).toContainText('Run, step or break it');
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(card(page)).toContainText('Watch the watermark');
});
