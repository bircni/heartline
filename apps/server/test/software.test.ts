import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { monitorSpecSchema } from '@heartline/shared';
import { describe, expect, it } from 'vitest';
import { CATALOG, getCatalogEntry } from '../src/software/catalog.ts';
import { cvss3BaseScore, labelToScore, severityFromScore } from '../src/software/cvss.ts';
import { resolveProbe } from '../src/software/probe.ts';
import { parseCycles, resolveCycle } from '../src/software/sources/endoflife.ts';
import { parseKev } from '../src/software/sources/kev.ts';
import { canonicalId, mergeVulns } from '../src/software/sources/merge.ts';
import { cveAffects, parseNvdResponse } from '../src/software/sources/nvd.ts';
import { fixedAfter, matchedRange, parseOsvQuery } from '../src/software/sources/osv.ts';
import { parseReleases, parseTags, pickLatest } from '../src/software/sources/releases.ts';
import { URGENCY_RANK, computeUrgency } from '../src/software/urgency.ts';
import {
  cleanVersion,
  compareVersions,
  extractVersion,
  parseVersion,
  patchesBehind,
  sameCycle,
} from '../src/software/version.ts';

export const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/intel/${name}`, import.meta.url)), 'utf8');

const response = (body: string, headers: Record<string, string> = {}, status = 200) => ({
  status,
  headers: new Headers(headers),
  body,
});

describe('version strings', () => {
  it('cleans prefixes, build metadata and noise', () => {
    expect(cleanVersion('v1.24.3')).toBe('1.24.3');
    expect(cleanVersion('11.0.1+gitea-1.22.0')).toBe('11.0.1');
    expect(cleanVersion('  16.2 (Debian) ')).toBe('16.2');
    expect(cleanVersion('"1.33.2"')).toBe('1.33.2');
  });
  it('parses pre-releases and odd shapes', () => {
    expect(parseVersion('1.24.0-rc1')).toEqual({ parts: [1, 24, 0], pre: ['rc', 1], raw: '1.24.0-rc1' });
    expect(parseVersion('RELEASE.2025-01-20T14-49-07Z').parts).toEqual([2025, 1, 20, 14, 49, 7]);
  });
  it('compares tolerantly', () => {
    const cases: [string, string, number][] = [
      ['1.24', '1.24.0', 0],
      ['v1.24.3', '1.24.10', -1],
      ['1.24.0-rc1', '1.24.0', -1],
      ['1.24.0-rc1', '1.24.0-rc2', -1],
      ['2.0.0', '1.99.99', 1],
      ['1.2.3.4', '1.2.3', 1],
      ['1.22.0+gitea', '1.22.0', 0],
    ];
    for (const [a, b, want] of cases) expect(compareVersions(a, b), `${a} vs ${b}`).toBe(want);
  });
  it('knows cycles and patch distance', () => {
    expect(sameCycle('1.24.3', '1.24')).toBe(true);
    expect(sameCycle('1.24.3', '1.2')).toBe(false);
    expect(sameCycle('16.2', '16')).toBe(true);
    expect(patchesBehind('1.24.3', '1.24.6')).toBe(3);
    expect(patchesBehind('1.24.3', '1.25.0')).toBeNull();
    expect(patchesBehind('1.24.6', '1.24.3')).toBe(0);
  });
  it('extracts from json, headers, regex and objects', () => {
    expect(extractVersion({ json: 'version' }, response('{"version":"1.24.3"}'))).toBe('1.24.3');
    expect(extractVersion({ json: 'data.version' }, response('{"data":{"version":"v2.53.0"}}'))).toBe(
      '2.53.0',
    );
    expect(extractVersion({ json: '' }, response('"1.33.2"'))).toBe('1.33.2');
    expect(extractVersion({ json: '' }, response('{"major":1,"minor":118,"patch":2}'))).toBe('1.118.2');
    expect(extractVersion({ header: 'x-gitea-version' }, response('', { 'X-Gitea-Version': '1.24.3' }))).toBe(
      '1.24.3',
    );
    expect(
      extractVersion({ header: 'server', regex: 'nginx/(\\S+)' }, response('', { server: 'nginx/1.26.2' })),
    ).toBe('1.26.2');
    expect(extractVersion({ regex: 'Version: (\\d+)\\.(\\d+)' }, response('Version: 7.4 build 9'))).toBe(
      '7.4',
    );
    expect(extractVersion({ json: 'version' }, response('not json'))).toBeNull();
    expect(extractVersion({ json: 'nope' }, response('{"version":"1"}'))).toBeNull();
    expect(extractVersion({ regex: 'x(y)' }, response('nothing'))).toBeNull();
  });
});

describe('cvss', () => {
  it('computes v3.1 base scores', () => {
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N')).toBe(4.3);
    expect(cvss3BaseScore('CVSS:3.0/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
    expect(cvss3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeNull();
  });
  it('maps scores and labels to severities', () => {
    expect(severityFromScore(9.8)).toBe('critical');
    expect(severityFromScore(7)).toBe('high');
    expect(severityFromScore(3.9)).toBe('low');
    expect(severityFromScore(null)).toBe('unknown');
    expect(labelToScore('MODERATE')).toBe(5.5);
    expect(labelToScore('nope')).toBeNull();
  });
});

describe('catalog and probes', () => {
  it('has consistent entries', () => {
    const entries = Object.values(CATALOG);
    expect(entries.every((e) => e.name.length > 0)).toBe(true);
    const badCpe = entries.filter((e) => e.cpe && !/^[^:\s]+:[^:\s]+$/.test(e.cpe)).map((e) => e.slug);
    expect(badCpe).toEqual([]);
    const badProbe = entries
      .filter(
        (e) =>
          e.probe &&
          (!e.probe.path.startsWith('/') ||
            !(e.probe.json !== undefined || Boolean(e.probe.header) || Boolean(e.probe.regex))),
      )
      .map((e) => e.slug);
    expect(badProbe).toEqual([]);
    expect(getCatalogEntry('gitea')?.osv?.ecosystem).toBe('Go');
  });
  it('resolves probe modes', () => {
    const http = (software: Record<string, unknown>) =>
      monitorSpecSchema.parse({
        id: 'a',
        name: 'A',
        type: 'http',
        url: 'https://git.example.com/api/healthz',
        software,
      });
    expect(resolveProbe(http({ product: 'gitea' }), getCatalogEntry('gitea'))).toMatchObject({
      mode: 'separate',
      url: 'https://git.example.com/api/v1/version',
      extractor: { json: 'version' },
    });
    expect(
      resolveProbe(http({ product: 'gitea', version: { json: 'version' } }), getCatalogEntry('gitea')),
    ).toMatchObject({
      mode: 'inline',
    });
    expect(resolveProbe(http({ product: 'x', version: { static: '1.0' } }), undefined)).toEqual({
      mode: 'static',
      version: '1.0',
    });
    expect(
      resolveProbe(
        http({ product: 'x', version: { url: 'https://x.example/v', regex: '(\\d+)', headers: { a: 'b' } } }),
        undefined,
      ),
    ).toMatchObject({ mode: 'separate', url: 'https://x.example/v', headers: { a: 'b' } });
    expect(resolveProbe(http({ product: 'unknown-thing' }), undefined)).toMatchObject({ mode: 'none' });
    const plugin = monitorSpecSchema.parse({
      id: 'p',
      name: 'P',
      type: 'plugin',
      plugin: 'x',
      software: { product: 'postgresql' },
    });
    expect(resolveProbe(plugin, getCatalogEntry('postgresql'))).toEqual({ mode: 'plugin' });
  });
  it('rejects tcp monitors without a probe url or static version', () => {
    expect(() =>
      monitorSpecSchema.parse({
        id: 'a',
        name: 'A',
        type: 'tcp',
        host: 'h',
        port: 1,
        software: { product: 'redis' },
      }),
    ).toThrow(/software\.version/);
    expect(() =>
      monitorSpecSchema.parse({
        id: 'a',
        name: 'A',
        type: 'tcp',
        host: 'h',
        port: 1,
        software: { product: 'redis', version: { static: '7.2.4' } },
      }),
    ).not.toThrow();
    expect(() =>
      monitorSpecSchema.parse({
        id: 'a',
        name: 'A',
        type: 'http',
        url: 'https://a',
        software: { product: 'x', version: { regex: '(' } },
      }),
    ).toThrow(/regular expression/);
  });
});

describe('intel parsers', () => {
  const osv = parseOsvQuery(fixture('osv-query-gitea.json'));
  it('parses OSV vulns with scores and ranges', () => {
    expect(osv).toHaveLength(3);
    const [rce, redirect, gitOnly] = osv as [(typeof osv)[0], (typeof osv)[0], (typeof osv)[0]];
    expect(rce.score).toBe(9.8);
    expect(rce.aliases).toEqual(['CVE-2025-10001']);
    expect(rce.ranges).toEqual([{ introduced: '0', fixed: '1.22.3' }]);
    expect(redirect.score).toBe(5.5);
    expect(gitOnly.ranges).toEqual([]);
    expect(gitOnly.unsupportedRangesOnly).toBe(true);
    expect(matchedRange(gitOnly, '1.22.0')).toBeNull();
  });
  it('matches ranges client-side', () => {
    const [rce, redirect] = osv as [(typeof osv)[0], (typeof osv)[0]];
    expect(matchedRange(rce, '1.22.0')).toEqual({ introduced: '0', fixed: '1.22.3' });
    expect(matchedRange(rce, '1.22.3')).toBeNull();
    expect(matchedRange(redirect, '1.19.9')).toBeNull();
    expect(matchedRange(redirect, '1.22.0')).not.toBeNull();
    expect(fixedAfter(rce, '1.22.0')).toBe('1.22.3');
  });
  it('parses NVD and confirms CPE matches', () => {
    const { cves, total } = parseNvdResponse(fixture('nvd-gitea.json'));
    expect(total).toBe(2);
    const [rce, old] = cves as [(typeof cves)[0], (typeof cves)[0]];
    expect(rce).toMatchObject({ id: 'CVE-2025-10001', score: 9.8, severity: 'critical' });
    expect(rce.summary).toMatch(/remote code execution/);
    expect(cveAffects(rce, 'gitea:gitea', '1.22.0')).toEqual({ fixedIn: '1.22.3' });
    expect(cveAffects(rce, 'gitea:gitea', '1.22.3')).toBeNull();
    expect(cveAffects(old, 'gitea:gitea', '1.22.0')).toBeNull();
    expect(cveAffects(rce, 'other:thing', '1.22.0')).toBeNull();
  });
  it('parses endoflife cycles and resolves the running cycle', () => {
    const cycles = parseCycles(fixture('eol-gitea.json'));
    expect(cycles).toHaveLength(3);
    expect(resolveCycle(cycles, '1.22.0')).toMatchObject({
      latest: '1.24.6',
      latestInCycle: '1.22.6',
      eol: '2025-03-01',
    });
    expect(resolveCycle(cycles, '1.24.6')).toMatchObject({ latestInCycle: '1.24.6', eol: 'false' });
    expect(resolveCycle(cycles, '9.9.9')).toMatchObject({ cycle: null, latest: '1.24.6', eol: null });
    expect(resolveCycle(cycles, null).latest).toBe('1.24.6');
  });
  it('parses the KEV feed and its compact form', () => {
    expect(parseKev(fixture('kev.json'))).toEqual(['CVE-2025-10001', 'CVE-2021-44228']);
    expect(parseKev('["CVE-1-1"]')).toEqual(['CVE-1-1']);
  });
  it('merges OSV and NVD by CVE alias', () => {
    const { cves } = parseNvdResponse(fixture('nvd-gitea.json'));
    const [rce, redirect] = osv as [(typeof osv)[0], (typeof osv)[0]];
    const merged = mergeVulns(
      [
        { v: rce, range: { introduced: '0', fixed: '1.22.3' }, fixedIn: '1.22.3' },
        { v: redirect, range: { introduced: '1.20.0', fixed: '1.22.1' }, fixedIn: '1.22.1' },
      ],
      [{ c: cves[0] as (typeof cves)[0], fixedIn: '1.22.3' }],
      new Set(['CVE-2025-10001']),
    );
    expect(merged.map((m) => m.id)).toEqual(['CVE-2025-10001', 'GO-2025-4242']);
    expect(merged[0]).toMatchObject({
      kev: true,
      severity: 'critical',
      sources: ['osv', 'nvd'],
      aliases: ['GHSA-7q3m-5x2w-9pr4'],
      fixedIn: '1.22.3',
    });
    expect(merged[0]?.references).toHaveLength(2);
    expect(canonicalId('GHSA-x', ['cve-2020-12345'])).toBe('CVE-2020-12345');
    expect(canonicalId('GHSA-x', [])).toBe('GHSA-X');
  });
});

describe('release pages', () => {
  it('picks the highest published, non-pre-release tag', () => {
    const entries = parseReleases(fixture('gitea-releases.json'));
    expect(entries).toHaveLength(4);
    expect(pickLatest(entries, false)).toEqual({
      version: '1.4.2',
      url: 'https://git.example.com/nicolas/my-app/releases/tag/v1.4.2',
      publishedAt: Date.parse('2025-10-12T08:00:00Z'),
    });
    expect(pickLatest(entries, true)?.version).toBe('1.5.0-rc1');
    expect(pickLatest([], false)).toBeNull();
  });
  it('falls back to tags and ignores non-version names', () => {
    expect(parseTags(fixture('github-tags.json'))).toEqual(['1.33.2', '1.33.1', 'testing']);
    const fromTags = pickLatest(
      parseTags(fixture('github-tags.json')).map((tag) => ({
        tag,
        url: null,
        publishedAt: null,
        draft: false,
        prerelease: false,
      })),
      true,
    );
    expect(fromTags?.version).toBe('1.33.2');
  });
});

describe('urgency', () => {
  const now = Date.parse('2025-11-05T00:00:00Z');
  const base = {
    version: '1.24.6',
    latest: '1.24.6',
    latestInCycle: '1.24.6',
    cycle: '1.24',
    cycleEol: 'false',
    vulns: [],
    track: true,
    intelAvailable: true,
    probeError: null,
    now,
  };
  it('is none when up to date without vulnerabilities', () => {
    expect(computeUrgency(base)).toEqual({ level: 'none', score: 0, reasons: [] });
  });
  it('is unknown without a version or without data', () => {
    expect(computeUrgency({ ...base, version: null, probeError: 'HTTP 401' })).toMatchObject({
      level: 'unknown',
      reasons: ['version not detected: HTTP 401'],
    });
    const u = computeUrgency({ ...base, version: '1.24.3', intelAvailable: false });
    expect(u.level).toBe('unknown');
    expect(u.reasons[0]).toBe('vulnerability data unavailable');
    expect(u.reasons[1]).toMatch(/3 patch releases behind/);
  });
  it('floors on exploited and critical vulnerabilities', () => {
    const kev = computeUrgency({
      ...base,
      version: '1.22.0',
      vulns: [{ id: 'CVE-2025-10001', score: 9.8, kev: true, fixedIn: '1.22.3' }],
    });
    expect(kev.level).toBe('critical');
    expect(kev.reasons[0]).toBe('CVE-2025-10001 (CVSS 9.8, actively exploited) fixed in 1.22.3');
    const crit = computeUrgency({ ...base, vulns: [{ id: 'X', score: 9.1, kev: false, fixedIn: null }] });
    expect(crit.level).toBe('high');
    expect(crit.reasons[0]).toBe('X (CVSS 9.1) no fix released');
    const high = computeUrgency({ ...base, vulns: [{ id: 'Y', score: 7.5, kev: false, fixedIn: '2' }] });
    expect(high.level).toBe('medium');
    const low = computeUrgency({ ...base, vulns: [{ id: 'Z', score: 3.1, kev: false, fixedIn: '2' }] });
    expect(low.level).toBe('low');
  });
  it('scores end-of-life and being behind', () => {
    const eol = computeUrgency({
      ...base,
      version: '1.22.6',
      cycle: '1.22',
      latestInCycle: '1.22.6',
      cycleEol: '2025-03-01',
    });
    expect(eol.level).toBe('medium');
    expect(eol.reasons).toContain('release cycle 1.22 is end-of-life since 2025-03-01');
    expect(eol.reasons).toContain('newer release cycle available (1.24.6)');
    const soon = computeUrgency({ ...base, cycleEol: '2025-12-01' });
    expect(soon.level).toBe('low');
    expect(soon.reasons[0]).toMatch(/reaches end-of-life on 2025-12-01/);
    const behind = computeUrgency({ ...base, version: '1.24.3' });
    expect(behind).toMatchObject({
      level: 'low',
      score: 12,
      reasons: ['3 patch releases behind (1.24.3 → 1.24.6)'],
    });
    const major = computeUrgency({ ...base, version: '1.23.1', cycle: '1.23', latestInCycle: '1.23.8' });
    expect(major.reasons).toEqual([
      '7 patch releases behind (1.23.1 → 1.23.8)',
      'newer release cycle available (1.24.6)',
    ]);
    const odd = computeUrgency({ ...base, version: '1.23', cycle: '1.23', latestInCycle: '1.23.8' });
    expect(odd.reasons[0]).toBe('behind latest 1.23.8');
    expect(computeUrgency({ ...base, version: '1.25.0' }).reasons).toEqual([
      'ahead of the latest known release (1.24.6)',
    ]);
  });
  it('respects a pinned release cycle', () => {
    const pinned = computeUrgency({
      ...base,
      version: '1.23.8',
      cycle: '1.23',
      latestInCycle: '1.23.8',
      cycleEol: 'false',
      pinnedCycle: '1.23',
    });
    expect(pinned.level).toBe('none');
    expect(pinned.reasons).toEqual(['pinned to release cycle 1.23 (1.24.6 available)']);
    // Only a release page, no cycles: a latest from another cycle is ignored when pinned.
    const onlyLatest = computeUrgency({
      ...base,
      version: '1.23.8',
      cycle: null,
      latestInCycle: null,
      latest: '2.0.0',
      cycleEol: null,
      pinnedCycle: '1.23',
    });
    expect(onlyLatest).toMatchObject({ level: 'none', score: 0 });
    const offPin = computeUrgency({
      ...base,
      version: '1.22.6',
      cycle: '1.22',
      latestInCycle: '1.22.6',
      pinnedCycle: '1.24',
    });
    expect(offPin.reasons).toContain('running 1.22.6, not in the pinned cycle 1.24');
  });
  it('skips vulnerabilities when tracking is off', () => {
    const u = computeUrgency({
      ...base,
      track: false,
      vulns: [{ id: 'X', score: 9.9, kev: true, fixedIn: '1' }],
    });
    expect(u).toEqual({ level: 'none', score: 0, reasons: ['vulnerability tracking disabled'] });
  });
  it('ranks levels', () => {
    expect(URGENCY_RANK.critical).toBeGreaterThan(URGENCY_RANK.high);
    expect(URGENCY_RANK.unknown).toBe(0);
  });
});
