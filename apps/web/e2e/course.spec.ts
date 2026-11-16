import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const rows = (page: Page) => page.getByRole('list', { name: 'Chapters' }).getByRole('listitem');
const axe = async (page: Page) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
};

test('LEARN-01 a new learner: 0 of 10, chapter 1 offered with Start, 7–10 coming in v1 (W04)', async ({
  page,
}) => {
  await page.goto('/#/learn');
  await expect(page.getByRole('heading', { level: 1, name: 'Apache Flink®, hands on' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your progress' })).toContainText('0 of 10');
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).nth(0).getByRole('link', { name: 'Start chapter 1' })).toBeVisible();
  await expect(rows(page).nth(1)).toContainText('14 min');
  for (const i of [6, 7, 8, 9]) await expect(rows(page).nth(i)).toContainText('Coming in v1');
  await expect(rows(page).nth(6).getByRole('link')).toHaveCount(0);
  await axe(page);
});

test('LEARN-01 progress is kept in this browser: done chapters say Completed, the started one Continue (W04b)', async ({
  page,
}) => {
  await page.goto('/#/learn');
  await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    await s.setChapterStatus('event-time', 'done');
    await s.setChapterStatus('watermarks', 'done');
    await s.setChapterStatus('windows', 'started');
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your progress' })).toContainText('2 of 10');
  await expect(rows(page).nth(0)).toContainText('Completed');
  await expect(rows(page).nth(1)).toContainText('Completed');
  await expect(rows(page).nth(2).getByRole('link', { name: 'Continue chapter 3' })).toBeVisible();
  await rows(page).nth(2).getByRole('link', { name: 'Continue chapter 3' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Windows' })).toBeVisible();
  await axe(page);
});

test('LAND-05 an unknown route shows the 404 with links to the course and the simulator (W03)', async ({
  page,
}) => {
  await page.goto('/#/no/such/page');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This page was dropped as late data.' }),
  ).toBeVisible();
  await expect(page.getByText('404 · event arrived after the watermark')).toBeVisible();
  await axe(page);
  await page.getByRole('link', { name: 'Go to the course' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Apache Flink®, hands on' })).toBeVisible();
  await page.goto('/#/learn/state'); // a v1 chapter is not open yet
  await expect(
    page.getByRole('heading', { level: 1, name: 'This page was dropped as late data.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open the simulator' }).click();
  await expect(page).toHaveURL(/#\/new$/);
});
