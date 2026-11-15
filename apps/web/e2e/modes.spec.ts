import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBlank } from './helpers';

const axe = async (page: Page, include?: string) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const b = new AxeBuilder({ page });
  const r = await (include ? b.include(include) : b).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

test('W09p ⌘K command palette: search, Enter runs the command', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('ControlOrMeta+k');
  const box = page.getByRole('combobox', { name: 'Search commands' });
  await expect(box).toBeFocused();
  expect(await axe(page, '[role="dialog"]')).toEqual([]);
  await box.fill('add window');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toContainText('Window');
});

test('SIM-22 "?" opens the keyboard shortcuts sheet', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toContainText('Command palette');
  expect(await axe(page, '[role="dialog"]')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('SIM-23 under 900 px the builder is replaced by SIM-SMALL-SCREEN', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openBlankNarrow(page);
  await expect(page.getByText('The builder needs a wider screen')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Node library' })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

async function openBlankNarrow(page: Page) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: 'Start blank' }).click();
}

test('SIM-23 past 150 nodes: performance mode notice (SIM-LARGE-GRAPH)', async ({ page }) => {
  const nodes = Array.from({ length: 151 }, (_, i) => ({
    id: `n${i}`,
    type: 'Filter',
    position: { x: (i % 15) * 220, y: Math.floor(i / 15) * 90 },
    config: { expr: 'amount > 0' },
  }));
  const big = {
    schemaVersion: 1,
    id: 'p_big',
    name: 'Big',
    updatedAt: '2026-11-15T00:00:00Z',
    seed: 42,
    nodes,
    edges: [],
    data: { refTables: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  await page.goto('/#/pipelines');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(big)),
  });
  await page.getByRole('link', { name: 'Big' }).click();
  await expect(
    page.getByText('Edge animation and live counts are reduced to keep it smooth.').first(),
  ).toBeVisible();
});
