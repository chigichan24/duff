import * as git from 'isomorphic-git';
import { createFsaAdapter } from './fsaAdapter';
import { createPatch } from 'diff';

export interface RepoStatus {
  branch: string;
  modifiedFiles: string[];
  hasChanges: boolean;
  lastUpdate: string;
}

export interface GitItem {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
  type: 'commit' | 'stash';
  refs?: string;
}

export const gitService = {
  async getStatus(handle: FileSystemDirectoryHandle): Promise<RepoStatus> {
    const fs = createFsaAdapter(handle);
    const branch = await git.currentBranch({ fs, dir: '/' }) || 'HEAD';
    const matrix = await git.statusMatrix({ fs, dir: '/' });
    
    // row: [path, head, workdir, stage]
    // head, workdir, stage: 0=deleted, 1=unmodified, 2=modified
    // but matrix uses numbers representing state.
    // isomorphic-git matrix state:
    // [path, head, workdir, stage]
    // 0: absent, 1: present, 2: modified
    
    const modifiedFiles = matrix
      .filter(row => row[1] !== row[2] || row[2] !== row[3]) // Modified or untracked
      .map(row => row[0]);

    return {
      branch,
      modifiedFiles,
      hasChanges: modifiedFiles.length > 0,
      lastUpdate: new Date().toISOString()
    };
  },

  async getLog(handle: FileSystemDirectoryHandle): Promise<GitItem[]> {
    const fs = createFsaAdapter(handle);
    const log = await git.log({ fs, dir: '/', depth: 50 });
    
    return log.map(c => ({
      hash: c.oid,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      message: c.commit.message,
      author_name: c.commit.author.name,
      author_email: c.commit.author.email,
      type: 'commit'
    }));
  },

  async getFiles(handle: FileSystemDirectoryHandle, from?: string, to?: string): Promise<string[]> {
    const fs = createFsaAdapter(handle);
    if (!from && !to) {
      const status = await this.getStatus(handle);
      return status.modifiedFiles;
    }

    // Comparing two commits or commit/working tree
    if (from && to) {
      // isomorphic-git Walk is needed here for proper diffing
      // but a simpler way is git.statusMatrix if we compare HEAD and working tree.
      // For general from/to, we use git.walk
    }
    
    // Fallback or specific logic for statusMatrix if from is HEAD
    if (from === 'HEAD' && !to) {
      const matrix = await git.statusMatrix({ fs, dir: '/' });
      return matrix.filter(row => row[1] !== row[2]).map(row => row[0]);
    }

    return [];
  },

  async getDiff(handle: FileSystemDirectoryHandle, file?: string, from?: string, to?: string): Promise<string> {
    const fs = createFsaAdapter(handle);
    
    const getBlob = async (oid: string, filePath: string): Promise<string> => {
      try {
        const { blob } = await git.readBlob({ fs, dir: '/', oid, filepath: filePath });
        return new TextDecoder().decode(blob);
      } catch (e) {
        return '';
      }
    };

    const getWorkingFile = async (filePath: string): Promise<string> => {
      try {
        const content = await fs.promises.readFile(filePath, { encoding: 'utf8' });
        return content as string;
      } catch (e) {
        return '';
      }
    };

    const filesToDiff = file ? [file] : await this.getFiles(handle, from, to);
    let fullDiff = '';

    for (const filePath of filesToDiff) {
      let oldContent = '';
      let newContent = '';

      if (!from || from === 'HEAD') {
        const headOid = await git.resolveRef({ fs, dir: '/', ref: 'HEAD' });
        // Try to find the blob in HEAD
        try {
          const { blob } = await git.readObject({ fs, dir: '/', oid: headOid, filepath: filePath });
          oldContent = new TextDecoder().decode(blob as Uint8Array);
        } catch (e) {}
      } else {
        oldContent = await getBlob(from, filePath);
      }

      if (!to) {
        newContent = await getWorkingFile(filePath);
      } else {
        newContent = await getBlob(to, filePath);
      }

      fullDiff += createPatch(filePath, oldContent, newContent, 'old', 'new');
    }

    return fullDiff;
  },

  async getFileContent(handle: FileSystemDirectoryHandle, filePath: string, version?: string): Promise<Uint8Array | null> {
    const fs = createFsaAdapter(handle);
    try {
      if (version === 'HEAD') {
        const headOid = await git.resolveRef({ fs, dir: '/', ref: 'HEAD' });
        const { blob } = await git.readObject({ fs, dir: '/', oid: headOid, filepath: filePath });
        return blob as Uint8Array;
      } else {
        const data = await fs.promises.readFile(filePath);
        return data as Uint8Array;
      }
    } catch (e) {
      return null;
    }
  }
};
