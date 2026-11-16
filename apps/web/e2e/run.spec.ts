import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The visible run label (the live region only announces state changes).
const status = (page: Page) => page.locator('.react-flow__panel.top [data-run-label]');
async function scenario(page: Page, title: string) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: new RegExp(`^Use this scenario.*${title}`) }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

test('SIM-16 run, pause, step, reset and speed (W09i/W09j)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await expect(status(page)).toHaveText('Ready');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(status(page)).toHaveText('Paused at event 1');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(status(page)).toHaveText('Paused at event 2');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(status(page)).toHaveText(/^Running · event [\d,]+ of [\d,]+$/);
  await expect(page.getByText(/^WM \d\d:\d\d:\d\d$/)).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(status(page)).toHaveText(/^Paused at event [\d,]+$/);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(status(page)).toHaveText('Ready');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('.react-flow__panel.top').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test('SIM-16 at 10× a 1,000-event run finishes and says so (W09k)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished · [\d,]+ events · [\d,]+ errors?$/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
});

test('SIM-ENGINE-CRASH shows its dialog; the pipeline is untouched (WX03)', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const before = await page.locator('.react-flow__node').count();
  await page.evaluate(async () => {
    const m = await import('/src/sim/run.ts');
    m.useRun.setState({ state: 'crashed', crash: { n: 812, reason: 'out of memory' } });
  });
  const d = page.getByRole('dialog');
  await expect(d).toContainText('The simulator stopped at event 812: out of memory');
  await expect(d).toContainText('Your pipeline is safe.');
  await d.getByRole('button', { name: 'Reload simulator' }).click();
  await expect(d).toHaveCount(0);
  await expect(status(page)).toHaveText('Ready');
  await expect(page.locator('.react-flow__node')).toHaveCount(before);
});

test('SIM-17 while running: edges animate, node counts tick at least 5×/s, the busiest node glows', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const val = page.locator('.react-flow__node').filter({ hasText: 'Rules' });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.react-flow__edge-path.sl-flow').first()).toBeAttached();
  await expect(val).toContainText(/in [\d,]+ · out [\d,]+/);
  // Sample the label for 1 s: at least 5 distinct values.
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    seen.add((await val.textContent()) ?? '');
    await page.waitForTimeout(50);
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);
  await expect(page.locator('.react-flow__node .sl-glow')).toHaveCount(1);
  // Edge counts show without hovering: not inside the hover-only tools (opacity 0 until hover).
  const label = page
    .locator('.react-flow__edgelabel-renderer')
    .getByText(/^[\d,]+$/)
    .first();
  await expect(label).toBeVisible();
  expect(await label.evaluate((e) => !!e.closest('.sl-edge-tools'))).toBe(false);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('.react-flow__edge-path.sl-flow')).toHaveCount(0);
});

test('SIM-18 runtime expression failures are counted on the node, in words', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  // The generator's bad rows have no amount: the Validate rule cannot evaluate them.
  await expect(
    page
      .locator('.react-flow__node')
      .filter({ hasText: 'Rules' })
      .getByText(/events failed in Rules/),
  ).toHaveCount(1);
});

test('SIM-21 run panel: Timeline while running, Output opens when finished, Problems, Trace and Flink SQL explained', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await scenario(page, 'Card fraud bursts');
  const panel = page.getByRole('region', { name: 'Run panel' });
  await expect(panel.getByRole('tab')).toHaveText(['Timeline', 'Output', 'Trace', 'Flink SQL', /^Problems/]);
  await page.getByText('10×', { exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('img', { name: 'Timeline chart' })).toBeVisible();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await expect(panel.getByRole('tab', { name: /^Output/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('table', { name: /^Output of / })).toBeVisible();
  await panel.getByRole('tab', { name: 'Timeline' }).click();
  await expect(panel).toContainText(/\d+ window fires · \d+ late events/);
  await panel.getByRole('tab', { name: 'Trace' }).click();
  await expect(panel).toContainText('Pick an output row to trace it'); // EXPL-03: Trace is built
  await page.screenshot({ path: `test-results/shots/${test.info().project.name}-W09k-finished.png` });
  expect(errors.filter((e) => /Maximum update depth|getSnapshot/.test(e))).toEqual([]);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).include('[aria-label="Run panel"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  );
});

test('SIM-16 Chaos injects late, duplicate and malformed events and stalls a source, during a run', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  const pill = page.locator('.react-flow__panel.top');
  await expect(pill.getByRole('button', { name: 'Chaos' })).toHaveAttribute('aria-disabled', 'true');
  await page.getByText('0.25×', { exact: true }).click();
  await pill.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Running/);
  // Chaos copies events already emitted: let some flow first.
  await expect
    .poll(async () =>
      Number((await status(page).textContent())!.match(/event ([\d,]+)/)![1]!.replace(/,/g, '')),
    )
    .toBeGreaterThan(30);
  const totalBefore = Number((await status(page).textContent())!.match(/of ([\d,]+)/)![1]!.replace(/,/g, ''));
  await pill.getByRole('button', { name: 'Chaos' }).click();
  await expect(
    page.getByText(
      'Chaos: 5 events a minute behind the watermark, 5 duplicates, 5 malformed rows; Payments stalls for 3 s.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(status(page)).toHaveText(new RegExp(`of ${(totalBefore + 15).toLocaleString('en-US')}$`));
});

test('ENG-03 the stage inspector shows events per subtask and each key’s key group and subtask', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await page.locator('.react-flow__node').filter({ hasText: 'Bursts per card' }).dblclick();
  const d = page.getByRole('dialog', { name: 'Window settings' });
  await d.getByRole('tab', { name: 'Output preview' }).click();
  const subs = d.getByRole('table', { name: 'Events per subtask' }).locator('tbody tr');
  await expect(subs).toHaveCount(2);
  const keys = d.getByRole('table', { name: 'Busiest keys and their subtask' }).locator('tbody tr');
  await expect(keys.first()).toContainText(/c_\d+/);
  // 2 subtasks over 128 key groups: groups 0–63 run on subtask 0, 64–127 on subtask 1.
  for (const row of await keys.all()) {
    const [, group, sub] = await row.locator('td').allTextContents();
    expect(Number(sub)).toBe(Number(group) >= 64 ? 1 : 0);
  }
});

test('WM01/WM02 a window flashes when it fires and a late event drops to the late port; off under reduced motion', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  const win = page.locator('.react-flow__node').filter({ hasText: 'Bursts per card' });
  await expect(win.locator('.sl-fire')).toHaveCount(1);
  await expect(win.locator('.sl-late-dot')).toHaveCount(1);
  expect(await win.locator('.sl-fire').evaluate((e) => getComputedStyle(e).animationName)).toBe('sl-fire');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Under reduced motion the dot is not left sitting on the port: it is simply not shown.
  expect(
    await win
      .locator('.sl-late-dot')
      .evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e).opacity]),
  ).toEqual(['none', '0']);
});

test('WM01 a disabled Window passes events through and never flashes as if it fired', async ({ page }) => {
  await scenario(page, 'Card fraud bursts');
  const win = page.locator('.react-flow__node').filter({ hasText: 'Bursts per card' });
  // The Filter after it reads the window's payments column, so it is disabled too (or the run is blocked).
  for (const label of ['Bursts per card', 'More than 3']) {
    await page.locator('.react-flow__node').filter({ hasText: label }).click();
    await page
      .getByRole('toolbar', { name: /actions$/ })
      .getByRole('button', { name: 'Disable' })
      .click();
  }
  await expect(page.locator('.react-flow__node').filter({ hasText: 'disabled' })).toHaveCount(2);
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 15000 });
  await expect(win.locator('.sl-fire')).toHaveCount(0);
});

test('WM01 output rows drop in as they arrive; rows already there stay still; off under reduced motion', async ({
  page,
}) => {
  // Matched refunds reach the sink as the run goes (no window), so output keeps growing.
  await scenario(page, 'Refunds matching');
  await page.getByText('1×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Running/);
  await page.getByRole('tab', { name: 'Output' }).click();
  const rows = page.getByRole('table', { name: /^Output of / }).locator('tbody tr');
  await expect.poll(() => rows.count(), { timeout: 15000 }).toBeGreaterThan(0);
  const anim = (i: number) =>
    rows.nth(i).evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e).animationDuration]);
  // Switching tabs remounts the table with rows in it: those rows do not replay the drop.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByRole('tab', { name: 'Output' }).click();
  expect((await anim(0))[0]).toBe('none');
  const n = await rows.count();
  // A row that arrives while the tab is open drops in.
  await expect.poll(() => rows.count(), { timeout: 15000 }).toBeGreaterThan(n);
  expect(await anim(n)).toEqual(['sl-row-in', '0.24s']);
  // Reduced motion: no drop at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await anim(n))[0]).toBe('none');
});

test('WM06 only edges carrying events flow, at a pace set by the speed', async ({ page }) => {
  await scenario(page, 'Refunds matching');
  // A disabled Source emits nothing, so its edge never carries an event (no timing involved).
  await page.locator('.react-flow__node').filter({ hasText: 'Refunds' }).first().click();
  await page
    .getByRole('toolbar', { name: /actions$/ })
    .getByRole('button', { name: 'Disable' })
    .click();
  await page.getByText('0.25×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Running/);
  const path = (id: string) => page.getByTestId(`rf__edge-${id}`).locator('path.react-flow__edge-path');
  const carrying = path('e_pay_main_join_left');
  await expect(carrying).toHaveClass(/sl-flow/);
  expect(await carrying.evaluate((p) => getComputedStyle(p).animationDuration)).toBe('3.2s'); // 0.8 s / 0.25
  await expect(path('e_ref_main_join_right')).not.toHaveClass(/sl-flow/);
});

test('WM06 side outputs stay still; edge counts tick at full opacity (MOTION.md, AA contrast)', async ({
  page,
}) => {
  await scenario(page, 'Card fraud bursts');
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Running/);
  const path = (id: string) => page.getByTestId(`rf__edge-${id}`).locator('path.react-flow__edge-path');
  await expect(path('e_gen_main_val_main')).toHaveClass(/sl-flow/);
  // Once a side output has carried events (a non-zero rejected/late count shows), none of them flows.
  await expect(
    page
      .locator('.react-flow__edgelabel-renderer')
      .getByText(/^[1-9][\d,]* (rejected|late)$/)
      .first(),
  ).toBeVisible({ timeout: 15000 });
  const side = page
    .locator('[data-testid*="_rejected_"], [data-testid*="_late_"]')
    .locator('path.react-flow__edge-path');
  expect(await side.count()).toBe(3);
  expect(await side.evaluateAll((ps) => ps.filter((x) => x.classList.contains('sl-flow')).length)).toBe(0);
  // Sample the count labels for a second while counts change: never dimmed.
  const label = page.locator('.react-flow__edgelabel-renderer').getByText(/^[\d,]+( \w+)?$/);
  const seen: string[] = [];
  for (let i = 0; i < 25; i++) {
    seen.push(...(await label.evaluateAll((ls) => ls.map((l) => getComputedStyle(l).opacity))));
    await page.waitForTimeout(40);
  }
  expect(seen.length).toBeGreaterThan(0);
  expect(new Set(seen)).toEqual(new Set(['1']));
});

test('WM01 a run that starts over shows its rows dropping in again (no stale count from the last run)', async ({
  page,
}) => {
  await scenario(page, 'Refunds matching');
  await page.getByText('10×', { exact: true }).click();
  await page.locator('.react-flow__panel.top').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText(/^Finished/, { timeout: 20000 });
  const panel = page.getByRole('region', { name: 'Run panel' });
  await panel.getByRole('tab', { name: 'Output' }).click();
  const rows = panel.getByRole('table', { name: /^Output of / }).locator('tbody tr');
  await expect.poll(() => rows.count()).toBeGreaterThan(3);
  // Remount with the rows there (they count as old), then the same table sees a run start over: no rows,
  // then a few new ones (what Step → Resume after a stale edit does, without its timing).
  await panel.getByRole('tab', { name: 'Timeline' }).click();
  await panel.getByRole('tab', { name: 'Output' }).click();
  await page.evaluate(async () => {
    const r = await import('/src/sim/run.ts');
    const st = r.useRun.getState().stats!;
    const id = Object.keys(st.outputs).find((k) => (st.outputs[k] ?? []).length > 3)!;
    const keep = st.outputs[id]!.slice(0, 3);
    r.useRun.setState({ stats: { ...st, outputs: { ...st.outputs, [id]: [] } } });
    await new Promise((f) => setTimeout(f, 100));
    r.useRun.setState({ stats: { ...st, outputs: { ...st.outputs, [id]: keep } } });
  });
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((rs) => rs.map((x) => x.classList.contains('sl-row-arrive')))).toEqual([
    true,
    true,
    true,
  ]);
});
