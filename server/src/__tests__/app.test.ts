import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';
import app from '../index';

vi.mock('fs');
vi.mock('simple-git');

describe('API Server', () => {
  const mockRepos = [
    { id: 'repo1', name: 'repo1', path: '/path/to/repo1', pollInterval: 30 },
    { id: 'repo2', name: 'repo2', path: '/path/to/repo2', pollInterval: 60 },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/repositories', () => {
    it('should return empty array if repositories.json does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const res = await request(app).get('/api/repositories');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return repositories from repositories.json', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      const res = await request(app).get('/api/repositories');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRepos);
    });
  });

  describe('POST /api/repositories', () => {
    it('should return 400 if directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const res = await request(app)
        .post('/api/repositories')
        .send({ path: '/non/existent' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Directory does not exist');
    });

    it('should return 400 if it is not a valid git repository', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return true;
        return true; // The repo path exists
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify([]));
      
      const mockGit = {
        checkIsRepo: vi.fn().mockResolvedValue(false),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app)
        .post('/api/repositories')
        .send({ path: '/some/path' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Not a valid git repository');
    });

    it('should return 400 if git check fails', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return true;
        return true; // The repo path exists
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify([]));
      
      const mockGit = {
        checkIsRepo: vi.fn().mockRejectedValue(new Error('Git failed')),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app)
        .post('/api/repositories')
        .send({ path: '/some/path' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid repository path');
    });

    it('should return 400 if repository already registered', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockGit = {
        checkIsRepo: vi.fn().mockResolvedValue(true),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app)
        .post('/api/repositories')
        .send({ path: '/path/to/repo1' }); // path resolve might be tricky in mock
      
      // Since path.resolve might not match the mocked string depending on environment,
      // we might need to be more specific or mock path.resolve.
      // But let's see if it works with exact matches first.
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Repository already registered');
    });

    it('should add a new repository successfully with default pollInterval', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return true;
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify([]));
      
      const mockGit = {
        checkIsRepo: vi.fn().mockResolvedValue(true),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app)
        .post('/api/repositories')
        .send({ path: '/new/repo' });
      
      expect(res.status).toBe(200);
      expect(res.body.pollInterval).toBe(30);
    });

    it('should add a new repository with custom pollInterval', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return true;
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify([]));
      
      const mockGit = {
        checkIsRepo: vi.fn().mockResolvedValue(true),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app)
        .post('/api/repositories')
        .send({ path: '/new/repo', pollInterval: 60 });
      
      expect(res.status).toBe(200);
      expect(res.body.pollInterval).toBe(60);
    });
  });

  describe('DELETE /api/repositories/:id', () => {
    it('should remove the repository and return 204', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app).delete('/api/repositories/repo1');
      expect(res.status).toBe(204);
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].id).toBe('repo2');
    });
  });

  describe('POST /api/repositories/reorder', () => {
    it('should return 400 if repositoryIds is not an array', async () => {
      const res = await request(app)
        .post('/api/repositories/reorder')
        .send({ repositoryIds: 'not-an-array' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid data format');
    });

    it('should reorder repositories successfully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app)
        .post('/api/repositories/reorder')
        .send({ repositoryIds: ['repo2', 'repo1'] });
      
      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('repo2');
      expect(res.body[1].id).toBe('repo1');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should ignore non-existent IDs during reorder', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app)
        .post('/api/repositories/reorder')
        .send({ repositoryIds: ['repo2', 'non-existent'] });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('repo2');
    });
  });

  describe('GET /api/browse', () => {
    it('should return directory entries for home directory when no dir specified', async () => {
      const mockDirents = [
        { name: 'Documents', isDirectory: () => true },
        { name: 'Downloads', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
        { name: '.hidden', isDirectory: () => true },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(fs.readdirSync).mockReturnValue(mockDirents as any);

      const res = await request(app).get('/api/browse');
      expect(res.status).toBe(200);
      expect(res.body.currentPath).toBeDefined();
      expect(res.body.entries).toBeDefined();
      // Files should be excluded, only directories
      const names = res.body.entries.map((e: any) => e.name);
      expect(names).toContain('Documents');
      expect(names).toContain('Downloads');
      expect(names).not.toContain('file.txt');
      // Hidden folders should be excluded by default
      expect(names).not.toContain('.hidden');
    });

    it('should include hidden directories when showHidden=true', async () => {
      const mockDirents = [
        { name: 'Documents', isDirectory: () => true },
        { name: '.hidden', isDirectory: () => true },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(fs.readdirSync).mockReturnValue(mockDirents as any);

      const res = await request(app).get('/api/browse').query({ showHidden: 'true' });
      expect(res.status).toBe(200);
      const names = res.body.entries.map((e: any) => e.name);
      expect(names).toContain('.hidden');
    });

    it('should return 400 if directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app).get('/api/browse').query({ dir: '/non/existent' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Directory does not exist');
    });

    it('should return 400 if path is not a directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);

      const res = await request(app).get('/api/browse').query({ dir: '/some/file.txt' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Path is not a directory');
    });

    it('should detect git repositories via .git folder', async () => {
      const mockDirents = [
        { name: 'my-repo', isDirectory: () => true },
      ];
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith('.git')) return true;
        return true;
      });
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(fs.readdirSync).mockReturnValue(mockDirents as any);

      const res = await request(app).get('/api/browse').query({ dir: '/home/user' });
      expect(res.status).toBe(200);
      expect(res.body.entries[0].isGitRepo).toBe(true);
    });

    it('should return null parentPath for root directory', async () => {
      const mockDirents: any[] = [];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(fs.readdirSync).mockReturnValue(mockDirents as any);

      const res = await request(app).get('/api/browse').query({ dir: '/' });
      expect(res.status).toBe(200);
      expect(res.body.parentPath).toBeNull();
    });
  });

  describe('GET /api/repositories/:id/status', () => {
    it('should return 404 if repository not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app).get('/api/repositories/non-existent/status');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Repository not found');
    });

    it('should return status successfully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockGit = {
        status: vi.fn().mockResolvedValue({ files: [{ path: 'file1.txt' }] }),
        revparse: vi.fn().mockResolvedValue('main'),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app).get('/api/repositories/repo1/status');
      expect(res.status).toBe(200);
      expect(res.body.branch).toBe('main');
      expect(res.body.hasChanges).toBe(true);
      expect(res.body.modifiedFiles).toContain('file1.txt');
    });

    it('should return 500 on git error', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockGit = {
        status: vi.fn().mockRejectedValue(new Error('Git status failed')),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app).get('/api/repositories/repo1/status');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Git status failed');
    });
  });

  describe('GET /api/repositories/:id/diff', () => {
    it('should return 404 if repository not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app).get('/api/repositories/non-existent/diff');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Repository not found');
    });

    it('should return diff successfully without file parameter', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockGit = {
        diff: vi.fn().mockResolvedValue('some full diff'),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app).get('/api/repositories/repo1/diff');
      expect(res.status).toBe(200);
      expect(res.body.diff).toBe('some full diff');
      expect(mockGit.diff).toHaveBeenCalledWith(['--no-color', 'HEAD']);
    });

    it('should return diff successfully with file parameter', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockGit = {
        diff: vi.fn().mockResolvedValue('some file diff'),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app).get('/api/repositories/repo1/diff').query({ file: 'test.txt' });
      expect(res.status).toBe(200);
      expect(res.body.diff).toBe('some file diff');
      expect(mockGit.diff).toHaveBeenCalledWith(['--no-color', 'HEAD', '--', 'test.txt']);
    });

    it('should return 500 on git error', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockGit = {
        diff: vi.fn().mockRejectedValue(new Error('Git diff failed')),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app).get('/api/repositories/repo1/diff');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Git diff failed');
    });
  });

  describe('GET /api/repositories/:id/content', () => {
    it('should return 404 if repository not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app).get('/api/repositories/non-existent/content').query({ file: 'test.png' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Repository not found');
    });

    it('should return 400 if file parameter is missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app).get('/api/repositories/repo1/content');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('File path is required');
    });

    it('should return 403 if path is outside repository', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const res = await request(app).get('/api/repositories/repo1/content').query({ file: '../../etc/passwd' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });

    it('should return HEAD version successfully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));
      
      const mockBuffer = Buffer.from('mock-head-data');
      const mockGit = {
        binaryCatFile: vi.fn().mockResolvedValue(mockBuffer),
      };
      vi.mocked(simpleGit).mockReturnValue(mockGit as any);

      const res = await request(app).get('/api/repositories/repo1/content').query({ file: 'test.png', version: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.header['content-type']).toBe('image/png');
      expect(res.body.toString()).toBe('mock-head-data');
      expect(mockGit.binaryCatFile).toHaveBeenCalledWith(['-p', 'HEAD:test.png']);
    });

    it('should return working tree version successfully', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return true;
        if (typeof p === 'string' && p.includes('test.png')) return true;
        return true;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return JSON.stringify(mockRepos);
        if (typeof p === 'string' && p.includes('test.png')) return Buffer.from('mock-working-data');
        return '';
      });

      const res = await request(app).get('/api/repositories/repo1/content').query({ file: 'test.png', version: 'working' });
      expect(res.status).toBe(200);
      expect(res.header['content-type']).toBe('image/png');
      expect(res.body.toString()).toBe('mock-working-data');
    });

    it('should return 404 if file not found in working tree', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('repositories.json')) return true;
        if (typeof p === 'string' && p.includes('missing.png')) return false;
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockRepos));

      const res = await request(app).get('/api/repositories/repo1/content').query({ file: 'missing.png', version: 'working' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('File not found in working tree');
    });
  });
});
