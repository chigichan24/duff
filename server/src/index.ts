import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { simpleGit, type SimpleGit } from 'simple-git';
const app = express();
const port = process.env.PORT || 3001;
const REPO_FILE = process.env.REPO_FILE || path.join(__dirname, '../repositories.json');

app.use(cors());
app.use(express.json());

interface Repository {
  id: string;
  name: string;
  path: string;
  pollInterval: number; // seconds
}

// Helpers
const getRepositories = (): Repository[] => {
  if (!fs.existsSync(REPO_FILE)) return [];
  const data = fs.readFileSync(REPO_FILE, 'utf-8');
  return JSON.parse(data);
};

const saveRepositories = (repos: Repository[]) => {
  fs.writeFileSync(REPO_FILE, JSON.stringify(repos, null, 2));
};

// Routes
app.get('/api/repositories', (req, res) => {
  res.json(getRepositories());
});

app.post('/api/repositories', async (req, res) => {
  const { path: repoPath, pollInterval = 30 } = req.body;
  
  if (!fs.existsSync(repoPath)) {
    return res.status(400).json({ error: 'Directory does not exist' });
  }

  try {
    const git = simpleGit(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return res.status(400).json({ error: 'Not a valid git repository' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid repository path' });
  }

  const repos = getRepositories();
  const normalizedPath = path.resolve(repoPath);
  const id = crypto.createHash('md5').update(normalizedPath).digest('hex').substring(0, 12);
  
  if (repos.find(r => r.path === normalizedPath || r.id === id)) {
    return res.status(400).json({ error: 'Repository already registered' });
  }

  const newRepo: Repository = {
    id,
    name: path.basename(normalizedPath),
    path: normalizedPath,
    pollInterval
  };

  repos.push(newRepo);
  saveRepositories(repos);
  res.json(newRepo);
});

app.delete('/api/repositories/:id', (req, res) => {
  const { id } = req.params;
  const repos = getRepositories().filter(r => r.id !== id);
  saveRepositories(repos);
  res.status(204).send();
});

app.post('/api/repositories/reorder', (req, res) => {
  const { repositoryIds } = req.body;
  if (!Array.isArray(repositoryIds)) {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  const currentRepos = getRepositories();
  const reorderedRepos = repositoryIds
    .map(id => currentRepos.find(r => r.id === id))
    .filter(Boolean) as Repository[];

  saveRepositories(reorderedRepos);
  res.json(reorderedRepos);
});

app.get('/api/browse', (req, res) => {
  const requestedDir = (req.query.dir as string) || os.homedir();
  const showHidden = req.query.showHidden === 'true';

  const resolvedDir = path.resolve(requestedDir);

  if (!fs.existsSync(resolvedDir)) {
    return res.status(400).json({ error: 'Directory does not exist' });
  }

  const stat = fs.statSync(resolvedDir);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory' });
  }

  try {
    const items = fs.readdirSync(resolvedDir, { withFileTypes: true });
    const directories = items
      .filter(item => item.isDirectory())
      .filter(item => showHidden || !item.name.startsWith('.'))
      .map(item => {
        const fullPath = path.join(resolvedDir, item.name);
        let isGitRepo = false;
        try {
          isGitRepo = fs.existsSync(path.join(fullPath, '.git'));
        } catch { /* permission error */ }
        return {
          name: item.name,
          path: fullPath,
          isGitRepo,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolvedDir);

    res.json({
      currentPath: resolvedDir,
      parentPath: parentPath !== resolvedDir ? parentPath : null,
      entries: directories,
    });
  } catch (err: any) {
    res.status(403).json({ error: 'Permission denied: ' + err.message });
  }
});

app.get('/api/repositories/:id/status', async (req, res) => {
  const { id } = req.params;
  const repo = getRepositories().find(r => r.id === id);
  
  if (!repo) return res.status(404).json({ error: 'Repository not found' });

  try {
    const git: SimpleGit = simpleGit(repo.path);
    const status = await git.status();
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    res.json({
      branch,
      modifiedFiles: status.files.map(f => f.path),
      hasChanges: status.files.length > 0,
      lastUpdate: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repositories/:id/log', async (req, res) => {
  const { id } = req.params;
  const repo = getRepositories().find(r => r.id === id);
  
  if (!repo) return res.status(404).json({ error: 'Repository not found' });

  try {
    const git: SimpleGit = simpleGit(repo.path);
    
    // Fetch log with stats
    // We get 50 commits. 
    // --stat gives us insertions/deletions/files changed
    const log = await git.log(['--stat', '-n', '50']);
    
    // Fetch stash list
    // simple-git stashList returns basic info.
    const stashList = await git.stashList();
    
    // We want to merge them or return them structured.
    // For the UI, we'll need to know which are stashes.
    
    const commits = log.all.map(c => ({
      ...c,
      type: 'commit',
      // Ensure diff info is available if simple-git provides it in 'diff' property or we parse 'stat'
      // simple-git's DefaultLogFields includes: hash, date, message, refs, author_name, author_email
      // With --stat, it might add 'diff' property with stats.
    }));

    // Transform stash list to match log format roughly
    const stashes = stashList.all.map((s: any) => ({
      hash: s.hash, // stash@{n} usually, but simple-git might give the commit hash
      date: s.date,
      message: s.message,
      author_name: s.author_name,
      author_email: s.author_email,
      type: 'stash',
      refs: 'stash',
      diff: null // Stash diffs might need separate fetching if not provided
    }));

    res.json({
      items: [...commits, ...stashes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repositories/:id/diff', async (req, res) => {
  const { id } = req.params;
  const { file, from, to } = req.query;
  const repo = getRepositories().find(r => r.id === id);
  
  if (!repo) return res.status(404).json({ error: 'Repository not found' });

  try {
    const git: SimpleGit = simpleGit(repo.path);
    const args = ['--no-color'];
    
    if (from && to) {
      args.push(`${from}..${to}`);
    } else if (from) {
      args.push(from as string);
    } else {
      args.push('HEAD');
    }

    if (file) args.push('--', file as string);
    
    const diff = await git.diff(args);
    res.json({ diff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repositories/:id/files', async (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;
  const repo = getRepositories().find(r => r.id === id);
  
  if (!repo) return res.status(404).json({ error: 'Repository not found' });

  try {
    const git: SimpleGit = simpleGit(repo.path);
    const args = ['--name-only'];
    
    if (from && to) {
      args.push(`${from}..${to}`);
    } else if (from) {
      args.push(from as string);
    } else {
      // Default: show working tree changes (status)
      const status = await git.status();
      return res.json({ files: status.files.map(f => f.path) });
    }

    const filesString = await git.diff(args);
    const files = filesString.split('\n').filter(f => f.trim() !== '');
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repositories/:id/content', async (req, res) => {
  const { id } = req.params;
  const { file, version } = req.query;
  const repo = getRepositories().find(r => r.id === id);
  
  if (!repo) return res.status(404).json({ error: 'Repository not found' });
  if (!file) return res.status(400).json({ error: 'File path is required' });

  const filePath = file as string;
  const repoPath = path.resolve(repo.path);
  const fullPath = path.resolve(repoPath, filePath);

  // Security check: ensure path is within repo
  const relative = path.relative(repoPath, fullPath);
  const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

  if (!isSafe) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Normalize path for git (always relative to repo root, no ./ or / prefix)
  const gitPath = relative.replace(/\\/g, '/');

  try {
    if (version === 'HEAD') {
      try {
        const git = simpleGit(repo.path);
        const data = await git.binaryCatFile(['-p', `HEAD:${gitPath}`]);
        res.setHeader('Content-Type', contentType);
        res.send(data);
      } catch (err) {
        res.status(404).json({ error: 'File not found in HEAD' });
      }
    } else {
      const fullPathToRead = path.resolve(repoPath, gitPath);
      if (!fs.existsSync(fullPathToRead)) {
        return res.status(404).json({ error: 'File not found in working tree' });
      }
      const data = fs.readFileSync(fullPathToRead);
      res.setHeader('Content-Type', contentType);
      res.send(data);
    }
  } catch (error: any) {
    console.error(`Content API error for repo ${id} file ${filePath}:`, error);
    res.status(500).json({ error: error.message });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

export default app;
