# Changelog

All notable changes to this project will be documented in this file.

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
