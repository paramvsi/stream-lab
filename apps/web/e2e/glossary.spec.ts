import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const axe = async (page: Page) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
};
const cards = (page: Page) => page.getByRole('list', { name: 'Concepts' }).getByRole('listitem');

test('LEARN-04 the glossary: every term A–Z, letters that have terms; search by name and alias; no results (W06, W06b, W06c)', async ({
  page,
}) => {
  await page.goto('/#/glossary');
  await expect(page.getByRole('heading', { level: 1, name: 'Flink concepts, in plain words' })).toBeVisible();
  await expect(cards(page).first()).toContainText('Allowed lateness');
  await expect(page.getByRole('navigation', { name: 'Letters' }).getByRole('link')).toHaveText([
    'A',
    'B',
    'C',
    'E',
    'I',
    'K',
    'P',
    'S',
    'W',
  ]);
  await axe(page);
  const search = page.getByLabel('Search the glossary');
  await search.fill('PROCTIME'); // an alias
  await expect(page.getByRole('status').filter({ hasText: /results?$/ })).toHaveText('1 result');
  await expect(cards(page)).toHaveText([/^Processing time/]);
  await search.fill('kafka connect');
  await expect(page.getByRole('heading', { name: 'No concept matches "kafka connect"' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the Flink docs' })).toHaveAttribute(
    'href',
    /nightlies\.apache\.org\/flink/,
  );
  await axe(page);
  await search.fill('sink');
  await expect(cards(page)).toHaveText([/^Sink/]);
});

test('LEARN-04 a concept opens in a drawer over the chapter, without leaving it; related terms; Esc returns focus (W06d)', async ({
  page,
}) => {
  await page.goto('/#/learn/watermarks');
  const url = page.url();
  const link = page.getByRole('button', { name: 'watermark', exact: true });
  await link.click();
  const d = page.getByRole('dialog', { name: 'Concept' });
  await expect(d.getByRole('heading', { name: 'Watermark' })).toBeVisible();
  await expect(d).toContainText("WATERMARK FOR ts AS ts - INTERVAL '5' SECOND");
  await expect(d.getByRole('link', { name: 'Flink docs' })).toHaveAttribute(
    'href',
    /flink-docs-stable\/docs\/concepts\/time\//,
  );
  expect(page.url()).toBe(url);
  await axe(page);
  await d.getByRole('button', { name: 'Idle source' }).click();
  await expect(d.getByRole('heading', { name: 'Idle source' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(link).toBeFocused();
  expect(page.url()).toBe(url);
});
