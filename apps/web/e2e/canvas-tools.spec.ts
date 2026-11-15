import { expect, test, type Page } from '@playwright/test';

const nodes = (page: Page) => page.locator('.react-flow__node');

async function add(page: Page, type: string) {
  await page.getByRole('button', { name: new RegExp(`^${type}`) }).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('SIM-10 toolbar on single selection: duplicate, disable, delete', async ({ page }) => {
  await add(page, 'Window');
  await nodes(page).first().click();
  const bar = page.getByRole('toolbar', { name: 'Window actions' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Duplicate' }).click();
  await expect(nodes(page)).toHaveCount(2);
  // Two selected after duplicate? Duplicate selects the copy only, so the toolbar stays.
  await page
    .getByRole('toolbar', { name: 'Window actions' })
    .getByRole('button', { name: 'Disable' })
    .click();
  await expect(nodes(page).filter({ hasText: 'disabled' })).toHaveCount(1);
  await page.getByRole('toolbar', { name: 'Window actions' }).getByRole('button', { name: 'Delete' }).click();
  await expect(nodes(page)).toHaveCount(1);
  await expect(page.getByText('Deleted 1 node(s).').first()).toBeVisible();
});

test('SIM-10 context menus: node and pane', async ({ page }) => {
  await add(page, 'Filter');
  await nodes(page).first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Node menu' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^Configure/,
    /^Run to here/,
    /^Duplicate/,
    /^Disable/,
    /^Connect to…/,
    /^Delete/,
  ]);
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 40, y: 40 } });
  await expect(
    page.getByRole('menu', { name: 'Canvas menu' }).getByRole('menuitem', { name: 'Auto-layout' }),
  ).toBeVisible();
});

test('D21 connect by keyboard: Connect to… lists targets with refusal reasons', async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Sink');
  await nodes(page).filter({ hasText: 'SOURCE' }).click();
  await page
    .getByRole('toolbar', { name: 'Source actions' })
    .getByRole('button', { name: 'Connect to…' })
    .click();
  const dialog = page.getByRole('dialog', { name: /Connect Source to/ });
  await dialog.getByRole('button', { name: /Sink/ }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  // Second time the same target is refused with the catalog reason, not hidden.
  await nodes(page).filter({ hasText: 'SOURCE' }).click();
  await page
    .getByRole('toolbar', { name: 'Source actions' })
    .getByRole('button', { name: 'Connect to…' })
    .click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Sink/ })).toHaveAccessibleDescription(
    'These two ports are already connected.',
  );
});

test('SIM-13 auto-layout spreads nodes left to right; Undo restores in one step', async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Sink');
  const before = await nodes(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  await page.getByRole('button', { name: 'Auto-layout' }).click();
  await expect(page.getByText('Layout applied').first()).toBeVisible();
  // No overlap once the 300 ms animation has run.
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([0, 1].map(async (i) => (await nodes(page).nth(i).boundingBox())!));
      return Math.abs(a!.x - b!.x) >= a!.width || Math.abs(a!.y - b!.y) >= a!.height;
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() => nodes(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform)))
    .toEqual(before);
});

test("SIM-05 helper lines appear while dragging across another node's alignment", async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Sink');
  const first = (await nodes(page).nth(0).boundingBox())!;
  const b = (await nodes(page).nth(1).boundingBox())!;
  // Record whether a guide line ever appears (grid snapping makes the exact aligned frame hard to hit).
  await page.evaluate(() => {
    const w = window as unknown as { sawGuide: boolean };
    w.sawGuide = false;
    new MutationObserver(() => {
      if (document.querySelector('.react-flow__viewport-portal line')) w.sawGuide = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + 320, { steps: 10 });
  // Sweep across the first node's left edge in 2 px steps.
  await page.mouse.move(first.x + 40 - 30, b.y + 320, { steps: 10 });
  await page.mouse.move(first.x + 40 + 30, b.y + 320, { steps: 30 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { sawGuide: boolean }).sawGuide)).toBe(true);
  // Lines disappear when the drag ends.
  await expect(page.locator('.react-flow__viewport-portal line')).toHaveCount(0);
});

test('NODE-01 Enter on a focused node opens settings; Esc returns focus to it', async ({ page }) => {
  await add(page, 'Window');
  const node = nodes(page).first();
  await node.focus();
  await page.keyboard.press('Enter');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toBeVisible();
  await name.fill('Bursts per card');
  await name.blur();
  await expect(node).toContainText('Bursts per card');
  await page.keyboard.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(node).toBeFocused();
});
