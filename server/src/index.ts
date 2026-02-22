import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { simpleGit, SimpleGit } from 'simple-git';

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
    // Get diff against working tree
    const args = ['--no-color', 'HEAD'];
    if (file) args.push('--', file as string);
    
    const diff = await git.diff(args);
    res.json({ diff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
