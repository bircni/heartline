import type {
  AdminMonitor,
  ApiTokenDto,
  Bootstrap,
  CatalogEntryDto,
  Incident,
  Maintenance,
  Me,
  NotifierDto,
  Overview,
  PluginDto,
  ServiceDetail,
  SoftwareDetail,
  SoftwareInventory,
  UserDto,
} from '@heartline/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      (data as { error?: string; message?: string } | null)?.error ??
        (data as { message?: string } | null)?.message ??
        `Request failed (${res.status})`,
    );
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

export type { Bootstrap };

export const useBootstrap = () =>
  useQuery({
    queryKey: ['site'],
    queryFn: () => api<Bootstrap>('/api/v1/site'),
    staleTime: Infinity,
    refetchInterval: false,
  });
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    // 204 when signed out, so anonymous visitors do not see 401s in the console.
    queryFn: async () => (await api<Me | undefined>('/api/v1/me')) ?? null,
    refetchInterval: false,
  });
export const useOverview = (days: number) =>
  useQuery({
    queryKey: ['overview', days],
    queryFn: () => api<Overview>(`/api/v1/overview?days=${days}`),
    // Poll faster while services wait for their first checks (fresh start, new monitor).
    refetchInterval: (q) =>
      q.state.data?.groups.some((g) => g.services.some((s) => s.status === 'unknown')) ? 5_000 : 30_000,
  });
export const useService = (id: string, days: number) =>
  useQuery({
    queryKey: ['service', id, days],
    queryFn: () => api<ServiceDetail>(`/api/v1/services/${encodeURIComponent(id)}?days=${days}`),
  });
export const useIncident = (id: string) =>
  useQuery({
    queryKey: ['incident', id],
    queryFn: () => api<Incident>(`/api/v1/incidents/${encodeURIComponent(id)}`),
  });
export const useIncidents = (active = false) =>
  useQuery({
    queryKey: ['incidents', active],
    queryFn: () => api<Incident[]>(`/api/v1/incidents?limit=100${active ? '&active=true' : ''}`),
  });
export const useMaintenance = () =>
  useQuery({ queryKey: ['maintenance'], queryFn: () => api<Maintenance[]>('/api/v1/maintenance') });

export const useAdminMonitors = () =>
  useQuery({ queryKey: ['admin', 'monitors'], queryFn: () => api<AdminMonitor[]>('/api/v1/admin/monitors') });
export const usePlugins = () =>
  useQuery({
    queryKey: ['admin', 'plugins'],
    queryFn: () => api<PluginDto[]>('/api/v1/admin/plugins'),
    refetchInterval: false,
  });
export const useNotifiers = () =>
  useQuery({
    queryKey: ['admin', 'notifiers'],
    queryFn: () => api<NotifierDto[]>('/api/v1/admin/notifiers'),
  });
export const useTokens = (all: boolean) =>
  useQuery({
    queryKey: ['admin', 'tokens', all],
    queryFn: () => api<ApiTokenDto[]>(`/api/v1/admin/tokens${all ? '?all=true' : ''}`),
  });
export const useUsers = () =>
  useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserDto[]>('/api/v1/admin/users') });

export const useSoftwareInventory = (enabled = true) =>
  useQuery({
    queryKey: ['software'],
    queryFn: () => api<SoftwareInventory>('/api/v1/software'),
    enabled,
    retry: false,
  });
/** Full detail incl. vulnerabilities; only for viewers that may see them (the hook stays disabled otherwise). */
export const useServiceSoftware = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['software', id],
    queryFn: () => api<SoftwareDetail>(`/api/v1/services/${encodeURIComponent(id)}/software`),
    enabled,
    retry: false,
  });
export const useCatalog = () =>
  useQuery({
    queryKey: ['admin', 'software', 'catalog'],
    queryFn: () => api<CatalogEntryDto[]>('/api/v1/admin/software/catalog'),
    staleTime: Infinity,
    refetchInterval: false,
  });
