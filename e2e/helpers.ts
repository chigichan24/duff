import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const runGit = (repoPath: string, args: string[]) => {
  execSync(`git ${args.join(' ')}`, { cwd: repoPath, stdio: 'ignore' });
};

export const createTempRepo = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duff-e2e-'));
  const repoPath = path.join(tempDir, 'repo');
  fs.mkdirSync(repoPath);

  runGit(repoPath, ['init']);
  runGit(repoPath, ['config', 'user.email', 'test@example.com']);
  runGit(repoPath, ['config', 'user.name', 'Test User']);

  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repo\nInitial content');
  runGit(repoPath, ['add', '.']);
  runGit(repoPath, ['commit', '-m', '"Initial commit"']);

  return repoPath;
};

export const updateFile = (repoPath: string, fileName: string, content: string) => {
  fs.writeFileSync(path.join(repoPath, fileName), content);
};

export const commitChanges = (repoPath: string, message: string) => {
  runGit(repoPath, ['add', '.']);
  runGit(repoPath, ['commit', '-m', `"${message}"`]);
};
