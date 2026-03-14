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
    // Expose Node.js fs functions to the browser for mock FSA handles
    await page.exposeFunction('testFs_readFile', (p: string) => {
      try {
        const data = fs.readFileSync(path.resolve(p));
        return { data: Array.from(data) };
      } catch {
        return null;
      }
    });
    await page.exposeFunction('testFs_readdir', (p: string) => {
      try {
        return fs.readdirSync(path.resolve(p));
      } catch {
        return null;
      }
    });
    await page.exposeFunction('testFs_writeFile', (p: string, data: number[]) => {
      try {
        fs.writeFileSync(path.resolve(p), Buffer.from(data));
        return true;
      } catch {
        return false;
      }
    });
    await page.exposeFunction('testFs_stat', (p: string) => {
      try {
        const s = fs.statSync(path.resolve(p));
        return { exists: true, isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs, mode: s.mode };
      } catch {
        return { exists: false };
      }
    });

    // Inject mock showDirectoryPicker that bridges to Node.js fs via exposed functions
    await page.addInitScript((rootPath) => {
      const join = (base: string, part: string) => {
        if (!part || part === '.') return base;
        const b = base.endsWith('/') ? base.slice(0, -1) : base;
        const p = part.startsWith('/') ? part.slice(1) : part;
        return b + '/' + p;
      };

      const createMockHandle = (currentPath: string): any => ({
        kind: 'directory',
        name: currentPath.split('/').pop() || '',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        async *keys() {
          const entries = await (window as any).testFs_readdir(currentPath);
          if (entries) for (const e of entries) yield e;
        },
        async *values() {
          const entries = await (window as any).testFs_readdir(currentPath);
          if (entries) {
            for (const e of entries) {
              const full = join(currentPath, e);
              const stat = await (window as any).testFs_stat(full);
              if (stat.isDirectory) yield createMockHandle(full);
              else yield {
                kind: 'file',
                name: e,
                getFile: async () => {
                  const res = await (window as any).testFs_readFile(full);
                  return new File([new Uint8Array(res.data)], e, { lastModified: stat.mtimeMs });
                }
              };
            }
          }
        },
        getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
          const full = join(currentPath, name);
          const stat = await (window as any).testFs_stat(full);
          if (!stat.exists && !options?.create) {
            throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
          }
          if (stat.exists && !stat.isDirectory) {
            throw Object.assign(new Error('TypeMismatchError'), { name: 'TypeMismatchError' });
          }
          return createMockHandle(full);
        },
        getFileHandle: async (name: string, options?: { create?: boolean }) => {
          const full = join(currentPath, name);
          const stat = await (window as any).testFs_stat(full);
          if (!stat.exists && !options?.create) {
            throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
          }
          if (stat.exists && stat.isDirectory) {
            throw Object.assign(new Error('TypeMismatchError'), { name: 'TypeMismatchError' });
          }
          return {
            kind: 'file',
            name,
            getFile: async () => {
              const res = await (window as any).testFs_readFile(full);
              const s = await (window as any).testFs_stat(full);
              return new File([new Uint8Array(res.data)], name, { lastModified: s.mtimeMs });
            },
            createWritable: async () => {
              let chunks: number[] = [];
              return {
                async write(data: any) {
                  if (data instanceof Uint8Array) chunks.push(...data);
                  else if (typeof data === 'string') chunks.push(...new TextEncoder().encode(data));
                  else if (data instanceof ArrayBuffer) chunks.push(...new Uint8Array(data));
                  else chunks.push(...new Uint8Array(await new Blob([data]).arrayBuffer()));
                },
                async close() {
                  await (window as any).testFs_writeFile(full, chunks);
                  chunks = [];
                }
              };
            }
          };
        }
      });

      (window as any).showDirectoryPicker = async () => createMockHandle(rootPath);

      // Clear persisted state from previous runs
      localStorage.clear();
    }, repoPath);

    await page.goto('/');

    // Wait for app to load and show welcome or add button
    const welcomeButton = page.getByRole('button', { name: /Add your first repository/i });
    const plusButton = page.locator('.icon-btn', { has: page.locator('svg') }).first();
    await expect(welcomeButton.or(plusButton).first()).toBeVisible({ timeout: 15000 });
    await welcomeButton.or(plusButton).first().click();

    const selectFolderButton = page.getByRole('button', { name: /Select Folder/i });
    await selectFolderButton.click();

    const repoName = path.basename(repoPath);
    const repoItem = page.locator('.repo-item', { hasText: repoName });
    await expect(repoItem).toBeVisible({ timeout: 15000 });

    await repoItem.click();
    await expect(page.getByText('Modified Files')).toBeVisible();
    await expect(page.getByText('No changes detected.')).toBeVisible({ timeout: 15000 });

    // Modify a file and refresh
    updateFile(repoPath, 'README.md', '# Test Repo\nModified content');
    await page.locator('.header-meta button').click();

    const fileItem = page.locator('.file-list li').filter({ hasText: 'README.md' });
    await expect(fileItem).toBeVisible({ timeout: 15000 });

    await fileItem.click();
    await expect(page.locator('.d2h-ins').filter({ hasText: /Modified content/ })).toBeVisible({ timeout: 15000 });
  });
});
