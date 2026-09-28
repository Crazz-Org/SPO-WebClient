# Security Policy

## Supported versions

Only the latest published release is supported — see
[the latest release](https://github.com/Crazz-Org/SPO-WebClient/releases/latest) for which
version that is. Every older `v*` tag receives no fixes.

A new release is published on every merge to `main`, so a fix ships as the next release:
update to it rather than expecting a patch to an older tag.

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/Crazz-Org/SPO-WebClient/security/advisories/new).
Please do **not** open a public issue for a vulnerability.

Include: what you observed, how to reproduce it, and the impact you think it has.
Expect a first answer within a week.

## Scope

This client speaks the RDO protocol to third-party Starpeace Online game servers, which are
not operated by this project. Findings that concern those servers are out of scope here —
report them to the server operators.

In scope: the Node.js gateway (WebSocket handling, session management, RDO framing and
parsing), the browser client, and the build and release pipeline.

## Please do not

Probe live game servers, run load or denial-of-service tests against them, or use other
players' accounts. The E2E credentials committed to the project documentation exist for
functional testing only.
