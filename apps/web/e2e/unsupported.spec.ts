import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error a browser without Web Workers
    delete window.Worker;
  });
});

test('BROWSER-UNSUPPORTED the simulator pages say so (WX07); the course still opens', async ({ page }) => {
  for (const route of ['/#/new', '/#/pipelines', '/#/sim/p_x', '/#/s/1.abc']) {
    await page.goto(route);
    await expect(
      page.getByText('This browser can not run the simulator', { exact: false }).first(),
    ).toBeVisible();
  }
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Read the course' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Apache Flink®, hands on' })).toBeVisible();
});

test('BROWSER-UNSUPPORTED a chapter still reads; its sandbox says why it is not there', async ({ page }) => {
  await page.goto('/#/learn/windows');
  await expect(page.getByRole('heading', { level: 1, name: 'Windows' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tumbling' })).toBeVisible();
  await expect(
    page.getByText('This browser can not run the simulator. You can still read every chapter.'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sandbox' })).toHaveCount(0);
});
