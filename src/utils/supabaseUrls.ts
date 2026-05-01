import { projectId } from './supabase/info';

export const functionBaseUrl =
  `https://${projectId}.supabase.co/functions/v1/webhook-listener`;

export const tradingViewWebhookBaseUrl =
  `https://${projectId}.supabase.co/functions/v1/webhook-listener`;

export function buildFunctionUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${functionBaseUrl}${normalizedPath}`;
}