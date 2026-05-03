import { getCachedRequestSnapshot } from './api';

export type ScreenLoaderRequest<TValue, TMapped = TValue> = {
  key: string;
  path: string;
  load: () => Promise<TValue>;
  map?: (value: TValue) => TMapped;
};

export type ScreenLoaderResult<TData extends Record<string, any>> = {
  data: Partial<TData>;
  updatedAt: number | null;
  hasCachedData: boolean;
};

function getLatestUpdatedAt(paths: string[]) {
  const timestamps = paths
    .map((path) => getCachedRequestSnapshot(path)?.updatedAt ?? 0)
    .filter((value) => value > 0);

  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

export function hydrateScreenData<TData extends Record<string, any>>(
  requests: Array<ScreenLoaderRequest<any, any>>,
): ScreenLoaderResult<TData> {
  const data: Partial<TData> = {};
  let hasCachedData = false;

  for (const request of requests) {
    const snapshot = getCachedRequestSnapshot<any>(request.path);
    if (snapshot?.data !== undefined) {
      hasCachedData = true;
      data[request.key as keyof TData] = request.map
        ? request.map(snapshot.data)
        : snapshot.data;
    }
  }

  return {
    data,
    updatedAt: getLatestUpdatedAt(requests.map((request) => request.path)),
    hasCachedData,
  };
}

export async function loadScreenData<TData extends Record<string, any>>(
  requests: Array<ScreenLoaderRequest<any, any>>,
): Promise<ScreenLoaderResult<TData>> {
  const hydrated = hydrateScreenData<TData>(requests);
  const data: Partial<TData> = { ...hydrated.data };

  await Promise.allSettled(
    requests.map(async (request) => {
      const value = await request.load();
      data[request.key as keyof TData] = request.map ? request.map(value) : value;
    }),
  );

  return {
    data,
    updatedAt: getLatestUpdatedAt(requests.map((request) => request.path)) ?? hydrated.updatedAt,
    hasCachedData: hydrated.hasCachedData,
  };
}
