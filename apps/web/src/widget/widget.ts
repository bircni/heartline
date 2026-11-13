/*
 * Status notice for other websites:
 *
 *   <script type="module" src="https://status.example.com/widget.js" data-position="bottom-left"></script>
 *
 * It shows a small box while an incident is open or maintenance is in progress, and nothing otherwise. It
 * reads /api/v2/summary.json of the status page it came from every minute. No dependencies, its own shadow
 * DOM, so it neither affects nor is affected by the host page's styles.
 */

interface SpUpdate {
  body: string;
  status: string;
}
interface SpIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  updated_at: string;
  shortlink: string;
  incident_updates: SpUpdate[];
}
interface Summary {
  page: { name: string; url: string };
  incidents: SpIncident[];
  scheduled_maintenances: SpIncident[];
}

const COLORS: Record<string, string> = {
  critical: '#d93a2b',
  major: '#e8590c',
  minor: '#e0900a',
  none: '#6e7781',
  maintenance: '#2f6fdb',
};

const script =
  document.querySelector<HTMLScriptElement>('script[src*="/widget.js"][data-heartline]') ??
  document.querySelector<HTMLScriptElement>('script[src*="/widget.js"]');
const origin = new URL(import.meta.url).origin;
const position = script?.dataset.position === 'bottom-right' ? 'right' : 'left';
const theme = script?.dataset.theme ?? 'auto';

const host = document.createElement('div');
host.setAttribute('data-heartline-widget', '');
const root = host.attachShadow({ mode: 'open' });
const dark =
  theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
const style = document.createElement('style');
style.textContent = `
:host { all: initial; }
.box { position: fixed; bottom: 16px; ${position}: 16px; z-index: 2147483000; width: min(340px, calc(100vw - 32px));
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: ${dark ? '#1f2124' : '#ffffff'}; color: ${dark ? '#eceef0' : '#1d1f21'};
  border: 1px solid ${dark ? '#34373b' : '#e3e5e8'}; border-left-width: 4px; border-radius: 8px;
  box-shadow: 0 12px 32px rgb(0 0 0 / ${dark ? 0.5 : 0.14}); padding: 10px 12px; }
.title { font-weight: 600; margin: 0 22px 2px 0; }
.text { margin: 0; color: ${dark ? '#b8bcc1' : '#4d5359'}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
a { color: inherit; font-weight: 500; }
.more { display: inline-block; margin-top: 6px; }
.close { position: absolute; top: 6px; right: 6px; border: 0; background: none; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; padding: 4px; opacity: .6; }
.close:hover { opacity: 1; }`;
root.append(style);

const dismissed = (key: string) => {
  try {
    return sessionStorage.getItem(`heartline-dismissed:${key}`) !== null;
  } catch {
    return false;
  }
};
const dismiss = (key: string) => {
  try {
    sessionStorage.setItem(`heartline-dismissed:${key}`, '1');
  } catch {
    /* storage blocked */
  }
};
const plain = (md: string) =>
  md
    .replace(/[*_`#>[\]]/g, '')
    .replace(/\(https?:[^)]*\)/g, '')
    .trim();

function render(s: Summary) {
  root.querySelector('.box')?.remove();
  const items = [
    ...s.incidents.filter((i) => i.status !== 'resolved' && i.status !== 'postmortem'),
    ...s.scheduled_maintenances.filter((m) => m.status === 'in_progress' || m.status === 'verifying'),
  ];
  const item = items.find((i) => !dismissed(`${i.id}:${i.updated_at}`));
  if (!item) {
    host.remove();
    return;
  }
  if (!host.isConnected) document.body.append(host);
  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('role', 'status');
  box.style.borderLeftColor = COLORS[item.impact] ?? '#e0900a';
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = item.impact === 'maintenance' ? `Maintenance: ${item.name}` : item.name;
  const text = document.createElement('p');
  text.className = 'text';
  text.textContent = plain(item.incident_updates[0]?.body ?? '');
  const more = document.createElement('a');
  more.className = 'more';
  more.href = item.shortlink;
  more.target = '_blank';
  more.rel = 'noopener';
  more.textContent = `${s.page.name} →`;
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => {
    dismiss(`${item.id}:${item.updated_at}`);
    render(s);
  });
  box.append(close, title, text, more);
  root.append(box);
}

async function poll() {
  try {
    const res = await fetch(`${origin}/api/v2/summary.json`, { credentials: 'omit' });
    if (res.ok) render((await res.json()) as Summary);
  } catch {
    /* offline or blocked: show nothing */
  }
}

void poll();
setInterval(() => void poll(), 60_000);
