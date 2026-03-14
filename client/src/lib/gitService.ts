import * as git from 'isomorphic-git';
import { createFsaAdapter } from './fsaAdapter';
import { createPatch } from 'diff';

export interface GitItem {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
  type: string;
}

export interface RepoStatus {
  branch: string;
  modifiedFiles: string[];
  hasChanges: boolean;
  lastUpdate: string;
}

const gitConfig = { dir: '.', gitdir: '.git' };
const gitCache = {};

const IGNORED_PREFIXES = ['node_modules/', '.git/', 'dist/'];

// Ref resolution cache with TTL and stale entry cleanup
const refCache = new Map<string, { oid: string; ts: number }>();
const REF_CACHE_TTL = 5000;

async function resolveOid(fs: any, ref: string): Promise<string> {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const now = Date.now();
  const cached = refCache.get(ref);
  if (cached && now - cached.ts < REF_CACHE_TTL) return cached.oid;
  const oid = await git.resolveRef({ fs, ...gitConfig, ref });
  refCache.set(ref, { oid, ts: now });
  // Evict stale entries periodically
  if (refCache.size > 20) {
    for (const [k, v] of refCache) {
      if (now - v.ts > REF_CACHE_TTL) refCache.delete(k);
    }
  }
  return oid;
}

async function getTreeFiles(fs: any, oid: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walkTree = async (treeOid: string, prefix: string) => {
    const { tree } = await git.readTree({ fs, ...gitConfig, oid: treeOid, cache: gitCache });
    for (const entry of tree) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === 'blob') {
        files.set(path, entry.oid);
      } else if (entry.type === 'tree') {
        await walkTree(entry.oid, path);
      }
    }
  };
  const commitOid = await resolveOid(fs, oid);
  const { object } = await git.readObject({ fs, ...gitConfig, oid: commitOid, cache: gitCache });
  const treeOid = (object as any).tree;
  await walkTree(treeOid, '');
  return files;
}

export const gitService = {
  async getStatus(handle: FileSystemDirectoryHandle): Promise<RepoStatus> {
    const fs = createFsaAdapter(handle);
    let branch = 'unknown';
    try {
      branch = await git.currentBranch({ fs, ...gitConfig }) || 'HEAD';
    } catch {
      try {
        const ref = await git.resolveRef({ fs, ...gitConfig, ref: 'HEAD' });
        branch = ref.substring(0, 7);
      } catch {}
    }

    const matrix = await git.statusMatrix({
        fs,
        ...gitConfig,
        cache: gitCache,
        filter: (path: string) => !IGNORED_PREFIXES.some(p => path.startsWith(p))
    });

    const modifiedFiles = matrix
      .filter(row => row[1] !== row[2] || row[2] !== row[3])
      .map(row => row[0]);

    return {
      branch,
      modifiedFiles,
      hasChanges: modifiedFiles.length > 0,
      lastUpdate: new Date().toISOString()
    };
  },

  async getLog(handle: FileSystemDirectoryHandle) {
    const fs = createFsaAdapter(handle);
    try {
      const log = await git.log({ fs, ...gitConfig, depth: 50, cache: gitCache });
      return log.map(c => ({
        hash: c.oid,
        date: new Date(c.commit.author.timestamp * 1000).toISOString(),
        message: c.commit.message,
        author_name: c.commit.author.name,
        author_email: c.commit.author.email,
        type: 'commit'
      }));
    } catch { return []; }
  },

  async getFiles(handle: FileSystemDirectoryHandle, from?: string, to?: string): Promise<string[]> {
    const fs = createFsaAdapter(handle);
    try {
        if (!from && !to) {
            const s = await this.getStatus(handle);
            return s.modifiedFiles;
        }

        if (from && to) {
          const [fromFiles, toFiles] = await Promise.all([
            getTreeFiles(fs, from),
            getTreeFiles(fs, to),
          ]);
          const changed: string[] = [];
          for (const [path, oid] of toFiles) {
            if (fromFiles.get(path) !== oid) changed.push(path);
          }
          for (const path of fromFiles.keys()) {
            if (!toFiles.has(path)) changed.push(path);
          }
          return changed.sort();
        }

        // from without to: compare commit to working tree
        const s = await this.getStatus(handle);
        return s.modifiedFiles;
    } catch { return []; }
  },

  async getDiff(handle: FileSystemDirectoryHandle, file?: string, from?: string, to?: string, knownFiles?: string[]): Promise<string> {
    const fs = createFsaAdapter(handle);
    const headOid = await resolveOid(fs, from || 'HEAD');

    const getBlob = async (oid: string, path: string): Promise<string> => {
      try {
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid, filepath: path, cache: gitCache });
        return new TextDecoder().decode(blob);
      } catch { return ''; }
    };

    const getWorking = async (path: string): Promise<string> => {
      try {
        return await fs.readFile(path, { encoding: 'utf8' });
      } catch { return ''; }
    };

    let files: string[];
    if (file) {
      files = [file];
    } else if (knownFiles && !from && !to) {
      files = knownFiles;
    } else {
      files = await this.getFiles(handle, from, to);
    }

    const toOid = to ? await resolveOid(fs, to) : null;

    let fullDiff = '';
    for (const f of files) {
      const oldC = await getBlob(headOid, f);
      const newC = toOid ? await getBlob(toOid, f) : await getWorking(f);
      if (oldC === newC && !file) continue;
      fullDiff += createPatch(f, oldC, newC, from || 'HEAD', to || 'Working Tree');
    }
    return fullDiff;
  },

  async getFileContent(handle: FileSystemDirectoryHandle, filePath: string, version?: string): Promise<Uint8Array | null> {
    const fs = createFsaAdapter(handle);
    try {
      if (version) {
        const oid = await resolveOid(fs, version);
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid, filepath: filePath, cache: gitCache });
        return blob;
      }
      return await fs.readFile(filePath);
    } catch { return null; }
  }
};
