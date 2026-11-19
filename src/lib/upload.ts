import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same limit as the storage bucket
export const ACCEPT = 'image/*,application/pdf';

/**
 * Shrinks photos before upload to save storage (free plan = 1 GB).
 * Images → max 2048px, ~1 MB. PDFs pass through. Video is rejected (use Drive links).
 */
export async function prepareFile(file: File): Promise<File> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 10 MB — share it as a Drive link instead.`);
    return file;
  }
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name}: only images and PDFs can be uploaded. Use a Google Drive link for video.`);
  }
  if (file.type === 'image/gif') {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 10 MB.`);
    return file; // compressing would break the animation
  }
  const keepPng = file.type === 'image/png'; // keep transparency on graphics
  const out = await imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
    fileType: keepPng ? 'image/png' : 'image/jpeg',
  });
  const name = file.name.replace(/\.[^.]+$/, '') + (keepPng ? '.png' : '.jpg');
  return new File([out], name, { type: out.type });
}

/** Uploads to the private "uploads" bucket and returns the storage path. */
export async function uploadFile(folder: string, file: File) {
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from('uploads').upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

// Signed URLs (the bucket is private). Cached for the session.
const urlCache = new Map<string, { url: string; expires: number }>();
export async function signedUrl(path: string) {
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from('uploads').createSignedUrl(path, 3600);
  if (error || !data) return '';
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 3500_000 });
  return data.signedUrl;
}
