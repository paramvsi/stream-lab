import { expect, test, type Page } from '@playwright/test';

// Guards for the drawer audit (e39c898 + 09d0650), one per confirmed finding.
const nodes = (page: Page) => page.locator('.react-flow__node');
async function scenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(nodes(page).first()).toBeVisible();
}
const open = async (page: Page, text: string) => {
  await nodes(page).filter({ hasText: text }).dblclick();
  return page.getByRole('dialog', { name: /settings$/ });
};
// The app's own store module (Vite dev URL).
const store = (page: Page, src: string) =>
  page.evaluate(async (s) => {
    const m = await import('/src/sim/store.ts');
    return new Function('m', s)(m);
  }, src);
const cfg = (page: Page, id: string, key: string) =>
  store(page, `return m.useGraph.getState().nodes.find(n=>n.id==='${id}').config.${key}`);

test('audit 1: Esc while typing records the edit and history keeps tracking', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  await d.getByLabel('Expression').fill('payments > 5');
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  expect(await store(page, 'return m.useGraph.temporal.getState().isTracking')).toBe(true);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  expect(await cfg(page, 'flt', 'expr')).toBe('payments > 3');
});

test('audit 2: a Map assignment can name a new output field', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await store(
    page,
    "const id = m.useGraph.getState().addNode('Map', {x:300,y:500}, {nodeId:'gen', handleId:'main'}); m.useGraph.getState().updateConfig(id, {assignments:[{field:'amount_usd', expr:'amount * 1.1', type:'number'}], drop:[]});",
  );
  const d = await open(page, 'amount_usd');
  const ctl = d.getByRole('group', { name: 'Fields to set' }).getByLabel('Field', { exact: true });
  expect(await ctl.evaluate((e) => e.tagName)).toBe('INPUT');
  await expect(ctl).toHaveValue('amount_usd');
});

test('audit 3: duration keeps its unit while typing; one id per control', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Bursts per card');
  const size = d.getByLabel('Size', { exact: true });
  const unit = d.getByLabel('Size unit');
  await size.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('10');
  await size.blur();
  await expect(unit).toHaveValue('min');
  expect(await cfg(page, 'win', 'sizeMs')).toBe(600000);
  await size.fill('60');
  await expect(unit).toHaveValue('min');
  await size.fill('0');
  await unit.selectOption('s');
  await expect(unit).toHaveValue('s');
  const dup = await unit.evaluate((e) => document.querySelectorAll(`[id="${e.id}"]`).length);
  expect(dup).toBe(1);
});

test('audit 4: closing after undoing a rename keeps the undo', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Bursts per card');
  const name = d.getByLabel('Name', { exact: true });
  await name.fill('Renamed');
  await name.blur();
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(name).toHaveValue('Bursts per card');
  await d.getByRole('button', { name: 'Close settings' }).click();
  expect(await store(page, "return m.useGraph.getState().nodes.find(n=>n.id==='win').label")).toBe(
    'Bursts per card',
  );
  expect(await store(page, 'return m.useGraph.temporal.getState().futureStates.length')).toBe(1);
});

test('audit 5: removing a Route rule removes its edge in the same step', async ({ page }) => {
  await scenario(page, 'Card velocity');
  const d = await open(page, 'Velocity');
  const before = await store(page, "return m.useGraph.getState().edges.filter(e=>e.source==='route').length");
  await d.getByRole('button', { name: 'Remove routes 1' }).click();
  expect(
    await store(
      page,
      "return m.useGraph.getState().edges.some(e=>e.source==='route' && e.sourceHandle==='route-high')",
    ),
  ).toBe(false);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  expect(await store(page, "return m.useGraph.getState().edges.filter(e=>e.source==='route').length")).toBe(
    before,
  );
});

test('audit 6: Cmd+Z works with focus on a drawer radio', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Bursts per card');
  await d.getByText('Sliding', { exact: true }).click();
  expect(await cfg(page, 'win', 'kind')).toBe('hop');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => cfg(page, 'win', 'kind')).toBe('tumble');
});

test('audit 7+9: unbounded-join warning sits under its own bound; re-enabling restores the old value', async ({
  page,
}) => {
  await scenario(page, 'Refunds matching');
  const d = await open(page, 'Refund to payment');
  await d.getByLabel('No upper bound').check();
  await expect(d.locator('label:has-text("No upper bound")').locator('..')).toContainText('Unbounded join');
  await expect(d.locator('label:has-text("No lower bound")').locator('..')).not.toContainText(
    'Unbounded join',
  );
  await d.getByLabel('No upper bound').uncheck();
  expect(await cfg(page, 'join', 'upperMs')).toBe(30 * 86400000);
});
