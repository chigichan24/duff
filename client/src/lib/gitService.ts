import * as git from 'isomorphic-git';
import { createFsaAdapter } from './fsaAdapter';
import { createPatch } from 'diff';

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
        // シンプルな実装：matrixを使う（範囲指定は将来の課題だが、現状はこれで確実性を優先）
        const matrix = await git.statusMatrix({ fs, ...gitConfig });
        return matrix.filter(row => row[1] !== row[2]).map(row => row[0]);
    } catch (e) { return []; }
  },

  async getDiff(handle: FileSystemDirectoryHandle, file?: string, from?: string, to?: string): Promise<string> {
    const fs = createFsaAdapter(handle);
    
    const getBlob = async (ref: string, path: string): Promise<string> => {
      try {
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid: ref, filepath: path });
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
        const { blob } = await git.readBlob({ fs, ...gitConfig, oid: version, filepath: filePath });
        return blob;
      }
      return await fs.readFile(filePath);
    } catch (e) { return null; }
  }
};
