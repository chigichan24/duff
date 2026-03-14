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

    // フィルタリングを効かせて走査
    const matrix = await git.statusMatrix({ 
        fs, 
        ...gitConfig,
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
      const log = await git.log({ fs, ...gitConfig, depth: 50 });
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

        // コミット範囲が指定された場合、TREE を比較してファイル一覧を取得
        if (from) {
          const resolveOid = async (ref: string): Promise<string> => {
            if (/^[0-9a-f]{40}$/.test(ref)) return ref;
            return await git.resolveRef({ fs, ...gitConfig, ref });
          };

          const getTreeFiles = async (oid: string): Promise<Map<string, string>> => {
            const files = new Map<string, string>();
            const walkTree = async (treeOid: string, prefix: string) => {
              const { tree } = await git.readTree({ fs, ...gitConfig, oid: treeOid });
              for (const entry of tree) {
                const path = prefix ? `${prefix}/${entry.path}` : entry.path;
                if (entry.type === 'blob') {
                  files.set(path, entry.oid);
                } else if (entry.type === 'tree') {
                  await walkTree(entry.oid, path);
                }
              }
            };
            const commitOid = await resolveOid(oid);
            const { object } = await git.readObject({ fs, ...gitConfig, oid: commitOid });
            const treeOid = (object as any).tree;
            await walkTree(treeOid, '');
            return files;
          };

          const fromFiles = await getTreeFiles(from);

          if (to) {
            const toFiles = await getTreeFiles(to);
            const changed: string[] = [];
            // Files changed or added in 'to' compared to 'from'
            for (const [path, oid] of toFiles) {
              if (fromFiles.get(path) !== oid) changed.push(path);
            }
            // Files deleted in 'to'
            for (const path of fromFiles.keys()) {
              if (!toFiles.has(path)) changed.push(path);
            }
            return changed.sort();
          } else {
            // Compare from commit to working tree
            const s = await this.getStatus(handle);
            return s.modifiedFiles;
          }
        }

        const matrix = await git.statusMatrix({ fs, ...gitConfig });
        return matrix.filter(row => row[1] !== row[2]).map(row => row[0]);
    } catch (e) { return []; }
  },

  async getDiff(handle: FileSystemDirectoryHandle, file?: string, from?: string, to?: string): Promise<string> {
    const fs = createFsaAdapter(handle);

    const resolveOid = async (ref: string): Promise<string> => {
      if (/^[0-9a-f]{40}$/.test(ref)) return ref;
      return await git.resolveRef({ fs, ...gitConfig, ref });
    };

    const getBlob = async (ref: string, path: string): Promise<string> => {
      try {
        const oid = await resolveOid(ref);
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid, filepath: path });
        return new TextDecoder().decode(blob);
      } catch (e) { return ''; }
    };

    const getWorking = async (path: string): Promise<string> => {
      try {
        return await fs.readFile(path, { encoding: 'utf8' });
      } catch (e) { return ''; }
    };

    const files = file ? [file] : await this.getFiles(handle, from, to);
    let fullDiff = '';

    for (const f of files) {
      const oldC = await getBlob(from || 'HEAD', f);
      const newC = to ? await getBlob(to, f) : await getWorking(f);
      if (oldC === newC && !file) continue;
      fullDiff += createPatch(f, oldC, newC, from || 'HEAD', to || 'Working Tree');
    }
    return fullDiff;
  },

  async getFileContent(handle: FileSystemDirectoryHandle, filePath: string, version?: string): Promise<Uint8Array | null> {
    const fs = createFsaAdapter(handle);
    try {
      if (version) {
        let oid = version;
        if (!/^[0-9a-f]{40}$/.test(version)) {
          oid = await git.resolveRef({ fs, ...gitConfig, ref: version });
        }
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid, filepath: filePath });
        return blob;
      }
      return await fs.readFile(filePath);
    } catch (e) { return null; }
  }
};
