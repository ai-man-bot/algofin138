import { projectId } from './supabase/info';

export const functionBaseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-f118884a`;

export function buildFunctionUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${functionBaseUrl}${normalizedPath}`;
}
