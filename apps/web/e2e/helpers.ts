import { expect, type Page } from '@playwright/test';

/** Start a blank pipeline from the gallery (W07) and wait for the workspace (W09 empty). */
export async function openBlank(page: Page) {
  await page.goto('/#/new');
  await page.getByRole('button', { name: 'Start blank' }).click();
  await expect(page.getByText('Start with a source')).toBeVisible();
}
