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

test('EXPL-01 audit: the tour never adds to a user pipeline, spotlights the run pill, shares Escape fairly, returns focus', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  const nodes = await page.locator('.react-flow__node').count();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).toContainText('Drop a Source');
  expect(await page.locator('.react-flow__node').count()).toBe(nodes); // a Generator pipeline gets nothing added
  expect(
    await page.evaluate(
      async () => (await import('/src/sim/store.ts')).useGraph.temporal.getState().pastStates.length,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).toContainText('Run, step or break it');
  // Step 4 lights the run pill (top centre), not the minimap (top right).
  // (The spotlight glides between targets for 300 ms.)
  const pill = await page.locator('.react-flow__panel.top.center').boundingBox();
  await expect
    .poll(async () => {
      const spot = await page.locator('[data-tour-spot]').boundingBox();
      return Math.abs(spot!.x + spot!.width / 2 - (pill!.x + pill!.width / 2));
    })
    .toBeLessThan(20);
  // An Escape that closes another dialog does not also skip the tour.
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Share pipeline' })).toHaveCount(0);
  await expect(card(page)).toContainText('Run, step or break it');
  // Skipping returns focus to where it was before the tour (here: the Share button).
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(card(page)).toHaveCount(0);
  // The tour started by itself (no opener): focus goes to the header Tour button.
  await expect(page.getByRole('button', { name: 'Tour', exact: true })).toBeFocused();
});

test('EXPL-01 audit: a shared link does not start the tour', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Start blank/ }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  const data = await page.evaluate(async () => {
    const s = await import('/src/share.ts');
    return s.encodeShare((await import('/src/sim/ShareDialog.tsx')).currentPipeline());
  });
  await page.evaluate(() => localStorage.removeItem('sl.tour.done'));
  await page.goto(`/#/s/${data}`);
  await expect(page.getByText('You are viewing a shared pipeline.')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('EXPL-01 audit 2: Escape on a menu closes only the menu; Escape on the tour card skips it even with a drawer open; honest step 2', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  // A canvas menu (role=menu): its Escape is its own.
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 600, y: 420 } });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(card(page)).toContainText('STEP 1 OF 5');
  // Step 2 on a pipeline that already has nodes adds nothing, and says so honestly.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).not.toContainText('We added');
  // A node's drawer open, focus on the tour card: Escape skips the tour.
  // (Keyboard open, NODE-01: the tour card may cover the node at 1280.)
  await page.locator('.react-flow__node').filter({ hasText: 'Rules' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /settings$/ })).toBeVisible();
  await card(page).getByRole('button', { name: 'Next' }).focus();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
});

test('EXPL-01 audit 3: a drawer opened before the tour, one Escape closes the drawer only', async ({
  page,
}) => {
  await page.goto('/#/new');
  await page.getByRole('button', { name: /^Use this scenario.*Card fraud bursts/ }).click();
  // Skip the auto tour once it is there (an Escape before it opens would let it take focus later).
  await expect(card(page)).toContainText('STEP 1 OF 5');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await page.locator('.react-flow__node').filter({ hasText: 'Rules' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /settings$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tour', exact: true }).click();
  await expect(card(page)).toContainText('STEP 1 OF 5');
  await page.locator('.react-flow__node').filter({ hasText: 'Rules' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /settings$/ })).toHaveCount(0);
  await expect(card(page)).toContainText('STEP 1 OF 5');
});
