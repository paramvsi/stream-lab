import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const nodes = (page: Page) => page.locator('.react-flow__node');
const add = (page: Page, type: string) =>
  page.getByRole('button', { name: new RegExp(`^${type}`) }).press('Enter');
const axe = async (page: Page, include: string) => {
  // Overlays animate in (sl-pop); measure the settled state, not a mid-fade frame.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include(include).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

async function connected(page: Page) {
  await add(page, 'Source');
  await add(page, 'Sink');
  await nodes(page).filter({ hasText: 'payments' }).click();
  await page
    .getByRole('toolbar', { name: 'Source actions' })
    .getByRole('button', { name: 'Connect to…' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: /Sink/ }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => page.goto('/'));

test('#4 the delete toast restores what was deleted even after another step', async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Sink');
  await nodes(page).filter({ hasText: 'alerts' }).click();
  await page.keyboard.press('Delete');
  await add(page, 'Filter');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(nodes(page)).toHaveCount(3); // Source, Filter and the restored Sink
});

test('#5 arrow-key moves are labelled "Moved …" in history', async ({ page }) => {
  await add(page, 'Window');
  await nodes(page).first().click();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'History' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Undo history' }).locator('[aria-current="step"]'),
  ).toHaveText('Moved Window');
});

test('#6 #7 the "+" on an edge works from the keyboard, and focus lands on the inserted node', async ({
  page,
}) => {
  await connected(page);
  const plus = page.getByRole('button', { name: 'Insert a node on this edge' });
  await plus.focus();
  await page.keyboard.press('Enter');
  const box = page.getByRole('combobox', { name: 'Search nodes to add' });
  await expect(box).toBeFocused();
  await box.fill('filter');
  await page.keyboard.press('Enter');
  await expect(nodes(page)).toHaveCount(3);
  await expect(page.locator('.react-flow__node:focus')).toContainText('Filter');
});

test('#7 Esc in quick-add returns focus to where it was opened from', async ({ page }) => {
  await add(page, 'Window');
  await nodes(page).first().focus();
  await page.keyboard.press('/');
  await expect(page.getByRole('combobox', { name: 'Search nodes to add' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nodes(page).first()).toBeFocused();
});

test('#12 hovering an edge reveals "+" and the schema (SIM-25)', async ({ page }) => {
  await connected(page);
  const plus = page.getByRole('button', { name: 'Insert a node on this edge' });
  const tools = page.locator('.sl-edge-tools'); // the fade is on the wrapper, not the button
  await page.mouse.move(5, 5); // pointer away from the edge
  await expect(tools).toHaveCSS('opacity', '0');
  // A longer edge (auto-layout: 96 px between layers) so the hover point is well away from the "+" itself.
  await page.getByRole('button', { name: 'Auto-layout' }).click();
  await page.waitForTimeout(700);
  await page.mouse.move(5, 5);
  await expect(tools).toHaveCSS('opacity', '0');
  const path = page.locator('.react-flow__edge path').first();
  const b = (await path.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.08, b.y + b.height * 0.5);
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.5);
  await expect(tools).toHaveCSS('opacity', '1');
  await expect(plus).toBeVisible();
  await expect(page.getByText('payment_id: string')).toBeVisible();
});

test('#13 axe: open quick-add (including "No nodes match") and the history popover', async ({ page }) => {
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search nodes to add' }).fill('zzz');
  expect(await axe(page, '[role="dialog"]')).toEqual([]);
  await page.keyboard.press('Escape');
  await add(page, 'Source');
  await page.getByRole('button', { name: 'History' }).click();
  expect(await axe(page, '[role="dialog"]')).toEqual([]);
});
