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

test('LEARN-02/03 a chapter: sections and a challenge; a wrong pick says COURSE-WRONG with a hint; passing completes it (W05c–f)', async ({
  page,
}) => {
  await page.goto('/#/learn/event-time');
  await expect(page.getByRole('heading', { level: 1, name: 'Event time vs processing time' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Sections' }).getByRole('tab')).toHaveText([
    'Two clocks',
    'Why it matters',
    'In Flink SQL',
    'Challenge',
  ]);
  await axe(page);
  await page.getByRole('tab', { name: 'Challenge' }).click();
  await expect(page.getByText('CHAPTER 01 · CHALLENGE')).toBeVisible();
  await page.getByRole('button', { name: '12:00:41' }).click();
  await expect(
    page.getByText('Not yet: event time is stamped where the payment happened, not where it is read.'),
  ).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  // Not ^: the banner's text follows a screen-reader "Warning:" prefix.
  await expect(page.getByText(/Not yet:/)).toHaveCount(0);
  await page.getByRole('button', { name: '12:00:03' }).click();
  await expect(page.getByText('Correct.')).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('button', { name: 'Counts by event time' }).click();
  await page.getByRole('button', { name: 'Finish chapter' }).click();
  const done = page.getByRole('dialog', { name: 'Chapter 1 complete' });
  await expect(done).toContainText('1 of 10 done');
  await axe(page);
  await done.getByRole('button', { name: 'Back to course' }).click();
  const rows = page.getByRole('list', { name: 'Chapters' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Completed');
  await expect(rows.nth(1).getByRole('link', { name: 'Start chapter 2' })).toBeVisible();
  await axe(page);
});

test('LEARN-01 opening a chapter marks it in progress: the course offers Continue', async ({ page }) => {
  await page.goto('/#/learn/event-time');
  await expect(page.getByRole('heading', { level: 1, name: 'Event time vs processing time' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learn' }).click();
  await expect(page.getByRole('link', { name: 'Continue chapter 1' })).toBeVisible();
});

// ---- Audit of 02e7c4a ----
test('LEARN-01 audit 1: all open chapters done shows the W04c callout and a green bar', async ({ page }) => {
  await page.goto('/#/learn');
  await page.evaluate(async () => {
    const s = await import('/src/storage.ts');
    for (const id of ['event-time', 'watermarks', 'windows', 'aggregations', 'deduplication', 'joins'])
      await s.setChapterStatus(id, 'done');
  });
  await page.reload();
  const callout = page.getByRole('status').filter({ hasText: 'You finished the course.' });
  await expect(callout).toBeVisible();
  await expect(page.locator('[aria-label="Chapters done"] > div')).toHaveClass(/bg-success-600/);
  await axe(page);
  await callout.getByRole('link', { name: 'Open the simulator' }).click();
  await expect(page).toHaveURL(/#\/new$/);
});

test('LEARN-01 audit 2: storage blocked on /learn says so without a dead Export button', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error('blocked');
    };
  });
  await page.goto('/#/learn');
  await expect(page.getByText('This browser is not letting Stream Lab save.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export now' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your progress' })).toContainText(
    'Not saved in this browser right now',
  );
});

test('LAND-05 audit 4+8+11: rose focus ring on site links, Simulator current on My pipelines, page titles', async ({
  page,
}) => {
  await page.goto('/#/pipelines');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Simulator' })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('My pipelines · Stream Lab');
  await nav.getByRole('link', { name: 'Learn' }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
  await expect(nav.getByRole('link', { name: 'Learn' })).toHaveCSS('box-shadow', /204, 61, 92/);
  await page.goto('/#/nowhere');
  await expect(page).toHaveTitle('Page not found · Stream Lab');
  await expect(page.locator('header a').first()).toHaveText('streamlab');
});

test('LEARN-02 the chapter sandbox: the scenario idle, Run fills the timeline and the output; nothing is saved (W05, W05b)', async ({
  page,
}) => {
  await page.goto('/#/learn/windows');
  const box = page.getByRole('region', { name: 'Sandbox' });
  await expect(box.getByText('Press Run to start')).toBeVisible();
  await expect(box.locator('.react-flow__node')).toHaveCount(6); // Card fraud bursts
  await expect(box.getByText('Idle')).toBeVisible();
  await axe(page);
  await box.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(box.getByText('Finished')).toBeVisible({ timeout: 60000 });
  await expect(
    box
      .getByRole('table', { name: /^Output of / })
      .locator('tbody tr')
      .first(),
  ).toBeVisible();
  await expect(
    box.getByRole('img', { name: 'Timeline chart' }).or(box.getByLabel('Timeline chart')),
  ).toBeVisible();
  await axe(page);
  await box.getByRole('button', { name: 'Reset sandbox' }).click();
  await expect(box.getByText('Press Run to start')).toBeVisible();
  await page.goto('/#/pipelines');
  await expect(page.getByText('Card fraud bursts')).toHaveCount(0);
});

// ---- Audit of 9f1bab9 / 6b0da25 ----
test('LEARN-03 audit 4+5: keyboard — arrows do not answer, focus follows the result; the place survives reading a section', async ({
  page,
}) => {
  await page.goto('/#/learn/event-time');
  await page.getByRole('tab', { name: 'Challenge' }).click();
  const ch = page.getByRole('tabpanel', { name: 'Challenge' });
  await ch.getByRole('button', { name: '12:00:41' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(ch.getByRole('status')).toHaveCount(0); // nothing answered
  await page.keyboard.press('Enter'); // answers the focused one: wrong
  await expect(ch.getByRole('button', { name: 'Reset', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(ch.getByRole('button', { name: '12:00:41' })).toBeFocused();
  await ch.getByRole('button', { name: '12:00:03' }).click();
  await expect(ch.getByRole('button', { name: 'Next question' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(ch.getByRole('button', { name: 'Counts by processing time' })).toBeFocused();
  await expect(ch).toContainText('2 of 2');
  await page.getByRole('tab', { name: 'Two clocks' }).click();
  await page.getByRole('tab', { name: 'Challenge' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Challenge' })).toContainText('2 of 2');
});

test('LEARN-03 audit 1: storage blocked — passing does not claim the chapter is complete', async ({
  page,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error('blocked');
    };
  });
  await page.goto('/#/learn/event-time');
  await page.getByRole('tab', { name: 'Challenge' }).click();
  await page.getByRole('button', { name: '12:00:03' }).click();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('button', { name: 'Counts by event time' }).click();
  await page.getByRole('button', { name: 'Finish chapter' }).click();
  await expect(page.getByText('This browser is not letting Stream Lab save.').first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Chapter 1 complete' })).toHaveCount(0);
});

test('LEARN-01 audit 2+3+6: a v1 chapter is "Page not found"; the logo has the rose ring; a new chapter starts at its heading', async ({
  page,
}) => {
  await page.goto('/#/learn/state');
  await expect(page).toHaveTitle('Page not found · Stream Lab');
  await page.goto('/#/learn/joins');
  await expect(page).toHaveTitle('Joins and lookups · Stream Lab');
  // The page starts at the chapter's heading; from the header's second link, back one.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learn' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('header a').first()).toBeFocused();
  await expect(page.locator('header a').first()).toHaveCSS('box-shadow', /204, 61, 92/);
  await page.getByRole('navigation', { name: 'Chapters' }).getByRole('link', { name: 'Windows' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Windows' })).toBeFocused();
});
