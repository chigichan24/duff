import { Buffer } from 'buffer';

const handleCache = new Map<string, FileSystemHandle>();

export const createFsaAdapter = (rootHandle: FileSystemDirectoryHandle): any => {
  const getHandle = async (pathStr: string) => {
    if (!pathStr || pathStr === '.' || pathStr === '/') return rootHandle;
    if (handleCache.has(pathStr)) return handleCache.get(pathStr);

    const parts = pathStr.split('/').filter(p => p && p !== '.');
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
        if (i === parts.length - 1) {
          try { current = await current.getDirectoryHandle(part); }
          catch { current = await current.getFileHandle(part); }
        } else {
          current = await current.getDirectoryHandle(part);
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
      const handle = await getHandle(path);
      if (!(handle instanceof FileSystemFileHandle)) throw new Error('EISDIR');
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      const u8 = new Uint8Array(buffer);
      const encoding = typeof options === 'string' ? options : options?.encoding;
      if (encoding === 'utf8') return new TextDecoder().decode(u8);
      return Buffer.from(u8);
    },
    async writeFile(path: string, data: any) {
      const parts = path.split('/').filter(p => p && p !== '.');
      const name = parts.pop()!;
      let current: any = rootHandle;
      for (const p of parts) current = await current.getDirectoryHandle(p, { create: true });
      const handle = await current.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },
    async readdir(path: string) {
      const handle = await getHandle(path || '.');
      if (!(handle instanceof FileSystemDirectoryHandle)) throw new Error('ENOTDIR');
      const names = [];
      for await (const name of (handle as any).keys()) names.push(name);
      return names;
    },
    async stat(path: string) {
      const handle = await getHandle(path || '.');
      const isFile = handle instanceof FileSystemFileHandle;
      const file = isFile ? await (handle as FileSystemFileHandle).getFile() : null;
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
      const parts = path.split('/').filter(p => p && p !== '.');
      const name = parts.pop()!;
      const parent: any = await getHandle(parts.join('/'));
      await parent.removeEntry(name);
    },
    async mkdir(path: string) {
      const parts = path.split('/').filter(p => p && p !== '.');
      let current: any = rootHandle;
      for (const p of parts) current = await current.getDirectoryHandle(p, { create: true });
    },
    async rmdir(path: string) {
      const parts = path.split('/').filter(p => p && p !== '.');
      const name = parts.pop()!;
      const parent: any = await getHandle(parts.join('/'));
      await parent.removeEntry(name, { recursive: true });
    },
    async readlink() { return ''; },
    async symlink() { }
  };
  fs.promises = fs;
  return fs;
};
