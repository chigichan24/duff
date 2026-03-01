import { Buffer } from 'buffer';

export interface FSAdapter {
  promises: {
    readFile(path: string, options?: { encoding?: string }): Promise<Uint8Array | string>;
    writeFile(path: string, data: Uint8Array | string, options?: { encoding?: string }): Promise<void>;
    unlink(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    stat(path: string): Promise<any>;
    lstat(path: string): Promise<any>;
    readlink(path: string): Promise<string>;
    symlink(target: string, path: string): Promise<void>;
  };
}

export const createFsaAdapter = (rootHandle: FileSystemDirectoryHandle): FSAdapter => {
  const resolvePath = async (pathStr: string, options: { create?: boolean; isDirectory?: boolean } = {}) => {
    const parts = pathStr.split('/').filter(Boolean);
    if (parts.length === 0) return { handle: rootHandle, name: '', parent: null };
    
    let current = rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i], { create: options.create });
    }
    
    const name = parts[parts.length - 1];
    return { parent: current, name };
  };

  const getFileHandle = async (path: string, create = false) => {
    const { parent, name } = await resolvePath(path, { create });
    if (!parent) return rootHandle as unknown as FileSystemFileHandle; // Should not happen for files
    return await parent.getFileHandle(name, { create });
  };

  const getDirHandle = async (path: string, create = false) => {
    const { parent, name } = await resolvePath(path, { create });
    if (!parent) return rootHandle;
    return await parent.getDirectoryHandle(name, { create });
  };

  return {
    promises: {
      async readFile(path, options) {
        const handle = await getFileHandle(path);
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        if (options?.encoding === 'utf8') {
          return new TextDecoder().decode(uint8Array);
        }
        return uint8Array;
      },

      async writeFile(path, data) {
        const handle = await getFileHandle(path, true);
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
      },

      async unlink(path) {
        const { parent, name } = await resolvePath(path);
        if (parent) await parent.removeEntry(name);
      },

      async readdir(path) {
        const handle = await getDirHandle(path);
        const names: string[] = [];
        for await (const name of (handle as any).keys()) {
          names.push(name);
        }
        return names;
      },

      async mkdir(path) {
        await getDirHandle(path, true);
      },

      async rmdir(path) {
        const { parent, name } = await resolvePath(path);
        if (parent) await parent.removeEntry(name, { recursive: true });
      },

      async stat(path) {
        if (path === '/' || path === '' || path === '.') {
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            size: 0,
            mtimeMs: Date.now(),
          };
        }
        try {
          const { parent, name } = await resolvePath(path);
          if (!parent) throw new Error('Not found');
          const handle = await parent.getDirectoryHandle(name).catch(() => parent.getFileHandle(name));
          const isFile = handle.kind === 'file';
          let size = 0;
          let mtimeMs = Date.now();
          if (isFile) {
            const file = await (handle as FileSystemFileHandle).getFile();
            size = file.size;
            mtimeMs = file.lastModified;
          }
          return {
            isFile: () => isFile,
            isDirectory: () => !isFile,
            isSymbolicLink: () => false,
            size,
            mtimeMs,
          };
        } catch (e) {
          const error: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
          error.code = 'ENOENT';
          throw error;
        }
      },

      async lstat(path) {
        return this.stat(path);
      },

      async readlink() {
        throw new Error('Not implemented: readlink');
      },

      async symlink() {
        throw new Error('Not implemented: symlink');
      }
    }
  };
};
