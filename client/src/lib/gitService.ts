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

// Shared isomorphic-git cache for packfile/object lookups
const gitCache = {};

// Cache resolved refs to avoid repeated FS access
const refCache = new Map<string, { oid: string; ts: number }>();
const REF_CACHE_TTL = 5000; // 5 seconds

export const gitService = {
  async getStatus(handle: FileSystemDirectoryHandle): Promise<RepoStatus> {
    const fs = createFsaAdapter(handle);
    let branch = 'unknown';
    try {
      branch = await git.currentBranch({ fs, ...gitConfig }) || 'HEAD';
    } catch (e) {
      try {
        const ref = await git.resolveRef({ fs, ...gitConfig, ref: 'HEAD' });
        branch = ref.substring(0, 7);
      } catch(e2) {}
    }

    const matrix = await git.statusMatrix({
        fs,
        ...gitConfig,
        cache: gitCache,
        filter: path => !path.startsWith('node_modules/') && !path.startsWith('.git/') && !path.startsWith('dist/')
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
    } catch (e) { return []; }
  },

  async getFiles(handle: FileSystemDirectoryHandle, from?: string, to?: string): Promise<string[]> {
    const fs = createFsaAdapter(handle);
    try {
        if (!from && !to) {
            const s = await this.getStatus(handle);
            return s.modifiedFiles;
        }

        if (from) {
          const getTreeFiles = async (oid: string): Promise<Map<string, string>> => {
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
            const commitOid = await this._resolveOid(fs, oid);
            const { object } = await git.readObject({ fs, ...gitConfig, oid: commitOid, cache: gitCache });
            const treeOid = (object as any).tree;
            await walkTree(treeOid, '');
            return files;
          };

          const fromFiles = await getTreeFiles(from);

          if (to) {
            const toFiles = await getTreeFiles(to);
            const changed: string[] = [];
            for (const [path, oid] of toFiles) {
              if (fromFiles.get(path) !== oid) changed.push(path);
            }
            for (const path of fromFiles.keys()) {
              if (!toFiles.has(path)) changed.push(path);
            }
            return changed.sort();
          } else {
            const s = await this.getStatus(handle);
            return s.modifiedFiles;
          }
        }

        const matrix = await git.statusMatrix({ fs, ...gitConfig, cache: gitCache });
        return matrix.filter(row => row[1] !== row[2]).map(row => row[0]);
    } catch (e) { return []; }
  },

  /**
   * getDiff accepts an optional knownFiles to avoid re-running statusMatrix.
   * When called from App.tsx after updateStatus, pass modifiedFiles directly.
   */
  async getDiff(handle: FileSystemDirectoryHandle, file?: string, from?: string, to?: string, knownFiles?: string[]): Promise<string> {
    const fs = createFsaAdapter(handle);

    const headOid = await this._resolveOid(fs, from || 'HEAD');

    const getBlob = async (oid: string, path: string): Promise<string> => {
      try {
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid, filepath: path, cache: gitCache });
        return new TextDecoder().decode(blob);
      } catch (e) { return ''; }
    };

    const getWorking = async (path: string): Promise<string> => {
      try {
        return await fs.readFile(path, { encoding: 'utf8' });
      } catch (e) { return ''; }
    };

    // Use knownFiles to skip expensive getFiles/getStatus re-call
    let files: string[];
    if (file) {
      files = [file];
    } else if (knownFiles && !from && !to) {
      files = knownFiles;
    } else {
      files = await this.getFiles(handle, from, to);
    }

    const toOid = to ? await this._resolveOid(fs, to) : null;

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
        const oid = await this._resolveOid(fs, version);
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid, filepath: filePath, cache: gitCache });
        return blob;
      }
      return await fs.readFile(filePath);
    } catch (e) { return null; }
  },

  /** Resolve a ref (e.g. 'HEAD') to a commit oid, with short TTL cache */
  async _resolveOid(fs: any, ref: string): Promise<string> {
    if (/^[0-9a-f]{40}$/.test(ref)) return ref;
    const cached = refCache.get(ref);
    if (cached && Date.now() - cached.ts < REF_CACHE_TTL) return cached.oid;
    const oid = await git.resolveRef({ fs, ...gitConfig, ref });
    refCache.set(ref, { oid, ts: Date.now() });
    return oid;
  }
};
