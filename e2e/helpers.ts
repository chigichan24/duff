import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export const createTempRepo = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duff-e2e-'));
  const repoPath = path.join(tempDir, 'repo');
  fs.mkdirSync(repoPath);

  const runGit = (args: string[]) => {
    execSync(`git ${args.join(' ')}`, { cwd: repoPath, stdio: 'ignore' });
  };

  runGit(['init']);
  runGit(['config', 'user.email', 'test@example.com']);
  runGit(['config', 'user.name', 'Test User']);

  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repo\nInitial content');
  runGit(['add', '.']);
  runGit(['commit', '-m', '"Initial commit"']);

  return repoPath;
};

export const updateFile = (repoPath: string, fileName: string, content: string) => {
  fs.writeFileSync(path.join(repoPath, fileName), content);
};

export const commitChanges = (repoPath: string, message: string) => {
  const runGit = (args: string[]) => {
    execSync(`git ${args.join(' ')}`, { cwd: repoPath, stdio: 'ignore' });
  };
  runGit(['add', '.']);
  runGit(['commit', '-m', `"${message}"`]);
};
