import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { simpleGit, SimpleGit } from 'simple-git';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);
const app = express();
const port = process.env.PORT || 3001;
const REPO_FILE = path.join(__dirname, '../repositories.json');

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

app.get('/api/repositories/:id/diff', async (req, res) => {
  const { id } = req.params;
  const { file } = req.query;
  const repo = getRepositories().find(r => r.id === id);
  
  if (!repo) return res.status(404).json({ error: 'Repository not found' });

  try {
    const git: SimpleGit = simpleGit(repo.path);
    const args = ['--no-color', 'HEAD'];
    if (file) args.push('--', file as string);
    
    const diff = await git.diff(args);
    res.json({ diff });
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
  let repoPath = path.resolve(repo.path);
  try {
    if (fs.existsSync(repoPath)) {
      repoPath = fs.realpathSync(repoPath);
    }
  } catch (e) {}

  let fullPath = path.resolve(repoPath, filePath);
  // Do not use realpathSync for fullPath yet, as it might not exist if it's HEAD version or deleted file

  console.log(`Content request: repoId=${id}, filePath=${filePath}`);
  console.log(`Resolved: repoPath=${repoPath}, fullPath=${fullPath}`);

  // Security check: ensure path is within repo
  const relative = path.relative(repoPath, fullPath);
  const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  
  if (!isSafe && relative !== '') {
    console.error(`Security violation attempt: ${fullPath} is not in ${repoPath}`);
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
        const { stdout } = await execFilePromise('git', ['show', `HEAD:${gitPath}`], { 
          cwd: repo.path, 
          encoding: 'buffer',
          maxBuffer: 10 * 1024 * 1024 // 10MB limit
        });
        res.setHeader('Content-Type', contentType);
        res.send(stdout);
      } catch (err) {
        console.error(`Git show error for ${gitPath}:`, err);
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
