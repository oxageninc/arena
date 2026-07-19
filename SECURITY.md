# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via GitHub's [**Report a vulnerability**](https://github.com/macanderson/arena/security/advisories/new) button on the repository's Security tab (Security → Advisories → Report a vulnerability). This opens a private channel with the maintainers.

We aim to acknowledge reports within 3 business days and to ship a fix or mitigation for confirmed high-severity issues as quickly as is practical. We'll coordinate a disclosure timeline with you and credit you in the advisory unless you prefer otherwise.

## Scope

Arena runs external agent CLIs and, via the Harbor adapter, untrusted task code inside containers. Reports we especially care about:

- Command/argument injection in the harness or adapters (Arena passes argv arrays and shell-quotes task prompts specifically to avoid this — a bypass is in scope).
- A task or agent escaping the intended workspace/container boundary.
- Secrets (API keys) leaking into logs, transcripts, or committed results.

## Supported versions

This project is pre-1.0; only the latest `main` is supported. Please reproduce against the current `main` before reporting.
