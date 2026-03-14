import { Buffer } from 'buffer';

const adapterCache = new WeakMap<FileSystemDirectoryHandle, any>();

function splitPath(path: string): string[] {
  return path.split('/').filter(p => p && p !== '.');
}

function splitParentAndName(path: string): { parentPath: string; name: string } {
  const parts = splitPath(path);
  const name = parts.pop()!;
  return { parentPath: parts.join('/'), name };
}

export const createFsaAdapter = (rootHandle: FileSystemDirectoryHandle): any => {
  if (adapterCache.has(rootHandle)) return adapterCache.get(rootHandle);

  const handleCache = new Map<string, FileSystemHandle>();

  const getHandle = async (pathStr: string) => {
    if (!pathStr || pathStr === '.' || pathStr === '/') return rootHandle;
    if (handleCache.has(pathStr)) return handleCache.get(pathStr);

    const parts = splitPath(pathStr);
    let current: any = rootHandle;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += (currentPath ? '/' : '') + part;
      if (handleCache.has(currentPath)) {
          current = handleCache.get(currentPath);
          continue;
      }
      try {
        if (i < parts.length - 1) {
          current = await current.getDirectoryHandle(part);
        } else {
          try { current = await current.getFileHandle(part); }
          catch { current = await current.getDirectoryHandle(part); }
        }
        handleCache.set(currentPath, current);
      } catch (e) {
        throw Object.assign(new Error(`ENOENT: ${pathStr}`), { code: 'ENOENT' });
      }
    }
    return current;
  };

  const fs: any = {
    async readFile(path: string, options: any) {
      const handle = await getHandle(path) as any;
      if (handle.kind !== 'file') throw new Error('EISDIR');
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      const u8 = new Uint8Array(buffer);
      const encoding = typeof options === 'string' ? options : options?.encoding;
      if (encoding === 'utf8') return new TextDecoder().decode(u8);
      return Buffer.from(u8);
    },
    async writeFile(path: string, data: any) {
      const { parentPath, name } = splitParentAndName(path);
      const parts = splitPath(parentPath);
      let current: any = rootHandle;
      for (const p of parts) current = await current.getDirectoryHandle(p, { create: true });
      const handle = await current.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },
    async readdir(path: string) {
      const handle = await getHandle(path || '.');
      if ((handle as any).kind !== 'directory') throw new Error('ENOTDIR');
      const names = [];
      for await (const name of (handle as any).keys()) names.push(name);
      return names;
    },
    async stat(path: string) {
      const handle = await getHandle(path || '.');
      const isFile = (handle as any).kind === 'file';
      const file = isFile ? await (handle as any).getFile() : null;
      const mtimeMs = file ? file.lastModified : Date.now();
      const mtime = new Date(mtimeMs);
      return {
        isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false,
        size: file ? file.size : 0, mtimeMs, mtime, ctimeMs: mtimeMs, ctime: mtime,
        atimeMs: mtimeMs, atime: mtime, birthtimeMs: mtimeMs, birthtime: mtime,
        mode: isFile ? 0o644 : 0o755, uid: 0, gid: 0, dev: 0, ino: 0
      };
    },
    async lstat(path: string) { return this.stat(path); },
    async unlink(path: string) {
      const { parentPath, name } = splitParentAndName(path);
      const parent: any = await getHandle(parentPath);
      await parent.removeEntry(name);
    },
    async mkdir(path: string) {
      const parts = splitPath(path);
      let current: any = rootHandle;
      for (const p of parts) current = await current.getDirectoryHandle(p, { create: true });
    },
    async rmdir(path: string) {
      const { parentPath, name } = splitParentAndName(path);
      const parent: any = await getHandle(parentPath);
      await parent.removeEntry(name, { recursive: true });
    },
    async readlink() { return ''; },
    async symlink() { }
  };
  fs.promises = fs;

  adapterCache.set(rootHandle, fs);
  return fs;
};
