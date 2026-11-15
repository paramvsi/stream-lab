import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBlank } from './helpers';

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

test.beforeEach(async ({ page }) => openBlank(page));

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

/* ---------- audit 2 ---------- */

test('A2#1 after an undo the toolbar still shows for a single selection', async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Filter');
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await nodes(page).first().click();
  await expect(page.getByRole('toolbar', { name: 'Source actions' })).toBeVisible();
});

test('A2#3 the layout toast puts back the layout, not the last step', async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Sink');
  const before = await nodes(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  await page.getByRole('button', { name: 'Auto-layout' }).click();
  await page.waitForTimeout(500); // layout animation
  // Deselect first: the selected Sink's toolbar can sit over the Source after layout.
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 30 } });
  await nodes(page).first().click();
  await page
    .getByRole('toolbar', { name: 'Source actions' })
    .getByRole('button', { name: 'Disable' })
    .click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() => nodes(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform)))
    .toEqual(before);
  await expect(nodes(page).filter({ hasText: 'disabled' })).toHaveCount(1); // the Disable stays
});

test('A2#4 Esc from a node context menu returns focus to the node', async ({ page }) => {
  await add(page, 'Window');
  const node = nodes(page).first();
  await node.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Node menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(node).toBeFocused();
});

test('A2#4 Configure from the context menu: Esc returns focus to the node', async ({ page }) => {
  await add(page, 'Window');
  const node = nodes(page).first();
  await node.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Configure/ }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(node).toBeFocused();
});

test('A2#6 ⌘C with nothing selected leaves the browser copy alone', async ({ page }) => {
  const prevented = await page.evaluate(() => {
    const e = new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);
});

test('A2#7 a connection dropped on a node body does not open quick-add', async ({ page }) => {
  await add(page, 'Source');
  await add(page, 'Sink');
  const out = nodes(page).nth(0).locator('.react-flow__handle-right');
  const sinkBody = (await nodes(page).nth(1).boundingBox())!;
  const o = (await out.boundingBox())!;
  await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2);
  await page.mouse.down();
  await page.mouse.move(sinkBody.x + sinkBody.width - 20, sinkBody.y + 10, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Add a node' })).toHaveCount(0);
});

test('A2#10 disabled menu items say why', async ({ page }) => {
  await add(page, 'Filter');
  await nodes(page).first().click({ button: 'right' });
  // Run to here is live since M2 (NODE-05); the disabled Paste below still says why.
  await expect(page.getByRole('menuitem', { name: /^Run to here/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 40, y: 40 } });
  await expect(page.getByRole('menuitem', { name: /^Paste/ })).toContainText('Nothing copied');
});
