import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/shots/${test.info().project.name}-${name}.png` });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto('/');
});

const errorsOf = (page: Page) => (page as Page & { errors: string[] }).errors;

test('W09 empty canvas: palette, empty state, run blocked by SIM-NO-SOURCE', async ({ page }) => {
  await expect(page.getByRole('complementary', { name: 'Node library' })).toBeVisible();
  await expect(page.getByText('Start with a source')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Run' })).toHaveAccessibleDescription(/Fix 1 error/);
  await shot(page, 'W09-empty');
  expect(errorsOf(page)).toEqual([]);
});

test('SIM-03 palette search and "No nodes match"', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search nodes' });
  await search.fill('dedup');
  await expect(page.getByRole('button', { name: /^Deduplicate/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Source/ })).toHaveCount(0);
  await search.fill('kafka-ish');
  await expect(page.getByText('No nodes match')).toBeVisible();
});

test('SIM-03 Enter adds at the centre; SIM-12 undo/redo buttons', async ({ page }) => {
  await page.getByRole('button', { name: /^Source/ }).press('Enter');
  await page.getByRole('button', { name: /^Sink/ }).press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: /^Redo/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await shot(page, 'two-nodes');
});

test('adding the first node keeps the canvas at 100 % zoom', async ({ page }) => {
  await page.getByRole('button', { name: /^Source/ }).press('Enter');
  const box = (await page.locator('.react-flow__node').boundingBox())!;
  expect(Math.round(box.width)).toBe(184);
});

test('SIM-04 quick-add with / is keyboard-first', async ({ page }) => {
  // Click a corner: the empty-state card sits in the middle.
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('/');
  const box = page.getByRole('combobox', { name: 'Search nodes to add' });
  await expect(box).toBeFocused();
  await box.fill('window');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toContainText('Window');
});

test('drag from palette, connect Source → Sink, delete with Undo toast', async ({ page }) => {
  const pane = page.locator('.react-flow__pane');
  const box = (await pane.boundingBox())!;
  await page.getByRole('button', { name: /^Source/ }).dragTo(pane, { targetPosition: { x: 200, y: 200 } });
  await page.getByRole('button', { name: /^Sink/ }).dragTo(pane, { targetPosition: { x: 600, y: 200 } });
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const out = page.locator('.react-flow__node').nth(0).locator('.react-flow__handle-right');
  const inn = page.locator('.react-flow__node').nth(1).locator('.react-flow__handle-left');
  await out.dragTo(inn);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  // Graph is valid now: the Run reason is no longer a validation error.
  await expect(page.getByRole('button', { name: 'Run' })).not.toHaveAccessibleDescription(/Fix/);
  await shot(page, 'connected');

  await page.locator('.react-flow__node').nth(1).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByText('Deleted 1 node(s).').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  expect(box.width).toBeGreaterThan(600);
});

// Entrance motion (sl-in) fades text in; measure contrast on the settled page.
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

test('axe: 0 violations on the workspace (empty and with nodes)', async ({ page }) => {
  await settled(page);
  let r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
  await page.getByRole('button', { name: /^Source/ }).press('Enter');
  await settled(page);
  r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
});
