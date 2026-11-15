import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBlank } from './helpers';

const nodes = (page: Page) => page.locator('.react-flow__node');
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/shots/${test.info().project.name}-${name}.png` });

async function scenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(nodes(page).first()).toBeVisible();
}
const open = async (page: Page, text: string) => {
  await nodes(page).filter({ hasText: text }).dblclick();
  return page.getByRole('dialog', { name: /settings$/ });
};

test('NODE-01 the drawer opens with Settings, Input schema, Output preview, Docs', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Bursts per card');
  await expect(d.getByRole('tab')).toHaveText(['Settings', 'Input schema', 'Output preview', 'Docs']);
  await expect(d.getByRole('tab', { name: 'Settings' })).toBeFocused();
  await shot(page, 'W10-Window');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
});

test('NODE-02 the Window form is generated: type, size with units, key by, aggregates', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Bursts per card');
  await expect(d.getByRole('radiogroup', { name: 'Window type' })).toBeVisible();
  await expect(d.getByRole('radio', { name: 'Tumbling' })).toBeChecked();
  await expect(d.getByLabel('Size', { exact: true })).toHaveValue('5');
  await expect(d.getByLabel('Size unit')).toHaveValue('min');
  await expect(d.getByRole('checkbox', { name: 'card_id' })).toBeChecked();
  await expect(d.getByRole('group', { name: 'Aggregates' })).toBeVisible();
  await d.getByText('Sliding', { exact: true }).click(); // the visible label of the radio
  await expect(nodes(page).filter({ hasText: 'Bursts per card' })).toContainText('5 min sliding');
});

test('NODE-02 errors are inline and the node badge updates live while typing (CEL-UNKNOWN-FIELD)', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  const expr = d.getByLabel('Expression');
  await expr.fill('paymnts > 3');
  await expect(d.getByText('Unknown field "paymnts"')).toBeVisible();
  // Not blurred yet: the node already shows the error.
  await expect(
    nodes(page).filter({ hasText: 'More than 3' }).locator('[aria-hidden="true"]', { hasText: '!' }),
  ).toBeVisible();
});

test('NODE-07 a typed edit is one undo step, recorded on blur; undo restores the old value', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  const expr = d.getByLabel('Expression');
  await expr.fill('payments > 5');
  await expr.blur();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Undo history' }).locator('[aria-current="step"]'),
  ).toHaveText('Changed More than 3 settings');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(expr).toHaveText('payments > 3');
});

test('NODE-07 the drawer resizes, collapses to a bar, and Esc returns focus to the node', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Bursts per card');
  const h0 = (await d.boundingBox())!.height;
  await d.getByRole('separator', { name: 'Resize settings' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await d.boundingBox())!.height).toBeGreaterThan(h0);
  await d.getByRole('button', { name: 'Collapse settings' }).click();
  await expect.poll(async () => Math.round((await d.boundingBox())!.height)).toBeLessThanOrEqual(43);
  await d.getByRole('button', { name: 'Expand settings' }).click();
  await d.getByRole('tab', { name: 'Docs' }).click();
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(nodes(page).filter({ hasText: 'Bursts per card' })).toBeFocused();
});

test('NODE-06 every Phase 1 node opens a form without errors in the page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openBlank(page);
  for (const t of [
    'Source',
    'Generator',
    'Filter',
    'Map',
    'Union',
    'Lookup',
    'Join',
    'Window',
    'Top-N',
    'Validate',
    'Deduplicate',
    'Dead-letter',
    'Route',
    'Sink',
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${t} `) }).press('Enter');
    const n = nodes(page).last();
    await n.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: `${t} settings` })).toBeVisible();
    await page.keyboard.press('Escape');
    // Esc returns focus to the node on the next frame; let it land before the next step.
    await expect(n).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('NODE-03 CEL editor: squiggle on the bad part, field autocomplete, quick fix (WX01)', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  const expr = d.getByLabel('Expression');
  await expr.fill('paymnts > 3');
  await expect(d.locator('.cm-lintRange-error')).toHaveText('paymnts');
  await expect(d.getByText('Unknown field "paymnts"')).toBeVisible();
  await d.getByRole('button', { name: 'Use “payments”' }).click();
  await expect(expr).toHaveText('payments > 3');
  await expect(d.locator('.cm-lintRange-error')).toHaveCount(0);
  // Autocomplete from the input schema.
  await expr.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' && card');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('card_id');
  // Click the option: CodeMirror ignores Enter for a moment after the list opens (interactionDelay).
  await page.locator('.cm-tooltip-autocomplete li', { hasText: 'card_id' }).click();
  await expect(expr).toContainText('&& card_id');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
});
