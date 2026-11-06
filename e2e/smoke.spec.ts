import { test, expect } from '@playwright/test';

// One pass through the main UI in demo mode: map, board, toolbar, legend,
// flight card and the 3D globe. Fails on any uncaught page error.
test('demo mode renders and the main controls work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('tab', { name: /departures/i })).toBeVisible();
  for (const name of ['Filters', 'Legend', 'About and sources', '2D / 3D']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }

  // Demo flights arrive and show up on the board.
  const rows = page.getByRole('option');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });

  // Keyboard shortcut opens the legend; Esc closes it.
  await page.locator('body').click({ position: { x: 700, y: 300 } });
  await page.keyboard.press('l');
  await expect(page.getByRole('dialog', { name: 'Legend' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Legend' })).toBeHidden();

  // Selecting a row opens its flight card.
  await rows.first().click();
  await expect(page.getByRole('dialog', { name: /^Flight / })).toBeVisible();

  // The 3D globe (lazy chunk, WebGL) loads.
  await page.getByRole('button', { name: '2D / 3D', exact: true }).click();
  await expect(page.locator('.scene-container canvas')).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});
