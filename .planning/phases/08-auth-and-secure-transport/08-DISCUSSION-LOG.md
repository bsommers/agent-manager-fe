# Phase 8: Auth and Secure Transport - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md.

**Date:** 2026-11-11
**Phase:** 8-Auth and Secure Transport
**Areas discussed:** Token storage + logout, Failure + lockout, TLS + bind policy

---

## Token storage + logout
Storage: memory + sessionStorage (chosen) / memory only / localStorage. Entry: prompt on auth_failed (chosen) / settings screen / build-time env. Logout clears: everything (chosen) / token + connection only. Trigger: header menu + palette (chosen) / header button.

## Failure + lockout
Reconnect: stop and wait (chosen) / retry once. Throttle: per-IP backoff + constant-time (chosen) / constant-time only. Hello timeout: close 4401 after ~5 s (chosen) / close on first non-hello. HTTP: Bearer (chosen) / Bearer + Origin check.

## TLS + bind policy
TLS: reverse proxy (chosen) / gateway / both. Bind: token required (chosen) / token + opt-in flag. FE ws rule: loopback only (chosen) / + private LAN. Local auth: enforced whenever token set (chosen) / non-loopback only.

## Claude's Discretion
Token delivery (not selected as an area).

## Deferred Ideas
In-gateway TLS; Origin check; ALLOW_REMOTE flag.
