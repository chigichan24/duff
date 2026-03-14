import { get, set, del } from 'idb-keyval';

export interface RepositoryMetadata {
  id: string;
  name: string;
  addedAt: number;
}

const METADATA_KEY = 'duff_repositories_metadata';

export const repoStore = {
  async getRepositories(): Promise<RepositoryMetadata[]> {
    try {
      const raw = localStorage.getItem(METADATA_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to read repositories from localStorage', e);
      return [];
    }
  },

  async saveRepositories(repos: RepositoryMetadata[]) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(repos));
  },

  async addRepository(handle: FileSystemDirectoryHandle): Promise<RepositoryMetadata> {
    const id = crypto.randomUUID();
    const metadata: RepositoryMetadata = {
      id,
      name: handle.name,
      addedAt: Date.now(),
    };

    const repos = await this.getRepositories();
    repos.push(metadata);
    await this.saveRepositories(repos);
    try { await set(id, handle); } catch {
      // Handle may not be structured-cloneable in test environments
    }

    return metadata;
  },

  async removeRepository(id: string) {
    const repos = await this.getRepositories();
    const filtered = repos.filter(r => r.id !== id);
    await this.saveRepositories(filtered);
    await del(id);
  },

  async getHandle(id: string): Promise<FileSystemDirectoryHandle | undefined> {
    return await get(id);
  },

  /** Check if permission is already granted without prompting the user */
  async checkPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      return (await (handle as any).queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch { return false; }
  },

  /** Verify permission, prompting the user if needed */
  async verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    if (await this.checkPermission(handle)) return true;
    try {
      return (await (handle as any).requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch { return false; }
  },

  async reorderRepositories(ids: string[]) {
    const current = await this.getRepositories();
    const reordered = ids
      .map(id => current.find(r => r.id === id))
      .filter((r): r is RepositoryMetadata => !!r);
    await this.saveRepositories(reordered);
  }
};
