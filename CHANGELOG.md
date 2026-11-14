# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-11-14

### Bug Fixes

- Add HTTP(S)_PROXY support for outbound requests (#12)
- **web:** Admin and navigation bugs
- **demo:** Seed raw checks for the whole retention period
- **web:** Overview width, labels and titles

### Build

- **deps:** Bump the minor-and-patch group with 7 updates (#25)

### Features

- **monitors:** Follow third-party status pages with provider monitors (#11)
- **web:** Confirm dialogs, toasts, field errors
- **server:** Audit log and rate limiting
- **web:** Site time zone, history paging, system theme
- Groups as entities
- **incidents:** Component impact, templates, postmortems, markdown
- **maintenance:** Lifecycle, updates, detail page
- **monitors:** Push monitors and inbound webhook
- Subscribers and Atom feed
- **api:** Status API v2
- Embed widget and iframe page
- Links, favicon, titles, meta tags
- **web:** Overview layout switches

## [1.0.1] - 2026-11-10

### Bug Fixes

- **docker:** Apply base image security updates and drop the bundled npm from the runtime image (#10)

## [1.0.0] - 2026-11-10

### Bug Fixes

- Show outages when they happened instead of filling the whole day (#6)

### Build

- **deps:** Bump aquasecurity/trivy-action from 0.35.0 to 0.36.0 (#3)

### CI

- Cut releases with pnpm release and publish GitHub releases from tags (#9)

### Features

- **web:** Use full viewport width and keep day tooltips in view
- Redesign web UI with graphite tokens and heart-trace availability (#1)
- Software inventory with vulnerability tracking, API gaps and deploy hardening (#2)
- **nx-cloud:** Set up nx cloud workspace (#7)
- **web:** One shell for status page and admin, availability graph, date ranges and themes (#8)

### Tests

- **web:** Accept the running version shown twice once a release is published
