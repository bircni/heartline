import type { CatalogEntryDto } from '@heartline/shared';

export interface CatalogProbe {
  /** Resolved against the monitor URL. */
  path: string;
  json?: string;
  header?: string;
  regex?: string;
  auth: 'none' | 'bearer' | 'api-key';
  note?: string;
}

export interface CatalogEntry {
  slug: string;
  name: string;
  /** endoflife.date product slug; null when the product is not listed there. */
  endoflife: string | null;
  /** `vendor:product` for NVD CPE matching. */
  cpe: string | null;
  osv: { ecosystem: string; name: string } | null;
  probe: CatalogProbe | null;
  /** GitHub `owner/repo`; its releases supply the latest version when endoflife.date has no entry. */
  github: string | null;
  releasesUrl: string | null;
}

interface EntryInput {
  name: string;
  endoflife?: string;
  cpe?: string;
  osv?: { ecosystem: string; name: string };
  probe?: CatalogProbe;
  github?: string;
  releasesUrl?: string;
}

const entries: Record<string, EntryInput> = {
  gitea: {
    name: 'Gitea',
    endoflife: 'gitea',
    cpe: 'gitea:gitea',
    osv: { ecosystem: 'Go', name: 'github.com/go-gitea/gitea' },
    probe: { path: '/api/v1/version', json: 'version', auth: 'none' },
    github: 'go-gitea/gitea',
    releasesUrl: 'https://github.com/go-gitea/gitea/releases',
  },
  forgejo: {
    name: 'Forgejo',
    endoflife: 'forgejo',
    cpe: 'forgejo:forgejo',
    osv: { ecosystem: 'Go', name: 'codeberg.org/forgejo/forgejo' },
    probe: { path: '/api/v1/version', json: 'version', auth: 'none' },
    releasesUrl: 'https://codeberg.org/forgejo/forgejo/releases',
  },
  nextcloud: {
    name: 'Nextcloud',
    endoflife: 'nextcloud',
    cpe: 'nextcloud:nextcloud_server',
    osv: { ecosystem: 'Packagist', name: 'nextcloud/server' },
    probe: { path: '/status.php', json: 'versionstring', auth: 'none' },
    github: 'nextcloud/server',
    releasesUrl: 'https://github.com/nextcloud/server/releases',
  },
  grafana: {
    name: 'Grafana',
    endoflife: 'grafana',
    cpe: 'grafana:grafana',
    osv: { ecosystem: 'Go', name: 'github.com/grafana/grafana' },
    probe: { path: '/api/health', json: 'version', auth: 'none' },
    github: 'grafana/grafana',
    releasesUrl: 'https://github.com/grafana/grafana/releases',
  },
  prometheus: {
    name: 'Prometheus',
    endoflife: 'prometheus',
    cpe: 'prometheus:prometheus',
    osv: { ecosystem: 'Go', name: 'github.com/prometheus/prometheus' },
    probe: { path: '/api/v1/status/buildinfo', json: 'data.version', auth: 'none' },
    github: 'prometheus/prometheus',
    releasesUrl: 'https://github.com/prometheus/prometheus/releases',
  },
  immich: {
    name: 'Immich',
    endoflife: 'immich',
    cpe: 'immich:immich',
    probe: { path: '/api/server/version', json: '', auth: 'none' },
    github: 'immich-app/immich',
    releasesUrl: 'https://github.com/immich-app/immich/releases',
  },
  vaultwarden: {
    name: 'Vaultwarden',
    cpe: 'vaultwarden:vaultwarden',
    probe: { path: '/api/version', json: '', auth: 'none' },
    github: 'dani-garcia/vaultwarden',
    releasesUrl: 'https://github.com/dani-garcia/vaultwarden/releases',
  },
  'home-assistant': {
    name: 'Home Assistant',
    endoflife: 'home-assistant',
    cpe: 'home-assistant:home-assistant',
    osv: { ecosystem: 'PyPI', name: 'homeassistant' },
    probe: {
      path: '/api/config',
      json: 'version',
      auth: 'bearer',
      note: 'needs a long-lived access token in software.version.headers.Authorization',
    },
    github: 'home-assistant/core',
    releasesUrl: 'https://github.com/home-assistant/core/releases',
  },
  jellyfin: {
    name: 'Jellyfin',
    endoflife: 'jellyfin',
    cpe: 'jellyfin:jellyfin',
    probe: { path: '/System/Info/Public', json: 'Version', auth: 'none' },
    github: 'jellyfin/jellyfin',
    releasesUrl: 'https://github.com/jellyfin/jellyfin/releases',
  },
  traefik: {
    name: 'Traefik',
    endoflife: 'traefik',
    cpe: 'traefik:traefik',
    osv: { ecosystem: 'Go', name: 'github.com/traefik/traefik/v3' },
    probe: { path: '/api/version', json: 'Version', auth: 'none', note: 'the API must be enabled' },
    github: 'traefik/traefik',
    releasesUrl: 'https://github.com/traefik/traefik/releases',
  },
  keycloak: {
    name: 'Keycloak',
    endoflife: 'keycloak',
    cpe: 'redhat:keycloak',
    probe: { path: '/admin/serverinfo', json: 'systemInfo.version', auth: 'bearer' },
    github: 'keycloak/keycloak',
    releasesUrl: 'https://github.com/keycloak/keycloak/releases',
  },
  minio: {
    name: 'MinIO',
    cpe: 'minio:minio',
    osv: { ecosystem: 'Go', name: 'github.com/minio/minio' },
    probe: { path: '/minio/health/live', header: 'server', regex: 'MinIO/(RELEASE\\.[\\w-]+)', auth: 'none' },
    github: 'minio/minio',
    releasesUrl: 'https://github.com/minio/minio/releases',
  },
  portainer: {
    name: 'Portainer',
    cpe: 'portainer:portainer',
    osv: { ecosystem: 'Go', name: 'github.com/portainer/portainer' },
    probe: { path: '/api/status', json: 'Version', auth: 'none' },
    github: 'portainer/portainer',
    releasesUrl: 'https://github.com/portainer/portainer/releases',
  },
  'proxmox-ve': {
    name: 'Proxmox VE',
    endoflife: 'proxmox-ve',
    cpe: 'proxmox:virtual_environment',
    probe: {
      path: '/api2/json/version',
      json: 'data.version',
      auth: 'api-key',
      note: 'Authorization: PVEAPIToken=user@realm!token=secret',
    },
    releasesUrl: 'https://pve.proxmox.com/wiki/Roadmap',
  },
  'pi-hole': {
    name: 'Pi-hole',
    endoflife: 'pi-hole',
    cpe: 'pi-hole:pi-hole',
    probe: { path: '/api/info/version', json: 'version.core.local.version', auth: 'api-key' },
    github: 'pi-hole/pi-hole',
    releasesUrl: 'https://github.com/pi-hole/pi-hole/releases',
  },
  'paperless-ngx': {
    name: 'Paperless-ngx',
    cpe: 'paperless-ngx:paperless-ngx',
    probe: { path: '/api/', header: 'x-version', auth: 'api-key' },
    github: 'paperless-ngx/paperless-ngx',
    releasesUrl: 'https://github.com/paperless-ngx/paperless-ngx/releases',
  },
  synapse: {
    name: 'Synapse',
    endoflife: 'synapse',
    cpe: 'matrix:synapse',
    osv: { ecosystem: 'PyPI', name: 'matrix-synapse' },
    probe: { path: '/_matrix/federation/v1/version', json: 'server.version', auth: 'none' },
    github: 'element-hq/synapse',
    releasesUrl: 'https://github.com/element-hq/synapse/releases',
  },
  mastodon: {
    name: 'Mastodon',
    endoflife: 'mastodon',
    cpe: 'joinmastodon:mastodon',
    probe: { path: '/api/v2/instance', json: 'version', auth: 'none' },
    github: 'mastodon/mastodon',
    releasesUrl: 'https://github.com/mastodon/mastodon/releases',
  },
  gotify: {
    name: 'Gotify',
    cpe: 'gotify:server',
    osv: { ecosystem: 'Go', name: 'github.com/gotify/server/v2' },
    probe: { path: '/version', json: 'version', auth: 'none' },
    github: 'gotify/server',
    releasesUrl: 'https://github.com/gotify/server/releases',
  },
  miniflux: {
    name: 'Miniflux',
    cpe: 'miniflux:miniflux',
    osv: { ecosystem: 'Go', name: 'miniflux.app/v2' },
    probe: { path: '/version', regex: '(\\d+\\.\\d+\\.\\d+)', auth: 'none' },
    github: 'miniflux/v2',
    releasesUrl: 'https://github.com/miniflux/v2/releases',
  },
  authentik: {
    name: 'authentik',
    endoflife: 'authentik',
    cpe: 'goauthentik:authentik',
    probe: { path: '/api/v3/admin/version/', json: 'version_current', auth: 'bearer' },
    github: 'goauthentik/authentik',
    releasesUrl: 'https://github.com/goauthentik/authentik/releases',
  },
  sonarr: {
    name: 'Sonarr',
    endoflife: 'sonarr',
    cpe: 'sonarr:sonarr',
    probe: { path: '/api/v3/system/status', json: 'version', auth: 'api-key', note: 'X-Api-Key header' },
    github: 'Sonarr/Sonarr',
    releasesUrl: 'https://github.com/Sonarr/Sonarr/releases',
  },
  radarr: {
    name: 'Radarr',
    endoflife: 'radarr',
    cpe: 'radarr:radarr',
    probe: { path: '/api/v3/system/status', json: 'version', auth: 'api-key', note: 'X-Api-Key header' },
    github: 'Radarr/Radarr',
    releasesUrl: 'https://github.com/Radarr/Radarr/releases',
  },
  kubernetes: {
    name: 'Kubernetes',
    endoflife: 'kubernetes',
    cpe: 'kubernetes:kubernetes',
    osv: { ecosystem: 'Go', name: 'k8s.io/kubernetes' },
    probe: { path: '/version', json: 'gitVersion', auth: 'bearer' },
    releasesUrl: 'https://kubernetes.io/releases/',
  },
  docker: {
    name: 'Docker Engine',
    endoflife: 'docker-engine',
    cpe: 'docker:docker',
    osv: { ecosystem: 'Go', name: 'github.com/moby/moby' },
    probe: { path: '/version', json: 'Version', auth: 'none', note: 'only when the engine API is exposed' },
    releasesUrl: 'https://docs.docker.com/engine/release-notes/',
  },
  nginx: {
    name: 'nginx',
    endoflife: 'nginx',
    cpe: 'f5:nginx',
    probe: {
      path: '/',
      header: 'server',
      regex: 'nginx/(\\S+)',
      auth: 'none',
      note: 'needs server_tokens on',
    },
    releasesUrl: 'https://nginx.org/en/CHANGES',
  },
  caddy: {
    name: 'Caddy',
    endoflife: 'caddy',
    cpe: 'caddyserver:caddy',
    osv: { ecosystem: 'Go', name: 'github.com/caddyserver/caddy/v2' },
    github: 'caddyserver/caddy',
    releasesUrl: 'https://github.com/caddyserver/caddy/releases',
  },
  'uptime-kuma': {
    name: 'Uptime Kuma',
    cpe: 'uptime-kuma:uptime-kuma',
    github: 'louislam/uptime-kuma',
    releasesUrl: 'https://github.com/louislam/uptime-kuma/releases',
  },
  postgresql: {
    name: 'PostgreSQL',
    endoflife: 'postgresql',
    cpe: 'postgresql:postgresql',
    releasesUrl: 'https://www.postgresql.org/docs/release/',
  },
  mariadb: {
    name: 'MariaDB',
    endoflife: 'mariadb',
    cpe: 'mariadb:mariadb',
    releasesUrl: 'https://mariadb.org/download/',
  },
  redis: {
    name: 'Redis',
    endoflife: 'redis',
    cpe: 'redis:redis',
    github: 'redis/redis',
    releasesUrl: 'https://github.com/redis/redis/releases',
  },
  valkey: {
    name: 'Valkey',
    endoflife: 'valkey',
    cpe: 'valkey:valkey',
    github: 'valkey-io/valkey',
    releasesUrl: 'https://github.com/valkey-io/valkey/releases',
  },
  nodejs: {
    name: 'Node.js',
    endoflife: 'nodejs',
    cpe: 'nodejs:node.js',
    releasesUrl: 'https://nodejs.org/en/about/previous-releases',
  },
  heartline: {
    name: 'heartline',
    probe: { path: '/api/v1/version', json: 'version', auth: 'none' },
    github: 'bircni/heartline',
    releasesUrl: 'https://github.com/bircni/heartline/releases',
  },
};

export const CATALOG: Record<string, CatalogEntry> = Object.fromEntries(
  Object.entries(entries).map(([slug, e]) => [
    slug,
    {
      slug,
      name: e.name,
      endoflife: e.endoflife ?? null,
      cpe: e.cpe ?? null,
      osv: e.osv ?? null,
      probe: e.probe ?? null,
      github: e.github ?? null,
      releasesUrl: e.releasesUrl ?? null,
    },
  ]),
);

export function getCatalogEntry(slug: string): CatalogEntry | undefined {
  return CATALOG[slug];
}

export function listCatalog(): CatalogEntryDto[] {
  return Object.values(CATALOG)
    .map((e) => ({ ...e, probe: e.probe ? { ...e.probe } : null }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
