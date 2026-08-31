# Freebuff CLI Emulator

> Internal architecture reference for the Freebuff provider's CLI emulation
> layer (`src/lib/providers/freebuff/cliEmulator/`). This doc explains how
> OmniRoute talks to the Codebuff Free Tier backend **without** invoking the
> `freebuff` binary — by replaying the same wire protocol from Node.js.

## Why an emulator?

The Freebuff provider originally wrapped the `freebuff` CLI as a subprocess
(see `docs/providers/freebuff.md`). That approach had two problems:

1. **Single concurrent session.** The CLI uses a PID-file lock — only one
   process can hold an active session at a time. Running multiple OmniRoute
   workers (or running `freebuff login` while OmniRoute is serving traffic)
   produced `409 Conflict` errors.
2. **Subprocess overhead.** Spawning a Bun binary per request added ~150 ms
   of cold-start latency and required `freebuff` to be installed on the
   host.

The emulator replaces both: it speaks the same HTTPS + SSE protocol as the
CLI, but in-process. There is no subprocess, no PID lock, and no
`freebuff.exe` dependency at runtime.

## Module layout

```
src/lib/providers/freebuff/cliEmulator/
├── index.ts              ← public barrel (re-exports everything below)
├── types.ts              ← shared interfaces (Envelope, Credentials, Session, …)
├── httpClient.ts         ← TLS-impersonating fetch (tls-client-node / wreq-js / fetch)
├── sessionManager.ts     ← queue-seat acquisition + release
├── agentRunner.ts        ← agent-runs/start + finish lifecycle
├── envelopeBuilder.ts    ← wire envelope + headers + client-id generation
├── sseParser.ts          ← canonical SSE event parser
├── modelRegistry.ts      ← model → agent/tier mapping + fallback chain
├── fallbackChain.ts      ← error classification + candidate selection
└── emulateChat.ts        ← main entry point: orchestrates one chat completion
```

## Request lifecycle

```
emulateChat(input, options)
  │
  ├─ 1. Build fallback chain (modelRegistry.buildFallbackChain)
  │     └─ ordered list of (model, tier) candidates
  │
  ├─ 2. For each candidate:
  │     │
  │     ├─ 2a. sessionManager.claim()        ← acquire queue seat
  │     │     └─ POST /api/v1/agent-runs/sessions/…
  │     │
  │     ├─ 2b. agentRunner.start()           ← register an agent run
  │     │     └─ POST /api/v1/agent-runs/start
  │     │
  │     ├─ 2c. envelopeBuilder.buildEnvelope()  ← build wire body
  │     ├─ 2d. envelopeBuilder.buildHeaders()   ← build auth headers
  │     │
  │     ├─ 2e. POST /api/v1/chat/completions
  │     │     └─ upstream.body is a ReadableStream<Uint8Array>
  │     │
  │     ├─ 2f. Pipe through createTransformer(format, { model })
  │     │     └─ "openai" → passthroughTransformer (byte-for-byte)
  │     │     └─ "anthropic" → anthropicTransformer (re-frame)
  │     │
  │     └─ 2g. Wrap in Response with x-omniroute-freebuff-* headers
  │           └─ TransformStream flush/cancel → agentRunner.finish()
  │
  └─ 3. Return { response, servedModel, servedTier, agent, runId, instanceId, fallbackAttempts }
```

If any step in (2) throws a recoverable error, `classifyError` decides
whether to retry with the next candidate (e.g. `country_blocked` →
downgrade to the limited tier). `FreebuffAuthError` short-circuits the
chain — no point trying other models.

## Wire protocol

The upstream Freebuff backend speaks **standard OpenAI SSE** on the
`/api/v1/chat/completions` endpoint. The CLI emulator does **not** emit
Codebuff's legacy custom events (`response-chunk`, `reasoning_delta`,
`tool-call`, `prompt-error`, `subagent-response-chunk`) — those were
analysed out of the binary but are not actually sent on the wire.

The relevant upstream endpoints are:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/agent-runs/sessions` | Acquire a queue seat (`sessionManager.claim`) |
| `POST /api/v1/agent-runs/start` | Register an agent run, returns `runId` (`agentRunner.start`) |
| `POST /api/v1/chat/completions` | Stream the chat completion as OpenAI SSE |
| `POST /api/v1/agent-runs/finish` | Release the run (`agentRunner.finish`) |

The `runId` returned by `agent-runs/start` must be passed back in both the
**header** (`x-codebuff-run-id`) and the **body** (`runId` field of the
envelope) of the subsequent `chat/completions` request. The emulator
handles this in `envelopeBuilder.buildHeaders` and `buildEnvelope`.

## TLS fingerprinting

The Freebuff backend inspects the JA3/JA4 fingerprint of incoming TLS
connections and rejects requests that don't match the Bun 0.1.0 profile
with `free_mode_cli_required`. The emulator's `httpClient` resolves one
of three backends at startup, in priority order:

1. **`tls-client-node`** (preferred) — bogdanfinn/tls-client native bindings.
2. **`wreq-js`** (fallback) — Rust-powered wreq library with browser
   fingerprint impersonation.
3. **global `fetch`** (last resort) — will fail the CLI fingerprint check
   but lets the rest of the pipeline run for testing.

The selected backend is cached for the lifetime of the process. Use
`getHttpClientBackendName()` for diagnostics.

## SSE transformer

The `createTransformer(format, options)` factory in
`src/lib/providers/freebuff/stream/index.ts` returns the right
`TransformStream<Uint8Array, Uint8Array>` for the caller:

- **`format: "openai"`** → `createPassthroughTransformer` (byte-for-byte
  relay). The upstream already emits standard OpenAI SSE chunks, so any
  re-framing would corrupt the wire format and trip
  `detectMalformedNonStream` in `open-sse/handlers/chatCore.ts`.
- **`format: "anthropic"`** → `createAnthropicTransformer` (re-frame from
  OpenAI SSE to Anthropic SSE). Required because `/v1/messages` clients
  cannot consume raw OpenAI chunks.

The `includeSubagentOutput?: boolean` flag is propagated through
`TransformerOptions` and is currently a no-op for the OpenAI passthrough
(the upstream already decides what to surface). The Anthropic transformer
honours it.

## Error model

The emulator throws typed errors that the executor (`open-sse/executors/freebuff.ts`)
maps to HTTP responses:

| Error class | HTTP status | `error.type` |
|---|---|---|
| `FreebuffAuthError` | 401 | `unauthenticated` |
| `FreebuffChainExhaustedError` | 502 | `chain_exhausted` |
| `FreebuffCountryBlockedError` | (rethrown) | — |
| `FreebuffSessionError` | 502 | `provider_error` |
| Other | 502 | `provider_error` |

Error messages are passed through `sanitizeErrorMessage` from
`open-sse/utils/error.ts` before being placed in the response body, per
the project's error-sanitisation policy.

## Tests

| Test file | Coverage |
|---|---|
| `freebuff-cli-emulator.test.ts` | `emulateChat` orchestration, fallback chain, error mapping |
| `freebuff-stream-openai.test.ts` | Passthrough contract (byte-for-byte relay) |
| `freebuff-stream-integration.test.ts` | End-to-end via `FakeEventSource` (OpenAI client simulation) |
| `freebuff-chat-wireshape.test.ts` | Envelope + header shape sent to upstream |
| `freebuff-chat-body.test.ts` | Body field validation (model, messages, tools, …) |
| `freebuff-session-manager.test.ts` | Queue-seat acquisition + release |
| `freebuff-agent-runs.test.ts` | Agent run lifecycle (start + finish) |
| `freebuff-fingerprint.test.ts` | Fingerprint validation (`/^enhanced-…$/`) |
| `freebuff-models.test.ts` | Model registry + fallback chain construction |
| `freebuff-fallback.test.ts` | Error classification + candidate selection |

## See also

- [freebuff.md](./freebuff.md) — User-facing provider docs.
- [freebuff-api.md](./freebuff-api.md) — HTTP API reference.
