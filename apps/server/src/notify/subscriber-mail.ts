import { renderMarkdown } from '@heartline/shared';

export interface Mail {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(site: string, heading: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1f21">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:24px">
<div style="font-size:13px;color:#5b6168">${escapeHtml(site)}</div>
<h1 style="margin:4px 0 16px;font-size:18px">${escapeHtml(heading)}</h1>
<div style="font-size:14px;line-height:1.5">${bodyHtml}</div>
</div>
<div style="max-width:560px;margin:12px auto 0;font-size:12px;color:#5b6168">${footerHtml}</div>
</body></html>`;
}

/** Confirmation of a new subscription (double opt-in). */
export function confirmMail(site: string, link: string, ttlHours: number): Mail {
  const text = `Please confirm that you want e-mails about the status of ${site}:\n\n${link}\n\nThe link works for ${ttlHours} hours. If you did not ask for this, ignore this e-mail.`;
  return {
    subject: `Confirm your subscription to ${site}`,
    text,
    html: layout(
      site,
      'Confirm your subscription',
      `<p>Please confirm that you want e-mails about the status of ${escapeHtml(site)}.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1d1f21;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Confirm subscription</a></p><p style="color:#5b6168">The link works for ${ttlHours} hours. If you did not ask for this, ignore this e-mail.</p>`,
      '',
    ),
    headers: {},
  };
}

/** Sent instead of a confirmation when the address is already subscribed, or on request. */
export function manageMail(site: string, link: string): Mail {
  return {
    subject: `Your subscription to ${site}`,
    text: `Change what you hear about, or unsubscribe:\n\n${link}`,
    html: layout(
      site,
      'Your subscription',
      `<p>You are subscribed to status e-mails of ${escapeHtml(site)}.</p><p><a href="${escapeHtml(link)}">Change what you hear about, or unsubscribe</a></p>`,
      '',
    ),
    headers: {},
  };
}

/** A notification: an incident update, maintenance, or a service changing status. */
export function eventMail(
  site: string,
  msg: { subject: string; body: string; url: string; when: string },
  links: { manage: string; unsubscribe: string; oneClick: string },
): Mail {
  const footerText = `\n\n--\nManage your subscription: ${links.manage}\nUnsubscribe: ${links.unsubscribe}`;
  return {
    subject: msg.subject,
    text: `${msg.body}\n\n${msg.when}\n${msg.url}${footerText}`,
    html: layout(
      site,
      msg.subject,
      `${renderMarkdown(msg.body)}<p style="color:#5b6168">${escapeHtml(msg.when)}</p><p><a href="${escapeHtml(msg.url)}">View on the status page</a></p>`,
      `<a href="${escapeHtml(links.manage)}" style="color:#5b6168">Manage your subscription</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#5b6168">Unsubscribe</a>`,
    ),
    // RFC 8058 one-click unsubscribe, for mail clients' own unsubscribe button.
    headers: {
      'List-Unsubscribe': `<${links.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
