import type {
  Impact,
  AdminMonitor,
  AuditEntryDto,
  GroupDto,
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
  TemplateDto,
  UserDto,
} from '@heartline/shared';
import { MutationCache, QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toast } from '../components/Toast.tsx';

export interface FieldIssue {
  /** Dotted path of the field in the request body, e.g. `url` or `expect.status`. */
  path: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  issues: FieldIssue[];
  constructor(status: number, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

/** The message for one field of a failed request, if the server named it. */
export function fieldError(error: unknown, path: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.issues.find((i) => i.path === path)?.message;
}

/** True when every problem of a failed request is shown next to a field, so no summary is needed. */
export function onlyFieldErrors(error: unknown, paths: string[]): boolean {
  return (
    error instanceof ApiError && error.issues.length > 0 && error.issues.every((i) => paths.includes(i.path))
  );
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
      (data as { issues?: FieldIssue[] } | null)?.issues ?? [],
    );
  return data as T;
}

export const queryClient = new QueryClient({
  // Mutations that show no error of their own (deletes, toggles) opt in with `meta: { errorToast: true }`.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.errorToast) toast(error.message, 'bad');
    },
  }),
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
/** The site title from status.yaml, "Status" until it has loaded. */
export const useSiteTitle = () => useBootstrap().data?.site.title ?? 'Status';

export const meQueryOptions = {
  queryKey: ['me'],
  // 204 when signed out, so anonymous visitors do not see 401s in the console.
  queryFn: async () => (await api<Me | undefined>('/api/v1/me')) ?? null,
  refetchInterval: false as const,
};
export const useMe = () => useQuery(meQueryOptions);
/** History range of the overview and service pages: `days` ending with the day `to` (today when unset). */
export type Range = {
  days: number;
  /** Last day (`YYYY-MM-DD`, site time zone); undefined means today. */
  to?: string;
};
/** Query string of a range, shared by the JSON endpoints and the CSV reports. */
export const rangeQuery = ({ days, to }: Range) => `days=${days}${to ? `&to=${to}` : ''}`;

export const useOverview = (range: Range, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['overview', range.days, range.to],
    queryFn: () => api<Overview>(`/api/v1/overview?${rangeQuery(range)}`),
    // Poll faster while services wait for their first checks (fresh start, new monitor).
    refetchInterval: (q) =>
      q.state.data?.groups.some((g) => g.services.some((s) => s.status === 'unknown')) ? 5_000 : 30_000,
  });
/**
 * Services for the sidebar: names and current status. One day of history keeps the request small, it polls
 * less often than the pages, and it starts from any overview already loaded so the list never flashes empty.
 */
export const useNavOverview = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['overview', 1, undefined],
    queryFn: () => api<Overview>('/api/v1/overview?days=1'),
    refetchInterval: 60_000,
    placeholderData: () =>
      queryClient.getQueriesData<Overview>({ queryKey: ['overview'] }).find(([, d]) => d)?.[1],
  });

export const useService = (id: string, range: Range) =>
  useQuery({
    queryKey: ['service', id, range.days, range.to],
    queryFn: () => api<ServiceDetail>(`/api/v1/services/${encodeURIComponent(id)}?${rangeQuery(range)}`),
  });
export const useIncident = (id: string) =>
  useQuery({
    queryKey: ['incident', id],
    queryFn: () => api<Incident>(`/api/v1/incidents/${encodeURIComponent(id)}`),
  });
/** An incident as admins see it, with an unpublished postmortem. */
export const useAdminIncident = (id: string | null) =>
  useQuery({
    enabled: Boolean(id),
    queryKey: ['incidents', 'admin', id],
    queryFn: () => api<Incident>(`/api/v1/admin/incidents/${encodeURIComponent(id as string)}`),
  });
export const useTemplates = (kind?: 'incident' | 'maintenance') =>
  useQuery({
    queryKey: ['admin', 'templates', kind ?? 'all'],
    queryFn: () => api<TemplateDto[]>(`/api/v1/admin/templates${kind ? `?kind=${kind}` : ''}`),
  });
export const useIncidents = (active = false, limit = 100) =>
  useQuery({
    queryKey: ['incidents', active, limit],
    queryFn: () => api<Incident[]>(`/api/v1/incidents?limit=${limit}${active ? '&active=true' : ''}`),
  });
export interface IncidentFilter {
  q?: string;
  impact?: Impact;
  service?: string;
}
const HISTORY_PAGE = 50;
/** Resolved incidents, newest first, a page at a time. */
export const useIncidentHistory = (filter: IncidentFilter) =>
  useInfiniteQuery({
    queryKey: ['incidents', 'history', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ state: 'resolved', limit: String(HISTORY_PAGE) });
      if (pageParam) q.set('before', pageParam);
      if (filter.q) q.set('q', filter.q);
      if (filter.impact) q.set('impact', filter.impact);
      if (filter.service) q.set('service', filter.service);
      return api<Incident[]>(`/api/v1/incidents?${q.toString()}`);
    },
    // Same cursor the server sends in X-Next-Cursor: the last incident of a full page.
    getNextPageParam: (last) => {
      const end = last.at(-1);
      return last.length === HISTORY_PAGE && end ? `${end.createdAt}:${end.id}` : undefined;
    },
  });
export const useMaintenanceWindow = (id: string) =>
  useQuery({
    queryKey: ['maintenance', id],
    queryFn: () => api<Maintenance>(`/api/v1/maintenance/${encodeURIComponent(id)}`),
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
export const useAuditLog = (filter: { entityType?: string }) =>
  useInfiniteQuery({
    queryKey: ['admin', 'audit', filter],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: '100' });
      if (pageParam) q.set('before', String(pageParam));
      if (filter.entityType) q.set('entityType', filter.entityType);
      return api<AuditEntryDto[]>(`/api/v1/admin/audit?${q.toString()}`);
    },
    // A full page means there may be older entries.
    getNextPageParam: (last) => (last.length === 100 ? last.at(-1)?.at : undefined),
  });

export const useGroups = () =>
  useQuery({ queryKey: ['admin', 'groups'], queryFn: () => api<GroupDto[]>('/api/v1/admin/groups') });

export const useUsers = () =>
  useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserDto[]>('/api/v1/admin/users') });

export const useSoftwareInventory = () =>
  useQuery({
    queryKey: ['software'],
    queryFn: () => api<SoftwareInventory>('/api/v1/software'),
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

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { errorToast?: boolean };
  }
}
