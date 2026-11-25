import { isRemote, uploadFile } from './api';

/**
 * Open the device's own file chooser (Photos / Files on a phone). Must be called synchronously inside the click
 * handler, before any await, or mobile browsers block it. Resolves with [] when the person cancels.
 */
export function chooseFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.style.position = 'fixed'; input.style.left = '-9999px';
    let settled = false;
    const done = (files: File[]) => { if (settled) return; settled = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => done([...(input.files ?? [])]));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

/** Upload files one after another, reporting "Uploading clip.mov · 42% (120 of 300 MB)". Returns the upload ids. */
export async function uploadAll(files: File[], onStatus: (text: string) => void): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, file] of files.entries()) {
    const prefix = files.length > 1 ? `${index + 1}/${files.length} · ` : '';
    onStatus(`Uploading ${prefix}${file.name} · 0%`);
    ids.push(await uploadFile(file, ({ sent, size }) => onStatus(`Uploading ${prefix}${file.name} · ${Math.floor(sent / size * 100)}% (${mb(sent)} of ${mb(size)})`)));
  }
  onStatus(files.length > 1 ? `Uploaded ${files.length} files.` : `Uploaded ${files[0]?.name ?? 'file'}.`);
  return ids;
}

/**
 * For phone/remote use: start the chooser now (inside the click) and return a function that finishes the upload later.
 * On this computer it returns null and the server's own file dialog is used instead (files stay where they are).
 */
export function startDeviceUpload(accept: string, multiple: boolean) {
  if (!isRemote()) return null;
  const chosen = chooseFiles(accept, multiple);
  return async (onStatus: (text: string) => void): Promise<string[] | null> => {
    const files = await chosen;
    if (!files.length) return null;
    return uploadAll(files, onStatus);
  };
}

export const VIDEO_ACCEPT = 'video/*,.mov,.mp4,.m4v,.webm,.mkv';
export const IMAGE_ACCEPT = 'image/*,.heic,.heif';
