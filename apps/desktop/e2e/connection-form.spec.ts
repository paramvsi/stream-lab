import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const toForm = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a connection' }).click();
  await page.getByRole('radio', { name: /Self-managed/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New connection' })).toBeVisible();
};

test('C02 custom headers: every row lines up, whatever its name (a credential name adds a line, not a column)', async ({
  page,
}) => {
  await toForm(page);
  await page.getByText('Advanced settings').click();
  for (const [i, name] of ['X-Tenant', 'proxy-authorization', 'X-Api-Key'].entries()) {
    await page.getByRole('button', { name: 'Add header' }).click();
    await page.getByLabel(`Header ${i + 1} name`).fill(name);
  }
  const boxes = await Promise.all(
    [1, 2, 3].flatMap((i) => [
      page.getByLabel(`Header ${i} name`).boundingBox(),
      page.getByLabel(`Header ${i} value`).boundingBox(),
    ]),
  );
  const names = boxes.filter((_, k) => k % 2 === 0).map((b) => [Math.round(b!.x), Math.round(b!.width)]);
  const values = boxes.filter((_, k) => k % 2 === 1).map((b) => [Math.round(b!.x), Math.round(b!.width)]);
  expect(new Set(names.map(String)).size).toBe(1);
  expect(new Set(values.map(String)).size).toBe(1);
  await expect(page.getByText('proxy-authorization is always kept in the keychain.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the connection form with advanced settings open has no axe violations', async ({ page }) => {
  await toForm(page);
  await page.getByText('Advanced settings').click();
  await page.getByRole('button', { name: 'Add header' }).click();
  await page.getByLabel('Header 1 name').fill('X-Api-Key');
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
