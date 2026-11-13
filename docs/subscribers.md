# Subscribers

Visitors can sign up for status e-mails with the _Subscribe_ button, or follow one incident from its page.
Everyone can also use the Atom and RSS feeds (`/api/v1/incidents.atom`, `/api/v1/incidents.rss`), which
list incidents and maintenance windows with their whole timeline.

```yaml
notifiers:
  - id: mail
    type: email
    from: status@example.com
    to: [ops@example.com]
    smtp: { host: smtp.example.com, port: 587, user: '${SMTP_USER}', password: '${SMTP_PASSWORD}' }

subscribers:
  enabled: true
  email:
    notifier: mail # optional; the first email notifier by default
    ratePerMinute: 60 # most e-mails per minute, for your mail server's limits
  confirmTtl: 48h # how long a confirmation link works
  events: # what subscribers may choose
    incidents: true # incidents posted by people: created, updates, resolved, postmortems
    automaticIncidents: false # incidents opened and resolved by failing checks
    maintenance: true # scheduled, starting soon, started, completed, updates
    componentStatus: false # every status change of a service, also without an incident
```

Subscriber e-mails use the mail server and sender of an `email` notifier. Without one, e-mail sign-up is
off and the button links to the feed.

## How it works

- **Double opt-in.** Signing up sends a confirmation link; nothing else is sent until it is opened and
  confirmed. Signing up with an address that is already subscribed sends a link to manage it instead. The
  answer is the same either way, so the form does not tell who is subscribed.
- **Choices.** Subscribers pick the events (from the ones `events` offers) and all services or some of them.
  Incidents without services and maintenance for all services reach everyone who chose that event.
  Following an incident sends every update of that incident.
- **What is sent.** Manual incidents follow the _Notify_ switch of each update; an incident or update
  written up afterwards (`createdAt` in the past) never sends anything.
- **Links.** Every e-mail links to a page to change the choices or unsubscribe, and carries a one-click
  unsubscribe header for mail clients. The links are signed with `AUTH_SECRET`: changing it invalidates
  all of them, and unsubscribing invalidates the subscriber's earlier links. They work without signing in,
  also on private status pages; signing up there needs a signed-in user.
- **Delivery.** Events go to an outbox in the database. The replica that runs the checks sends them, at
  most `ratePerMinute`, confirmation and manage links first, retrying failures after 1 min, 5 min,
  30 min and 2 h before giving up. Sent and failed e-mails are cleaned up after 30 days.

Admins see subscribers under _Subscribers_ (`GET /api/v1/admin/subscribers`) and can remove them. Sign-ups,
confirmations and unsubscribes are in the audit log. Sign-ups and manage-link requests are limited per
client address (`rateLimit.subscribe`, default 10 per 10 minutes).
