import type { VulnerabilityDto } from '@heartline/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UrgencyBadge, VulnCounts, VulnTable } from './Urgency.tsx';

afterEach(cleanup);

const vuln: VulnerabilityDto = {
  id: 'CVE-2025-10001',
  aliases: ['GHSA-7q3m-5x2w-9pr4'],
  summary: 'Remote code execution through repository hooks',
  score: 9.8,
  severity: 'critical',
  vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  kev: true,
  fixedIn: '1.22.3',
  introduced: '0',
  publishedAt: Date.parse('2025-08-01T10:00:00Z'),
  sources: ['osv', 'nvd'],
  urls: {
    osv: 'https://osv.dev/vulnerability/GHSA-7q3m-5x2w-9pr4',
    nvd: 'https://nvd.nist.gov/vuln/detail/CVE-2025-10001',
  },
  references: [],
};

describe('urgency components', () => {
  it('labels levels', () => {
    render(<UrgencyBadge level="critical" score={95} />);
    expect(screen.getByText('Update now')).toBeTruthy();
    expect(screen.getByTitle('Urgency score 95/100')).toBeTruthy();
  });
  it('summarises counts', () => {
    render(<VulnCounts vulns={{ critical: 1, high: 0, medium: 2, low: 0, unknown: 0 }} />);
    expect(screen.getByText(/1 critical/)).toBeTruthy();
    expect(screen.getByText(/2 medium/)).toBeTruthy();
    expect(screen.queryByText(/high/)).toBeNull();
  });
  it('lists vulnerabilities with links, scores and the exploited flag', () => {
    render(<VulnTable vulns={[vuln]} />);
    const link = screen.getByRole('link', { name: 'CVE-2025-10001' });
    expect(link.getAttribute('href')).toBe('https://nvd.nist.gov/vuln/detail/CVE-2025-10001');
    expect(screen.getByText('9.8')).toBeTruthy();
    expect(screen.getByText('exploited')).toBeTruthy();
    expect(screen.getByText('1.22.3')).toBeTruthy();
  });
  it('has an empty state', () => {
    render(<VulnTable vulns={[]} />);
    expect(screen.getByText('No known vulnerabilities')).toBeTruthy();
  });
});
