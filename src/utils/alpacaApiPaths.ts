function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export function buildAlpacaApiPath(
  path: string,
  brokerId?: string | null,
  params?: Record<string, string | number | undefined | null>,
) {
  const normalizedPath = normalizePath(path);
  const search = new URLSearchParams();

  if (brokerId) {
    search.set('brokerId', brokerId);
  }

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}
