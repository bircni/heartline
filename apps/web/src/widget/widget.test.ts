import { afterEach, describe, expect, it, vi } from 'vitest';

const summary = (incidents: unknown[]) => ({
  page: { name: 'Acme status', url: 'https://status.acme.test' },
  incidents,
  scheduled_maintenances: [],
});

async function load(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
  vi.resetModules();
  await import('./widget.ts');
  // Let the first poll finish.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return document.querySelector('[data-heartline-widget]')?.shadowRoot ?? null;
}

describe('embed widget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('stays hidden while nothing is wrong', async () => {
    expect(await load(summary([]))).toBeNull();
  });

  it('shows the open incident, and hides it once dismissed', async () => {
    const root = await load(
      summary([
        {
          id: 'i1',
          name: 'API errors',
          status: 'investigating',
          impact: 'major',
          updated_at: '2026-11-13T10:00:00.000Z',
          shortlink: 'https://status.acme.test/incidents/i1',
          incident_updates: [{ status: 'investigating', body: 'We are **looking** into it.' }],
        },
      ]),
    );
    expect(root?.querySelector('.title')?.textContent).toBe('API errors');
    expect(root?.querySelector('.text')?.textContent).toBe('We are looking into it.');
    expect(root?.querySelector('a')?.getAttribute('href')).toBe('https://status.acme.test/incidents/i1');
    root!.querySelector<HTMLButtonElement>('.close')!.click();
    expect(document.querySelector('[data-heartline-widget]')).toBeNull();
  });
});
