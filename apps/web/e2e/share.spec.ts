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
  await expect(d.getByRole('switch', { name: /Include uploaded data/ })).toBeDisabled(); // nothing uploaded
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
  await d.getByRole('switch', { name: /Include uploaded data/ }).check();
  // WX05: the message is the Link field's error; Export JSON and Copy anyway take the footer.
  await expect(d.getByLabel('Link')).toHaveAttribute('aria-invalid', 'true');
  await expect(d).toContainText(
    /This link is [\d,]+ characters; some apps cut long links\. Leave out uploaded data/,
  );
  await expect(d.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  await d.getByRole('button', { name: 'Copy anyway' }).click();
  await expect(page.getByText('Link copied').first()).toBeVisible();
  const dl = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Export JSON' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.json$/);
  // "Leave out data" is the switch.
  await d.getByRole('switch', { name: /Include uploaded data/ }).uncheck();
  await expect(d).not.toContainText('some apps cut long links');
});

test('EXP-04 opening a link shows the pipeline unsaved (W18); Make a copy saves it with its uploaded rows', async ({
  page,
}) => {
  await openBlank(page);
  const link = await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    const s = await import('/src/share.ts');
    const g = m.useGraph.getState();
    const src = g.addNode('Source', { x: 0, y: 0 });
    g.setName('Shared fraud check');
    m.useGraph.getState().setUpload(src, { file: 'pay.csv', rows: 2 });
    const d = (await import('/src/sim/ShareDialog.tsx')).currentPipeline();
    return { data: await s.encodeShare(d, { [src]: [{ a: 1 }, { a: 2 }] }), src };
  });
  await page.goto(`/#/s/${link.data}`);
  await expect(
    page.getByText('You are viewing a shared pipeline. Changes are not saved until you make a copy.'),
  ).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  // Not saved: My pipelines has only the original (the pipeline the link was made from).
  const named = () =>
    page.evaluate(
      async () =>
        (await (await import('/src/storage.ts')).listPipelines()).filter(
          (p) => p.name === 'Shared fraud check',
        ).length,
    );
  expect(await named()).toBe(1);
  await page.getByRole('button', { name: 'Make a copy' }).click();
  await expect(page).toHaveURL(/#\/sim\/p_/);
  await expect(page.getByText('You are viewing a shared pipeline.')).toHaveCount(0);
  const saved = await page.evaluate(async (src) => {
    const st = await import('/src/storage.ts');
    const u = await import('/src/sim/uploads.ts');
    const id = location.hash.split('/sim/')[1]!;
    return {
      names: (await st.listPipelines()).map((p) => p.name),
      rows: (await u.loadRows(id, src))?.length,
    };
  }, link.src);
  expect(saved.names.filter((n) => n === 'Shared fraud check')).toHaveLength(2);
  expect(saved.rows).toBe(2);
});

test('SHARE-BROKEN a damaged link shows the full-page state; Open a new pipeline goes to the gallery', async ({
  page,
}) => {
  await page.goto('/#/s/1.not-a-real-link');
  await expect(page.getByRole('heading', { name: 'This link is damaged or incomplete' })).toBeVisible();
  await page.getByRole('button', { name: 'Open a new pipeline' }).click();
  await expect(page).toHaveURL(/#\/new/);
});

test('EXP-04 audit: an unticked link carries nothing about uploads; the switch is off each time; a read error is DATA-READ-FAILED', async ({
  page,
}) => {
  await openBlank(page);
  const src = await page.evaluate(async () => {
    const m = await import('/src/sim/store.ts');
    const u = await import('/src/sim/uploads.ts');
    const g = m.useGraph.getState();
    const id = g.addNode('Source', { x: 0, y: 0 });
    await u.saveRows(g.pipelineId, id, [{ a: 1 }]);
    m.useGraph.getState().setUpload(id, { file: 'customers_PII_march.csv', rows: 1 });
    return id;
  });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Share pipeline' });
  await d.evaluate((e) => Promise.all(e.getAnimations().map((x) => x.finished)));
  expect((await d.boundingBox())!.width).toBe(560);
  await expect(d.getByLabel('Link')).toHaveValue(/#\/s\/1\./);
  const link = await d.getByLabel('Link').inputValue();
  const decoded = await page.evaluate(
    async (l) => await (await import('/src/share.ts')).decodeShare(l.slice(l.indexOf('#/s/') + 4)),
    link,
  );
  expect(JSON.stringify(decoded)).not.toContain('customers_PII_march');
  await d.getByRole('switch', { name: /Include uploaded data/ }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(d.getByRole('switch', { name: /Include uploaded data/ })).not.toBeChecked();
  // A stored file that can not be read: said in catalog words, not a link that never comes.
  await page.evaluate(() => {
    File.prototype.stream = function () {
      throw new DOMException('gone', 'NotReadableError');
    };
  });
  await d.getByRole('switch', { name: /Include uploaded data/ }).check();
  await expect(d).toContainText('customers_PII_march.csv could not be read: the browser could not read it.');
  void src;
});
