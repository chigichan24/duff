import { test, expect } from '@playwright/test';
import { createTempRepo, updateFile } from './helpers';
import fs from 'fs';
import path from 'path';

test.describe('Repository Management (Serverless)', () => {
  let repoPath: string;

  test.beforeEach(() => {
    repoPath = createTempRepo();
    console.log('--- E2E DIAGNOSTICS ---');
    console.log('Repo Path:', repoPath);
    console.log('.git exists:', fs.existsSync(path.join(repoPath, '.git')));
    console.log('-----------------------');
  });

  test.afterEach(() => {
    if (repoPath && fs.existsSync(repoPath)) {
      fs.rmSync(path.dirname(repoPath), { recursive: true, force: true });
    }
  });

  test('should allow adding a repository and viewing its status', async ({ page }) => {
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        console.log(`BROWSER ${type.toUpperCase()}:`, text);
    });

    await page.exposeFunction('testFs_readFile', (p: string) => {
        const abs = path.resolve(p);
        try {
            const data = fs.readFileSync(abs);
            return { data: Array.from(data) };
        } catch (e: any) {
            return null;
        }
    });
    await page.exposeFunction('testFs_readdir', (p: string) => {
        const abs = path.resolve(p);
        try {
            return fs.readdirSync(abs);
        } catch (e: any) {
            return null;
        }
    });
    await page.exposeFunction('testFs_stat', (p: string) => {
        const abs = path.resolve(p);
        try {
          const s = fs.statSync(abs);
          return { exists: true, isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs, mode: s.mode };
        } catch (e) {
          return { exists: false };
        }
    });

    await page.addInitScript((rootPath) => {
      const join = (base: string, part: string) => {
          if (!part || part === '.') return base;
          const b = base.endsWith('/') ? base.slice(0, -1) : base;
          const p = part.startsWith('/') ? part.slice(1) : part;
          return b + '/' + p;
      };

      const createMockHandle = (currentPath: string): any => {
        return {
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
              const err = new Error('NotFoundError');
              err.name = 'NotFoundError';
              throw err;
            }
            if (stat.exists && !stat.isDirectory) {
              const err = new Error('TypeMismatchError');
              err.name = 'TypeMismatchError';
              throw err;
            }
            return createMockHandle(full);
          },
          getFileHandle: async (name: string, options?: { create?: boolean }) => {
            const full = join(currentPath, name);
            const stat = await (window as any).testFs_stat(full);
            if (!stat.exists && !options?.create) {
              const err = new Error('NotFoundError');
              err.name = 'NotFoundError';
              throw err;
            }
            if (stat.exists && stat.isDirectory) {
              const err = new Error('TypeMismatchError');
              err.name = 'TypeMismatchError';
              throw err;
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
                throw new Error('Write not implemented in mock');
              }
            };
          }
        };
      };

      (window as any).showDirectoryPicker = async () => {
        return createMockHandle(rootPath);
      };

      const testMetadataKey = 'test_repos_metadata';
      (window as any)._test_handles = {};
      (window as any).repoStore = {
        getRepositories: async () => JSON.parse(localStorage.getItem(testMetadataKey) || '[]'),
        saveRepositories: async (repos) => localStorage.setItem(testMetadataKey, JSON.stringify(repos)),
        addRepository: async (handle) => {
          const id = crypto.randomUUID();
          const metadata = { id, name: handle.name, addedAt: Date.now() };
          const repos = await (window as any).repoStore.getRepositories();
          repos.push(metadata);
          await (window as any).repoStore.saveRepositories(repos);
          (window as any)._test_handles[id] = handle;
          return metadata;
        },
        getHandle: async (id) => (window as any)._test_handles[id],
        verifyPermission: async () => true,
        removeRepository: async (id) => {
          const repos = await (window as any).repoStore.getRepositories();
          const filtered = repos.filter(r => r.id !== id);
          await (window as any).repoStore.saveRepositories(filtered);
          delete (window as any)._test_handles[id];
        }
      };
    }, repoPath);

    await page.goto('/');

    const welcomeButton = page.getByRole('button', { name: /Add your first repository/i });
    const plusButton = page.getByTitle('Add Repository');
    await expect(welcomeButton.or(plusButton).first()).toBeVisible({ timeout: 15000 });
    await welcomeButton.or(plusButton).first().click();

    const selectFolderButton = page.getByRole('button', { name: /Select Folder/i });
    await selectFolderButton.click();

    const repoName = path.basename(repoPath);
    const repoItem = page.locator('.repo-item', { hasText: repoName });
    await expect(repoItem).toBeVisible({ timeout: 15000 });

    await repoItem.click();
    await expect(page.getByText('Modified Files')).toBeVisible();
    await expect(page.getByText('No changes on this hole')).toBeVisible();

    updateFile(repoPath, 'README.md', '# Test Repo\nModified content');
    await page.locator('.header-meta button').click();
    
    const fileItem = page.locator('.file-list li').filter({ hasText: 'README.md' });
    await expect(fileItem).toBeVisible({ timeout: 15000 });
    
    await fileItem.click();
    await expect(page.locator('.d2h-ins').filter({ hasText: /Modified content/ })).toBeVisible();
  });
});
