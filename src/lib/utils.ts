import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Save `content` as a timestamped file: netport-radar[-suffix]-<iso>.<ext>
export function downloadFile(content: string, type: string, ext: string, suffix = ''): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `netport-radar${suffix ? `-${suffix}` : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  a.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
