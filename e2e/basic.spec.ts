import { test, expect } from '@playwright/test';
import { createTempRepo, updateFile } from './helpers';
import fs from 'fs';
import path from 'path';

test.describe('Repository Management (Serverless)', () => {
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
    // 1. Expose Node.js fs to the browser for mocking FSA API
    await page.exposeFunction('testFs_readFile', (p: string) => {
        return fs.readFileSync(p);
    });
    await page.exposeFunction('testFs_readdir', (p: string) => {
        return fs.readdirSync(p);
    });
    await page.exposeFunction('testFs_stat', (p: string) => {
        const s = fs.statSync(p);
        return { isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
    });

    // 2. Mock showDirectoryPicker
    await page.addInitScript((rootPath) => {
      const createMockHandle = (currentPath: string): any => {
        return {
          kind: 'directory',
          name: currentPath.split('/').pop() || '',
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted',
          async *keys() {
            const entries = await (window as any).testFs_readdir(currentPath);
            for (const e of entries) yield e;
          },
          async *values() {
             const entries = await (window as any).testFs_readdir(currentPath);
             for (const e of entries) {
                const full = currentPath + '/' + e;
                const stat = await (window as any).testFs_stat(full);
                if (stat.isDirectory) yield createMockHandle(full);
                else yield { kind: 'file', name: e };
             }
          },
          getDirectoryHandle: async (name: string) => createMockHandle(currentPath + '/' + name),
          getFileHandle: async (name: string) => {
            const full = currentPath + '/' + name;
            return {
              kind: 'file',
              name,
              getFile: async () => {
                const data = await (window as any).testFs_readFile(full);
                const stat = await (window as any).testFs_stat(full);
                return new File([data], name, { lastModified: stat.mtimeMs });
              },
              createWritable: async () => {
                // Mock writable if needed
                throw new Error('Write not implemented in mock');
              }
            };
          }
        };
      };

      (window as any).showDirectoryPicker = async () => {
        return createMockHandle(rootPath);
      };
    }, repoPath);

    await page.goto('/');

    // 3. Add Repository
    await page.getByRole('button', { name: 'Add your first repository' }).or(page.getByTitle('Add Repository')).click();
    await page.getByRole('button', { name: 'Select Folder' }).click();

    // 4. Verify repo appears in sidebar
    const repoName = path.basename(repoPath);
    const repoItem = page.locator('.repo-item', { hasText: repoName });
    await expect(repoItem).toBeVisible({ timeout: 15000 });

    // 5. Select and verify status
    await repoItem.click();
    await expect(page.getByText('Modified Files')).toBeVisible();
    await expect(page.getByText('No changes on this hole')).toBeVisible();

    // 6. Modify a file and verify diff
    updateFile(repoPath, 'README.md', '# Test Repo\nModified content');
    
    // Refresh
    await page.locator('.header-meta button').click();
    
    // In serverless mode, it might take a moment for isomorphic-git to re-scan
    const fileItem = page.locator('.file-list li').filter({ hasText: 'README.md' });
    await expect(fileItem).toBeVisible({ timeout: 10000 });
    
    await fileItem.click();
    // Unified diff created by 'diff' library in gitService.ts
    await expect(page.locator('.d2h-ins').filter({ hasText: 'Modified content' })).toBeVisible();
  });
});
