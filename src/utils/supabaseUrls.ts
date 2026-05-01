// src/utils/supabaseUrls.ts

import { projectId } from './supabase/info';

export const functionBaseUrl =
  `https://${projectId}.supabase.co/functions/v1/webhook-listener`;

export const tradingViewWebhookBaseUrl =
  `https://${projectId}.supabase.co/functions/v1/webhook-listener`;