import { BadgeSnippet, CodeSnippet } from '../../components/CodeSnippet.tsx';
import { PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { useAdminMonitors } from '../../lib/api.ts';

/** Snippets to show the status on other sites: the notice widget, the frame and per-service badges. */
export function EmbedAdminPage() {
  const monitors = useAdminMonitors();
  const origin = window.location.origin;
  return (
    <>
      <PageHeader
        title="Embed & badges"
        subtitle="Show the status on your website, in a README or a dashboard. Turn embedding off with embed.enabled in status.yaml."
      />
      <Section title="Notice widget">
        <div className="px-3.5 pb-3.5">
          <p className="m-0 mt-2 text-sec">
            A small box in the corner of your site while an incident is open or maintenance is running;
            nothing otherwise. Visitors can dismiss it.
          </p>
          <CodeSnippet
            code={`<script type="module" src="${origin}/widget.js" data-position="bottom-left"></script>`}
          />
          <p className="m-0 mt-2 text-xs text-muted">
            data-position: bottom-left or bottom-right · data-theme: auto, light or dark
          </p>
        </div>
      </Section>
      <Section title="Status frame">
        <div className="px-3.5 pb-3.5">
          <p className="m-0 mt-2 text-sec">The current status and open incidents, in a frame on your page.</p>
          <CodeSnippet
            code={`<iframe src="${origin}/embed" title="Status" style="width:100%;max-width:480px;height:160px;border:0"></iframe>`}
          />
          <p className="m-0 mt-2 text-xs text-muted">
            Add ?theme=light or ?theme=dark to the URL to fix the appearance. Which sites may frame it is set
            with embed.frameAncestors.
          </p>
          <iframe
            src="/embed"
            title="Preview of the status frame"
            className="mt-3 h-40 w-full max-w-[30rem] rounded-lg border-0"
          />
        </div>
      </Section>
      <Section title="Badges">
        {monitors.isPending && <Spinner />}
        {monitors.data?.map((m) => (
          <div key={m.id} className="border-t border-hair px-3.5 py-3 first:border-t-0">
            <div className="font-medium">{m.name}</div>
            <BadgeSnippet id={m.id} name={m.name} version={Boolean(m.spec.software)} />
          </div>
        ))}
      </Section>
    </>
  );
}
