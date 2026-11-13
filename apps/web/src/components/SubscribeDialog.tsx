import { useState } from 'react';
import { useBootstrap } from '../lib/api.ts';
import { CodeSnippet } from './CodeSnippet.tsx';
import { Dialog } from './Dialog.tsx';
import { Icon } from './Icon.tsx';
import { Segmented } from './Segmented.tsx';
import { SubscribeForm } from './SubscribeForm.tsx';

/** "Subscribe to updates": e-mail sign-up and the feeds, in tabs. */
export function SubscribeDialogButton() {
  const boot = useBootstrap();
  const email = Boolean(boot.data?.subscribe.enabled && boot.data.subscribe.email);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'email' | 'feed'>(email ? 'email' : 'feed');
  const origin = window.location.origin;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon name="bell" size={14} /> Subscribe
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Subscribe to updates">
        {email && (
          <div className="mt-3">
            <Segmented
              size="sm"
              label="How"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'email', label: 'E-mail' },
                { value: 'feed', label: 'Atom / RSS' },
              ]}
            />
          </div>
        )}
        <div className="mt-3">
          {tab === 'email' && email ? (
            <SubscribeForm />
          ) : (
            <>
              <p className="m-0 text-sec">Add a feed to your reader to follow incidents and maintenance.</p>
              <CodeSnippet label="Atom" code={`${origin}/api/v1/incidents.atom`} />
              <CodeSnippet label="RSS" code={`${origin}/api/v1/incidents.rss`} />
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </Dialog>
    </>
  );
}
