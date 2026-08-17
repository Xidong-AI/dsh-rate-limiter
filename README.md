# dsh-rate-limiter

> [English](README.md) | [中文](README.zh.md)

A **proactive rate limiter** plugin for DeepSeek Harness (`dsh`): it controls the request rate **per provider** (token bucket) **before** model requests are issued, and **queues the request with a delay** instead of failing when the limit is exceeded — avoiding upstream 429s.

It complements the official `dsh-llm-retry` (exponential backoff after failure): rate limiting comes first (prevention), backoff comes last (safety net); the two do not interfere with each other.

## Features

- Per-provider token bucket, enforced **before** the request is sent (proactive prevention)
- Over-limit requests are queued with a delay instead of rejected (no 429s, no lost requests)
- Unconfigured providers pass through untouched (zero intrusion)
- Queued waits honor the abort signal: stopping the user interrupts the wait immediately
- Hand-written reservation-based token bucket (concurrency-safe), zero third-party rate-limiting dependencies
- Mounts on `agent/request`, coexists naturally with `dsh-llm-retry`

## Installation

Install from npm:

```shell
dsh plugin --profile web add @Xidong-AI/dsh-rate-limiter
```

Or install directly from GitHub:

```shell
dsh plugin --profile web add github:Xidong-AI/dsh-rate-limiter
```

For local development, add the checkout directly:

```shell
dsh plugin --profile web add .
```

After installing, `dsh --profile web --dump-config` should show the plugin entry:

```yaml
- id: rate-limiter
  name: @xidong-ai/dsh-rate-limiter
  config:
    enabled: true
    providers: {}
```

## Configuration

Configure the token bucket per provider in the profile's `cordis.patch.yml` (or this plugin's `cordis.patch.yml`):

```yaml
- id: rate-limiter
  config:
    enabled: true
    providers:
      nvidia:
        rate: 2          # tokens/second (long-term average QPS)
        burst: 5         # bucket capacity (allowed burst requests)
      oc-zen:
        rate: 1
        burst: 3
```

- `rate`: refill rate (tokens/second), i.e. the long-term average request rate.
- `burst`: bucket capacity, the number of burst requests allowed.
- **Providers not listed are not rate-limited**; requests pass through untouched (zero intrusion).
- `enabled: false` disables the plugin entirely.

## How It Works

The plugin hooks onto the `agent/request` waterfall: it `await next()` first to obtain the call config (which carries the provider), then performs a per-provider token bucket check; when tokens are insufficient, it queues the request with a delay (interrupted immediately by the abort signal when the user stops), then returns the config unchanged — it never modifies request content, never changes routing, never swallows errors. It only controls *when* a request is issued.

The rate-limiting algorithm is a hand-written reservation-based token bucket (concurrency-safe), with zero third-party rate-limiting dependencies.

## Relationship with dsh-llm-retry

| Plugin | Timing | Behavior |
| --- | --- | --- |
| `dsh-rate-limiter` | Before the request is issued | Queue with a delay when over the limit (prevents 429s) |
| `dsh-llm-retry` | After the request fails | Exponential backoff retry (safety net) |

They mount at different points (`agent/request` vs `agent/request-error`) and coexist naturally.

## Uninstall

```shell
dsh plugin --profile web remove @xidong-ai/dsh-rate-limiter
```

## Development

```shell
npm install
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # esbuild transpiles lib/*.ts → lib/*.js
```

## Acknowledgements

Thanks to the [Linux.do](https://linux.do) community for support.
