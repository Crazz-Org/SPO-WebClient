# Production Security & Readiness Policy

**Status:** Adopted 2026-07-03 (v1.0) — first formal policy; previously guidance was advisory only (`deployment-security.md` checklist — since removed as superseded — and `DEPLOY.md` Step 9).
**Scope:** the SPO-WebClient gateway's product code — the HTTP/WebSocket/RDO surface it ships. The production-operations half (transport, nginx, the VPS, deploy-time checks) moved to [SPO-Deploy](https://github.com/Crazz-Org/SPO-Deploy)'s `doc/production-security-policy.md` (issue #418); read both files for the full policy. The legacy Delphi game servers are out of scope.
**Enforcement:** items marked *L4* were to be verified by the compliance suite planned in [E2E-STRATEGY.md §3/L4](E2E-STRATEGY.md) — **that suite was never built and the strategy is superseded** ([E2E-POLICY.md](E2E-POLICY.md)); as of 2026-08-22 no CI job runs it, and `ci.yml` runs lint, typecheck, build, `npm audit --omit=dev --audit-level=high` (SEC-D-1) and `npm test`. *L4* therefore means "covered by unit tests where they exist, otherwise manual" until a compliance stage is added to CI or the bench gate. Items marked *manual* are checked at deploy time per [SPO-Deploy's `DEPLOY.md`](https://github.com/Crazz-Org/SPO-Deploy/blob/main/DEPLOY.md). Changing this policy still requires updating the corresponding tests in the same PR.

Normative language: **MUST** = required for production; **SHOULD** = required unless a documented exception exists.

---

## 1. Transport (SEC-T)

Moved to [SPO-Deploy's `doc/production-security-policy.md` §1](https://github.com/Crazz-Org/SPO-Deploy/blob/main/doc/production-security-policy.md) — nginx and the VPS terminate transport, and SPO-Deploy now owns that surface.

## 2. HTTP Layer (SEC-H)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-H-1 | Every HTTP response MUST carry: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. | Met (`server.ts:setSecurityHeaders`) | L4 |
| SEC-H-2 | A CSP of at least `default-src 'self'; script-src 'self'` (+ declared CDN/ws origins) MUST be emitted, and each security header MUST appear **exactly once** end-to-end (the Node app owns headers; nginx adds none). | Met | L4 (duplication check through the proxy path) |
| SEC-H-3 | Request bodies MUST be capped: 512 KB on `/api/debug-log` (413 beyond). The nginx cap (1 MB) is [SPO-Deploy's](https://github.com/Crazz-Org/SPO-Deploy) row. | Met | L4 (app cap) |
| SEC-H-4 | Per-IP rate limits MUST be enforced on auth, `/proxy-image` and `/api/debug-log`, and limiter state MUST be bounded (eviction). **Public-deployment floor:** auth 10/min, `/proxy-image` 60/min. `/api/debug-log` 2 per 60 s (`server.ts:checkRateLimit`). The nginx floor (30 r/s burst 60) is [SPO-Deploy's](https://github.com/Crazz-Org/SPO-Deploy) row and applies at all times. | **Exception [SEC-X-1](#sec-x-1--raised-per-ip-ceilings-for-the-automated-test-phase)** — enforced and bounded (`server.ts:checkRateLimit`), but auth and `/proxy-image` stand at **1000/min** since 2026-08-22 (`server.ts:RATE_LIMIT_MAX_AUTH, RATE_LIMIT_MAX_PROXY`), not the floor. | L4 (429 probes) |
| SEC-H-5 | All filesystem-derived routes (`/api/map-data`, `/cache/*`, `/cdn/*`, terrain/classes) MUST reject path traversal (`..`, `/`, `\`, `%00`, encoded variants) and MUST verify the resolved path stays inside the base directory. | Met | L4 (probe set) + L0 predicate tests |
| SEC-H-6 | `/proxy-image` MUST reject non-http(s) schemes and private/link-local targets (127/8, 10/8, 172.16-31, 192.168/16, 169.254/16, IPv6 loopback/link-local/ULA). The hostname string check is backed by a DNS-resolution check (`resolvesToPublicAddress`, `src/server/proxy-image.ts`) before the game-server fallback fetch. | Met | L4 (probe set) |
| SEC-H-7 | Client IP MUST be derived from `X-Forwarded-For` **only** when `TRUST_PROXY=true`. | Met (`server.ts:TRUST_PROXY, getClientIp`) | L4 |

## 3. WebSocket Layer (SEC-W)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-W-1 | WS upgrades MUST validate `Origin` against the allow-list; missing or foreign origins → 403 (except `SINGLE_USER_MODE`). | Met (`server.ts:verifyClient`) | L4 |
| SEC-W-2 | WS frames MUST be capped at 64 KB (`maxPayload`). | Met | L4 |
| SEC-W-3 | Per-IP concurrent WS connections MUST be capped → 429. **Public-deployment floor: 5.** A **global** session cap SHOULD be added to bound aggregate gateway→Delphi load (risk B4). | Partial (per-IP only), **exception [SEC-X-1](#sec-x-1--raised-per-ip-ceilings-for-the-automated-test-phase)** — the per-IP cap stands at **1000** since 2026-08-22 (`server.ts:WS_MAX_CONNECTIONS_PER_IP`), not 5; no global cap. | L4 (per-IP now; global when implemented) |
| SEC-W-4 | Messages MUST be gated by session phase (`PHASE_ALLOWED_MESSAGES`): gameplay messages before auth → `ERROR_AccessDenied`; unknown message types MUST be rejected. | Met (`server.ts:PHASE_ALLOWED_MESSAGES`) | L4 |
| SEC-W-5 | Auth-bearing messages (`REQ_AUTH_CHECK`, `REQ_CONNECT_DIRECTORY`, `REQ_LOGIN_WORLD`) MUST be rate-limited per IP. | Met | L4 |

## 4. Gateway → Game-Server Conduct (SEC-G)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-G-2 | RDO lanes MUST stay serialized per session (prevents concurrent access to Delphi temp objects). | Met (`server.ts:rdoQueue`) | L1 harness |
| SEC-G-3 | Reconnection MUST remain bounded (3 fast + 20 slow) with jitter, close-triggered only; ServerBusy polling MUST never trigger reconnect; timeouts MUST never close sockets. (Protects the Delphi login lock — risk B1.) | Met (Tier 4) | L1 (`world-reconnect`, `server-busy-reconnect`, `timeout-state-machine`) |
| SEC-G-4 | Outbound HTTP calls to legacy ASP endpoints MUST have timeouts (risk C8). | Met (`server/fetch-with-timeout.ts`, default `TIMEOUTS.FETCH` from `shared/constants.ts`) | L0 (`server/fetch-with-timeout.test.ts` — deadline test) |

## 5. Secrets & Logging (SEC-L)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-L-1 | Passwords MUST never be written to any log; RDO wire logs MUST redact `RDOLogonUser`/`Logon`/`AccountStatus`/`RDOLogonClient` arguments. Passwords are held in memory only and cleared at session end. | Met (`SENSITIVE_MEMBERS` / `redactRdoRaw` and `destroy()` in `spo_session.ts`) | L4 (log-scan after real login attempt) |
| SEC-L-2 | Production MUST run `LOG_LEVEL=info` or stricter — never `debug` (session IDs leak at debug). This supersedes the older `warn` recommendation; `info` is the policy floor and the `.env.example` default. | Met (`shared/config.ts` defaults to `info`; the SEC-R-2 startup check refuses an explicit `debug` in production) | L0 (`server/production-config.test.ts`) |

SEC-L-3 (log rotation/format) and SEC-L-4 (`.env` permissions, `SPO_GM_USERS`) moved to
[SPO-Deploy's `doc/production-security-policy.md`](https://github.com/Crazz-Org/SPO-Deploy/blob/main/doc/production-security-policy.md)
— both are deploy-time operations concerns.

## 6. Runtime & Container (SEC-R)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-R-2 | The server MUST validate its production configuration at startup and **fail fast** on forbidden combinations (at minimum: `NODE_ENV=production` + `LOG_LEVEL=debug`). It MUST log the effective security configuration (headers on, HSTS, trust-proxy, rate limits) once at boot, and warn when `TRUST_PROXY`/`ENABLE_HSTS` are unset in production. | Met (`server/production-config.ts`, called from `server.ts` `startGateway()` before the listen; the record is written with `Logger.always()` so `LOG_LEVEL=warn`/`error` cannot filter it away) | L0 (`server/production-config.test.ts`, `shared/logger-always.test.ts`, `server/__tests__/server-module.test.ts` — boot-failure path, readout and bypass) |

SEC-R-1 (container hardening at deploy time) and SEC-R-3 (the deploy health gate) moved to
[SPO-Deploy's `doc/production-security-policy.md`](https://github.com/Crazz-Org/SPO-Deploy/blob/main/doc/production-security-policy.md)
— the code-side ceilings they reference (Dockerfile, HEALTHCHECK) stay here; the gate that
enforces them at deploy time is SPO-Deploy's.

## 7. Dependencies & Supply Chain (SEC-D)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-D-1 | `npm audit --omit=dev --audit-level=high` MUST pass in CI on every PR; high/critical findings block merge (or carry a written, dated exception in this file). | **Enforced** (2026-08-22, `ci.yml` step *Audit production dependencies*) | CI `typecheck + tests` job |
| SEC-D-2 | Lockfile (`package-lock.json`) MUST be committed; CI MUST use `npm ci`. | Met | CI |

## 8. Network Etiquette Toward Live Servers (SEC-N)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-N-1 | Automated tests MUST NOT target the live Delphi servers except the L3 smoke procedure (single locked account, read-only, manual cadence). | Policy (new) | process + CI has no live target |
| SEC-N-2 | The L3 smoke MUST perform no destructive/in-game-mutating actions and MUST log off cleanly (`get Logoff` form). | Met by procedure | L3 playbook |
| SEC-N-3 | Load, soak, reconnect-storm, and fuzz testing MUST run only against the mock backend. | Policy (new) | process |

---

## 9. Compliance Gate & Exceptions

- The **L4 compliance suite is the machine-readable form of this policy.** A PR that makes L4 fail is a policy violation and MUST NOT merge.
- Items marked **Missing — required work** (global cap of SEC-W-3) are the remaining remediation backlog; each fix ships with its test. SEC-D-1 landed 2026-08-22 (CI audit step); SEC-R-2 landed 2026-08-25 (`server/production-config.ts`); SEC-G-4 landed 2026-08-29 (`server/fetch-with-timeout.ts`).
- Exceptions: documented here, with owner, rationale, and expiry condition. Current exceptions: **SEC-X-1**, below.
- Review cadence: re-audit this policy whenever the deployment topology changes (new public endpoint, new proxy layer, new distribution channel) and at least once per release cycle.

### SEC-X-1 — raised per-IP ceilings for the automated test phase

| | |
|---|---|
| **Rows** | SEC-H-4 (auth, `/proxy-image`), SEC-W-3 (per-IP WS connections) |
| **Raised** | 2026-08-22, developer decision |
| **In force** | auth **1000/min**, `/proxy-image` **1000/min** (`server.ts:RATE_LIMIT_MAX_AUTH, RATE_LIMIT_MAX_PROXY`); per-IP WS connections **1000** (`server.ts:WS_MAX_CONNECTIONS_PER_IP`). nginx is unchanged at 30 r/s burst 60 — 1800/min (SPO-Deploy's `config/nginx/spo-webclient.conf`), so the app ceiling is the tighter of the two. The limits were **raised, not removed**. |
| **Rationale** | the bench worker drives real live traffic from a single IP and the gate serializes it; at the policy floor the project's own gate runs would 429 themselves. The Delphi servers hold this load without trouble. |
| **Owner** | the maintainer |
| **Expiry** | **the first public deployment** — a condition, not a date. Before the gateway serves any traffic that is not the bench, the ceilings MUST be restored to the SEC-H-4 / SEC-W-3 floors: auth 10/min, `/proxy-image` 60/min, WS 5 per IP. |
| **Raised at the right moment by** | [SPO-Deploy's `DEPLOY.md` — *Before the first public deployment*](https://github.com/Crazz-Org/SPO-Deploy/blob/main/DEPLOY.md), a required deploy-time check. The source comments at `server.ts:RATE_LIMIT_MAX_AUTH` and `server.ts:WS_MAX_CONNECTIONS_PER_IP` point back here; a comment alone is not a mechanism. SEC-R-2's boot log of the effective security configuration is the second, automatic reminder: it prints both ceilings at every boot (#212, landed 2026-08-25). |

**Not an invitation to revert.** The raise is dated, reasoned and owned. What this entry fixes is that the policy previously recorded the *floor* as **Met** while the code enforced something a hundred times looser, so the document could not answer "what is enforced right now".
