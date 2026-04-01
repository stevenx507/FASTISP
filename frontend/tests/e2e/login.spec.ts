import { test, expect } from '@playwright/test'

test('pantalla de login carga y muestra formulario', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('ISPMAX')).toBeVisible()
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /ingresar|login|entrar/i })).toBeVisible()
})
