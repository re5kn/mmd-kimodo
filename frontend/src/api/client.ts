import type { ModelDto, MotionDto } from './types';

export interface UploadFile {
  file: File;
  /** Folder-relative path ("model/tex/a.png"); defaults to the file name. */
  path?: string;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function uploadModel(files: UploadFile[], pmx?: string): Promise<ModelDto> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f.file, f.file.name);
    form.append('paths', f.path ?? f.file.name);
  }
  if (pmx) form.append('pmx', pmx);
  return parseResponse<ModelDto>(await fetch('/api/models', { method: 'POST', body: form }));
}

export async function loadModelFromUpload(uploadId: string, pmx: string): Promise<ModelDto> {
  const url = `/api/uploads/${encodeURIComponent(uploadId)}/model?pmx=${encodeURIComponent(pmx)}`;
  return parseResponse<ModelDto>(await fetch(url));
}

export async function uploadMotion(file: File): Promise<MotionDto> {
  const form = new FormData();
  form.append('file', file, file.name);
  return parseResponse<MotionDto>(await fetch('/api/motions', { method: 'POST', body: form }));
}
