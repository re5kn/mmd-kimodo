import type { UploadFile } from './api/client';

/** Files from an <input type="file"> (with webkitdirectory, relative paths are kept). */
export function filesFromInput(list: FileList | null): UploadFile[] {
  if (!list) return [];
  return Array.from(list).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Files from a drop event, walking dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<UploadFile[]> {
  const entries = Array.from(dt.items)
    .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files).map((file) => ({ file, path: file.name }));
  const out: UploadFile[] = [];
  for (const e of entries) await walk(e, '', out);
  return out;
}

async function walk(entry: FileSystemEntry, prefix: string, out: UploadFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, path });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path, out);
    }
  }
}

export const isMotionFile = (f: UploadFile) => f.file.name.toLowerCase().endsWith('.vmd');
