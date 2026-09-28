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
| SEC-H-2 | The CSP MUST be exactly `default-src 'self'; connect-src 'self' ws://<Host> wss://<Host>[ <CDN>]; img-src 'self' data: blob:[ <CDN>]; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` — the ws origins only when the Host header matches `^[A-Za-z0-9.-]+(:[0-9]{1,5})?$` — and each security header MUST appear **exactly once** end-to-end (the Node app owns headers; nginx adds none). | Met (`security-headers.ts`: `buildContentSecurityPolicy`) | L0 (`src/server/security-headers.test.ts`) + L4 (duplication check through the proxy path) |
| SEC-H-3 | Request bodies MUST be capped: 512 KB on `/api/debug-log`, 8 KiB on `/api/client-error` (413 beyond), 4 MB on `/api/bug-report` (413 beyond). The nginx cap (1 MB) is [SPO-Deploy's](https://github.com/Crazz-Org/SPO-Deploy) row. | Met | L4 (app cap) |
| SEC-H-4 | Per-IP rate limits MUST be enforced on auth, `/proxy-image`, `/api/debug-log` and `/api/client-error`, and limiter state MUST be bounded (eviction). **Floor:** auth 10/min, counted per auth-bearing message type (SEC-W-5), `/proxy-image` 60/min. `/api/debug-log` 2 per 60 s (`server/rate-limit.ts:checkRateLimit`). `/api/client-error` 20/min per IP plus 60 accepted/min gateway-wide (`server/client-error-endpoint.ts`: `CLIENT_ERROR_MAX_PER_IP`, `CLIENT_ERROR_MAX_PER_MINUTE`). `/api/bug-report` 10 per 60 s per IP, plus `MAX_REPORTS_PER_SESSION` (5) per logged-in session (`server/bug-report-tickets.ts`) and a queue cap of 100 files / 100 MiB (503, `server/bug-report-endpoint.ts`). The nginx floor (30 r/s burst 60) is [SPO-Deploy's](https://github.com/Crazz-Org/SPO-Deploy) row and applies at all times. | **Met** — auth **10/min** per auth-bearing message type and `/proxy-image` **60/min**, enforced and bounded in `server/rate-limit.ts:checkRateLimit` (`RATE_LIMIT_MAX_AUTH, RATE_LIMIT_MAX_PROXY`), pinned by `server/rate-limit.test.ts`. `/api/client-error` **20/min** per IP and **60/min** gateway-wide, enforced in `server/client-error-endpoint.ts` and pinned by `server/client-error-endpoint.test.ts`. | L4 (429 probes) |
| SEC-H-5 | All filesystem-derived routes (`/api/map-data`, `/cache/*`, `/cdn/*`, terrain/classes) MUST reject path traversal (`..`, `/`, `\`, `%00`, encoded variants) and MUST verify the resolved path stays inside the base directory. | Met | L4 (probe set) + L0 predicate tests |
| SEC-H-6 | `/proxy-image` MUST reject non-http(s) schemes and MUST fetch only hosts the gateway itself learned from a trusted server: the current world's `WorldInfo.ip` (directory server) and `DAAddr` (Interface Server). Every other host — including every loopback, private and link-local literal in any encoding — answers 403 before the cache lookup or any fetch; the comparison is on the canonical `new URL().hostname`. Redirects MUST NOT be followed (`redirect: 'manual'`), and a caller-supplied name is never resolved. | **Met** — `proxyImageHosts` / `registerProxyImageHost` in `server/proxy-image.ts`, fed by `setCurrentWorldInfo` / `setDaAddr` in `server/spo_session.ts`, pinned by `server/proxy-image.test.ts` and `server/__tests__/spo-session-surface.test.ts`. | L4 (probe set) |
| SEC-H-7 | When `TRUST_PROXY=true`, the client IP MUST be the **rightmost** `X-Forwarded-For` entry — the address our single trusted nginx appended (`$proxy_add_x_forwarded_for`); entries to its left are client-supplied and MUST NOT be used. Otherwise (flag off, or header missing/empty) it is the socket peer address. Assumes exactly one trusted proxy: a CDN or load balancer in front of nginx needs nginx's realip module (`set_real_ip_from` + `real_ip_header X-Forwarded-For`), not a gateway change. | Met (`server/client-ip.ts:resolveClientIp`) | L0 (`server/client-ip.test.ts`, `server/__tests__/client-ip-trust-proxy.test.ts`) |

## 3. WebSocket Layer (SEC-W)

| ID | Requirement | Status | Enforcement |
|---|---|---|---|
| SEC-W-1 | WS upgrades MUST validate `Origin` against the allow-list; missing or foreign origins → 403 (except `SINGLE_USER_MODE`). `SINGLE_USER_MODE` is refused when `NODE_ENV=production` (SEC-R-2 check). | Met (`server.ts:verifyClient`; the production refusal in `server/production-config.ts`) | L4 |
| SEC-W-2 | WS frames MUST be capped at 64 KB (`maxPayload`). | Met | L4 |
| SEC-W-3 | Per-IP concurrent WS connections MUST be capped → 429. **Floor: 20** (maintainer decision, 2026-09-27). A **global** session cap SHOULD be added to bound aggregate gateway→Delphi load (risk B4). | Partial — the per-IP cap of **20** is enforced (`server/rate-limit.ts:WS_MAX_CONNECTIONS_PER_IP`, pinned by `server/rate-limit.test.ts`); no global cap exists. | L4 (per-IP now; global when implemented) |
| SEC-W-4 | Messages MUST be gated by session phase (`PHASE_ALLOWED_MESSAGES`): gameplay messages before auth → `ERROR_AccessDenied`; unknown message types MUST be rejected. | Met (`server.ts:PHASE_ALLOWED_MESSAGES`) | L4 |
| SEC-W-5 | Auth-bearing messages (`REQ_AUTH_CHECK`, `REQ_CONNECT_DIRECTORY`, `REQ_LOGIN_WORLD`) MUST be rate-limited per IP — one bucket per message type, 10 per minute per IP, so a full three-message login consumes one unit of each. | Met (`server/rate-limit.ts:checkAuthRateLimit`) | L4 |
| SEC-W-6 | Per-socket message rate MUST be capped: 20 messages/s sustained, burst 50, and at most 100 messages queued on the RDO lane; exceeding either closes the socket with 1008 (maintainer decision, 2026-09-27). Counted before the lane is chosen, in every mode including SINGLE_USER_MODE. | Met (`server/ws-message-guard.ts:WS_MESSAGE_RATE_PER_SECOND, WS_MESSAGE_BURST, WS_MAX_QUEUED_MESSAGES`, wired in `server.ts` `ws.on('message')`; pinned by `server/ws-message-guard.test.ts` and `server/__tests__/ws-message-guard-wiring.test.ts`) | L0 |
| SEC-W-7 | Idle or unresponsive (half-open) WebSocket connections MUST be detected: the gateway pings every open socket every 30 s and terminates one whose previous ping got no pong, so a socket that stopped answering is closed within ~60 s (maintainer decision, 2026-09-27). | Met (`server/ws-hygiene.ts:WS_HEARTBEAT_INTERVAL_MS`, pinned by `server/ws-hygiene.test.ts`) | L4 |

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
| SEC-R-2 | The server MUST validate its production configuration at startup and **fail fast** on forbidden combinations (at minimum: `NODE_ENV=production` + `LOG_LEVEL=debug`, and `NODE_ENV=production` + `SINGLE_USER_MODE=true`). It MUST log the effective security configuration (headers on, HSTS, trust-proxy, rate limits) once at boot, and warn when `TRUST_PROXY`/`ENABLE_HSTS` are unset in production. | Met (`server/production-config.ts`, called from `server.ts` `startGateway()` before the listen; the record is written with `Logger.always()` so `LOG_LEVEL=warn`/`error` cannot filter it away) | L0 (`server/production-config.test.ts`, `shared/logger-always.test.ts`, `server/__tests__/server-module.test.ts` — boot-failure path, readout and bypass) |

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
- Exceptions: documented here, with owner, rationale, and expiry condition. Current exceptions: none. SEC-X-1, below, is kept as a closed record.
- Review cadence: re-audit this policy whenever the deployment topology changes (new public endpoint, new proxy layer, new distribution channel) and at least once per release cycle.

### SEC-X-1 — raised per-IP ceilings for the automated test phase

| | |
|---|---|
| **Rows** | SEC-H-4 (auth, `/proxy-image`), SEC-W-3 (per-IP WS connections) |
| **Raised** | 2026-08-22, developer decision |
| **In force (while open)** | auth **1000/min**, `/proxy-image` **1000/min** (`server.ts:RATE_LIMIT_MAX_AUTH, RATE_LIMIT_MAX_PROXY`); per-IP WS connections **1000** (`server.ts:WS_MAX_CONNECTIONS_PER_IP`). nginx is unchanged at 30 r/s burst 60 — 1800/min (SPO-Deploy's `config/nginx/spo-webclient.conf`), so the app ceiling is the tighter of the two. The limits were **raised, not removed**. |
| **Rationale** | the bench worker drives real live traffic from a single IP and the gate serializes it; at the policy floor the project's own gate runs would 429 themselves. The Delphi servers hold this load without trouble. |
| **Owner** | the maintainer |
| **Expiry** | was *the first public deployment* — a condition, not a date. Reached 2026-09-27: the ceilings were brought to the production values before any public traffic (see *Closed*). |
| **Raised at the right moment by** | (history) [SPO-Deploy's `DEPLOY.md` — *Before the first public deployment*](https://github.com/Crazz-Org/SPO-Deploy/blob/main/DEPLOY.md), a deploy-time check, and SEC-R-2's boot log of the effective security configuration, which prints the ceilings at every boot (#212, landed 2026-08-25). |
| **Closed** | **2026-09-27 (#1031), maintainer decision** — in force: auth **10/min** per auth-bearing message type, `/proxy-image` **60/min**, WS **20** per IP (`server/rate-limit.ts`, pinned by `server/rate-limit.test.ts`). The bench stays unthrottled through `SINGLE_USER_MODE` (#1029), which answers the rationale above without raising any ceiling; production refuses to start in that mode (SEC-R-2). |

**Not an invitation to revert.** The raise was dated, reasoned and owned, and is now closed. What this entry fixes is that the policy previously recorded the *floor* as **Met** while the code enforced something a hundred times looser, so the document could not answer "what is enforced right now".
