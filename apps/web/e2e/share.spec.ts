import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openBlank } from './helpers';

test('EXP-04 Share copies a link that carries the whole pipeline (W18b); axe clean; focus back on Share', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openBlank(page);
  await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    m.useGraph.getState().addNode('Generator', { x: 0, y: 0 });
    m.useGraph.getState().setName('Card fraud check');
  });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Share pipeline' });
  await expect(d).toContainText('The whole pipeline travels in the link, after the #. Nothing is uploaded.');
  await expect(d.getByLabel('Link')).toHaveValue(/#\/s\/1\./);
  await expect(d.getByRole('checkbox', { name: /Include uploaded data/ })).toBeDisabled(); // nothing uploaded
  await d.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied').first()).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const decoded = await page.evaluate(async (l) => {
    const s = await import('/src/share.ts');
    return (await s.decodeShare(l.slice(l.indexOf('#/s/') + 4))).pipeline;
  }, link);
  expect(decoded.name).toBe('Card fraud check');
  expect(decoded.nodes.map((n: { type: string }) => n.type)).toEqual(['Generator']);
  // Measure the dialog at rest: during its entrance (sl-pop) it is partly transparent.
  await d.evaluate((e) => Promise.all(e.getAnimations().map((x) => x.finished)));
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Link copied')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeFocused();
});

test('SHARE-TOO-LONG over 8,000 characters (WX05): Leave out data, Export JSON, Copy anyway', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openBlank(page);
  await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    const u = await import('/src/sim/uploads.ts');
    const g = m.useGraph.getState();
    const src = g.addNode('Source', { x: 0, y: 0 });
    // Random text compresses badly: enough rows make a long link.
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      note: Math.random().toString(36).repeat(3),
    }));
    await u.saveRows(g.pipelineId, src, rows);
    m.useGraph.getState().setUpload(src, { file: 'notes.csv', rows: rows.length });
  });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Share pipeline' });
  await expect(d.getByLabel('Link')).toHaveValue(/#\/s\/1\./);
  await expect(d).not.toContainText('some apps cut long links');
  await d.getByRole('checkbox', { name: /Include uploaded data/ }).check();
  await expect(d).toContainText(/This link is [\d,]+ characters; some apps cut long links\./);
  await expect(d.getByRole('button', { name: 'Copy link' })).toHaveCount(0); // WX05: Copy anyway instead
  await d.getByRole('button', { name: 'Copy anyway' }).click();
  await expect(page.getByText('Link copied').first()).toBeVisible();
  const dl = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Export JSON' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.json$/);
  await d.getByRole('button', { name: 'Leave out data' }).click();
  await expect(d.getByRole('checkbox', { name: /Include uploaded data/ })).not.toBeChecked();
  await expect(d).not.toContainText('some apps cut long links');
});
