import { get, set, del, keys } from 'idb-keyval';

export interface RepositoryMetadata {
  id: string;
  name: string;
  addedAt: number;
}

const METADATA_KEY = 'duff_repositories_metadata';

export const repoStore = {
  async getRepositories(): Promise<RepositoryMetadata[]> {
    const raw = localStorage.getItem(METADATA_KEY);
    return raw ? JSON.parse(raw) : [];
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
    await set(id, handle);

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

  async verifyPermission(handle: FileSystemDirectoryHandle, readWrite = true): Promise<boolean> {
    const options: any = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }

    // Check if permission was already granted. If so, return true.
    if ((await (handle as any).queryPermission(options)) === 'granted') {
      return true;
    }
    // Request permission. If the user grants permission, return true.
    if ((await (handle as any).requestPermission(options)) === 'granted') {
      return true;
    }
    // The user didn't grant permission, so return false.
    return false;
  },

  async reorderRepositories(ids: string[]) {
    const current = await this.getRepositories();
    const reordered = ids
      .map(id => current.find(r => r.id === id))
      .filter((r): r is RepositoryMetadata => !!r);
    await this.saveRepositories(reordered);
  }
};
