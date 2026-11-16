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

// ---- Audit 2 (47440ae, 42a9c5e, 16f72ea) ----
const past = (page: Page) => store(page, 'return m.useGraph.temporal.getState().pastStates.length');
const future = (page: Page) => store(page, 'return m.useGraph.temporal.getState().futureStates.length');

test('audit2 1: undo of a CEL edit keeps redo (outside syncs are not edits)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  const expr = d.getByLabel('Expression');
  await expr.fill('payments > 5');
  await expr.blur();
  // CodeMirror reports blur asynchronously: wait for the step to land.
  await expect.poll(() => past(page)).toBe(1);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(expr).toHaveText('payments > 3');
  expect([await past(page), await future(page)]).toEqual([0, 1]);
});

test('audit2 2: removing a Validate rule is one undo step', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await store(
    page,
    "m.useGraph.getState().updateConfig('val', {rules:[{name:'a',expr:'amount > 1.0',severity:'error'},{name:'b',expr:'amount > 2.0',severity:'error'},{name:'c',expr:'amount > 3.0',severity:'error'}]});",
  );
  const d = await open(page, 'Rules');
  const p0 = await past(page);
  await d.getByRole('button', { name: 'Remove rules 1' }).click();
  expect(await past(page)).toBe(p0 + 1);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  expect(
    await store(page, "return m.useGraph.getState().nodes.find(n=>n.id==='val').config.rules.map(r=>r.name)"),
  ).toEqual(['a', 'b', 'c']);
});

test('audit2 3: the CEL quick fix is one undo step', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  const expr = d.getByLabel('Expression');
  await expr.fill('paymnts > 3');
  await expr.blur();
  await d.getByRole('button', { name: 'Use “payments”' }).click();
  await expect(expr).toHaveText('payments > 3');
  await expr.blur();
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(expr).toHaveText('paymnts > 3');
});

test('audit2 4: Esc closes the autocomplete list, not the drawer', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  await d.getByLabel('Expression').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' && card');
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  await expect(d).toBeVisible();
});

test('audit2 5: the CEL label targets the editor, and its error is linked', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  await d.getByLabel('Expression').fill('paymnts > 3');
  await expect(d.locator('.cm-content')).toHaveAttribute('aria-invalid', 'true'); // after validation lands
  const wiring = await d.locator('label', { hasText: /^Expression$/ }).evaluate((l) => {
    const t = document.getElementById((l as HTMLLabelElement).htmlFor);
    const desc = t?.getAttribute('aria-describedby');
    return {
      editor: t?.classList.contains('cm-content') ?? false,
      invalid: t?.getAttribute('aria-invalid'),
      error: desc ? document.getElementById(desc)?.textContent : null,
    };
  });
  expect(wiring.editor).toBe(true);
  expect(wiring.invalid).toBe('true');
  expect(wiring.error).toContain('Unknown field "paymnts"');
});

test('audit2 6: a multi-line expression can still be edited; Enter adds no line', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await store(page, "m.useGraph.getState().updateConfig('flt', {expr:'payments > 3 &&\\npayments < 10'});");
  const d = await open(page, 'More than 3');
  await d.getByLabel('Expression').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await d.getByLabel('Expression').blur();
  expect(await cfg(page, 'flt', 'expr')).toBe('payments > 3 &&\npayments < 1');
});

// ---- Audit 3 (01e5c27, 4debbce) ----
test('audit3 1+7: Settings shows a live preview under the form; expression errors are a count, not a banner', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  const live = d.getByRole('region', { name: 'Live preview' });
  await expect(live).toContainText(/\d+ of \d+ sample events pass/);
  await d.getByLabel('Expression').fill('payments >');
  await d.getByRole('tab', { name: 'Output preview' }).click();
  await expect(d.getByText(/^Failed/)).toBeVisible();
  await expect(d.getByText('They were sent to Dead-letter')).toHaveCount(0);
});

test('audit3 3: a connected node with no events this sample does not say "connect it"', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'Fraud alerts');
  await d.getByRole('tab', { name: 'Output preview' }).click();
  await expect(d.getByText(/Connect (it|this node) to a source/)).toHaveCount(0);
  await expect(
    d
      .getByRole('table', { name: 'Events before the node' })
      .or(d.getByText('No events from upstream in this sample.')),
  ).toBeVisible();
});

test('audit3 8: after Run to here, the next edit goes back to the 5-event live preview', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const d = await open(page, 'More than 3');
  await d.getByRole('button', { name: 'Run to here' }).click();
  await expect(d).toContainText('Sample of 50 events per source');
  await d.getByRole('tab', { name: 'Settings' }).click();
  await d.getByLabel('Expression').fill('payments >= 1.0');
  await d.getByLabel('Expression').blur();
  await d.getByRole('tab', { name: 'Output preview' }).click();
  await expect(d).toContainText('Sample of 5 events per source');
});

test('EXPL-06: the stage inspector shows the node in the run (in, out, failed, late) and its state per key', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const step = page.locator('.react-flow__panel.top').getByRole('button', { name: 'Step', exact: true });
  for (let i = 0; i < 40; i++) await step.click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Paused/);
  const d = await open(page, 'Bursts per card');
  await d.getByRole('tab', { name: 'Output preview' }).click();
  const sec = d.getByRole('region', { name: 'This node in the run' });
  await expect(sec).toContainText(/In \d+/);
  await expect(sec).toContainText(/Late \d+/);
  await expect(sec.getByRole('table', { name: 'State per key in the run' })).toBeVisible();
  await expect(
    sec.getByRole('table', { name: 'State per key in the run' }).locator('tbody tr').first(),
  ).toContainText('c_');
});

test('EXPL-06 audit 2+5: a Sink is not said to drop what it wrote; a Route shows its branch names', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__panel.top [data-run-label]')).toHaveText(/^Finished/, {
    timeout: 20000,
  });
  const d = await open(page, 'Fraud alerts');
  await d.getByRole('tab', { name: 'Output preview' }).click();
  const sec = d.getByRole('region', { name: 'This node in the run' });
  await expect(sec).toContainText(/In \d+/);
  await expect(sec).not.toContainText('Dropped');
  await expect(sec).not.toContainText('main');
});
