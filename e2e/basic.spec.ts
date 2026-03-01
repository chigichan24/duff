import { test, expect } from '@playwright/test';
import { createTempRepo, updateFile } from './helpers';
import fs from 'fs';
import path from 'path';

test.describe('Repository Management', () => {
  let repoPath: string;

  test.beforeEach(() => {
    repoPath = createTempRepo();
  });

  test.afterEach(() => {
    if (repoPath && fs.existsSync(repoPath)) {
      fs.rmSync(path.dirname(repoPath), { recursive: true, force: true });
    }
  });

  test('should allow adding a repository and viewing its status', async ({ page }) => {
    await page.goto('/');

    // Open Add Modal (Plus icon)
    await page.getByTitle('Add Repository').click();

    // Switch to "Enter Path" mode
    await page.getByRole('button', { name: 'Enter Path' }).click();

    // Enter path
    const input = page.getByPlaceholder('/absolute/path/to/repo');
    await input.fill(repoPath);

    // Submit - フォーム内のAddボタンを明示的に指定
    const addButton = page.locator('form').getByRole('button', { name: 'Add' });
    await expect(addButton).toBeEnabled();
    await addButton.click();

    // Verify repo appears in sidebar
    const repoName = path.basename(repoPath);
    const repoItem = page.locator('.repo-item', { hasText: repoName });
    await expect(repoItem).toBeVisible({ timeout: 10000 });

    // Select the repository
    await repoItem.click();

    // Verify initial state (should be clean)
    await expect(page.getByText('Modified Files')).toBeVisible();
    await expect(page.getByText('No changes on this hole')).toBeVisible();

    // Modify a file
    updateFile(repoPath, 'README.md', '# Test Repo\nModified content');

    // Trigger refresh
    await page.locator('.header-meta button').click();

    // Verify file appears in modified list
    const fileItem = page.locator('.file-list li').filter({ hasText: 'README.md' });
    await expect(fileItem).toBeVisible();

    // Click the file to view diff
    await fileItem.click();

    // Verify diff content
    await expect(page.locator('.d2h-ins').filter({ hasText: 'Modified content' })).toBeVisible();
  });
});
