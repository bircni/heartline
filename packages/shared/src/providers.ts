/**
 * Third-party status sources a `provider` monitor can follow. Presets carry the URL; the generic
 * kinds (`statuspage`, `feed`) need one in the monitor spec.
 */
export const PROVIDER_KINDS = ['statuspage', 'google', 'slack', 'm365', 'feed'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderPreset {
  slug: string;
  name: string;
  kind: ProviderKind;
  /** Status page or API base; null when the monitor supplies it (generic kinds, Microsoft 365). */
  url: string | null;
  /** Public status page for people. */
  homepage: string | null;
  /** What `components` filters on for this provider. */
  components: 'components' | 'products' | 'services' | null;
}

const statuspage = (slug: string, name: string, url: string): ProviderPreset => ({
  slug,
  name,
  kind: 'statuspage',
  url,
  homepage: url,
  components: 'components',
});

export const PROVIDERS: readonly ProviderPreset[] = [
  statuspage('atlassian', 'Atlassian', 'https://status.atlassian.com'),
  statuspage('atlassian-jira', 'Jira', 'https://jira-software.status.atlassian.com'),
  statuspage(
    'atlassian-jira-service-management',
    'Jira Service Management',
    'https://jira-service-management.status.atlassian.com',
  ),
  statuspage('atlassian-confluence', 'Confluence', 'https://confluence.status.atlassian.com'),
  statuspage('atlassian-bitbucket', 'Bitbucket', 'https://bitbucket.status.atlassian.com'),
  statuspage('atlassian-trello', 'Trello', 'https://trello.status.atlassian.com'),
  statuspage('atlassian-opsgenie', 'Opsgenie', 'https://opsgenie.status.atlassian.com'),
  statuspage('github', 'GitHub', 'https://www.githubstatus.com'),
  statuspage('cloudflare', 'Cloudflare', 'https://www.cloudflarestatus.com'),
  statuspage('digitalocean', 'DigitalOcean', 'https://status.digitalocean.com'),
  statuspage('discord', 'Discord', 'https://discordstatus.com'),
  statuspage('dropbox', 'Dropbox', 'https://status.dropbox.com'),
  statuspage('netlify', 'Netlify', 'https://www.netlifystatus.com'),
  statuspage('npm', 'npm', 'https://status.npmjs.org'),
  statuspage('sentry', 'Sentry', 'https://status.sentry.io'),
  statuspage('twilio', 'Twilio', 'https://status.twilio.com'),
  statuspage('vercel', 'Vercel', 'https://www.vercel-status.com'),
  statuspage('zoom', 'Zoom', 'https://status.zoom.us'),
  {
    slug: 'google-workspace',
    name: 'Google Workspace',
    kind: 'google',
    url: 'https://www.google.com/appsstatus/dashboard/incidents.json',
    homepage: 'https://www.google.com/appsstatus/dashboard/',
    components: 'products',
  },
  {
    slug: 'google-cloud',
    name: 'Google Cloud',
    kind: 'google',
    url: 'https://status.cloud.google.com/incidents.json',
    homepage: 'https://status.cloud.google.com',
    components: 'products',
  },
  {
    slug: 'slack',
    name: 'Slack',
    kind: 'slack',
    url: 'https://slack-status.com/api/v2.0.0/current',
    homepage: 'https://slack-status.com',
    components: 'services',
  },
  {
    slug: 'm365',
    name: 'Microsoft 365 (your tenant)',
    kind: 'm365',
    url: null,
    homepage: 'https://admin.microsoft.com/#/servicehealth',
    components: 'services',
  },
  {
    slug: 'azure',
    name: 'Microsoft Azure',
    kind: 'feed',
    url: 'https://azure.status.microsoft/en-us/status/feed/',
    homepage: 'https://azure.status.microsoft',
    components: null,
  },
  {
    slug: 'statuspage',
    name: 'Any Atlassian Statuspage',
    kind: 'statuspage',
    url: null,
    homepage: null,
    components: 'components',
  },
  { slug: 'feed', name: 'Any RSS or Atom feed', kind: 'feed', url: null, homepage: null, components: null },
];

export function findProvider(slug: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.slug === slug);
}
