---
schema_version: '1.0'
created:
  date: '2026-11-18T10:26:29.828Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~1e1fdc2d-84e6-4f4e-b94f-1fe982a4f534
  summary: >-
    Initial proposal for mcp-framework CR, from investigation of three existing
    MCP servers
updated:
  - date: '2026-11-18T14:07:09.658Z'
    user: boonek
    agent:
      name: claude-code
      version: 2.x
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~e148b5d8-e4eb-4d94-abe8-9e4b485b264f
    summary: 'Proposal: argument mapping also covers init'
  - date: '2026-11-18T10:36:55.811Z'
    user: boonek
    agent:
      name: claude-code
      version: 2.x
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~2c8361ec-aeaf-480e-bc0b-fc2753fb01a1
    summary: >-
      Add cli-argument-mapping capability: typed command-line arguments for
      call, driven by the tool's input schema
change_request: mcp-framework
---
# Proposal: mcp-framework

## Why

Three MCP servers built in this organization repeat the same infrastructure: a launcher that starts a
long-lived local HTTP server, a stdio bridge for clients that can only launch stdio servers, a health
endpoint, a command-line client, and a config file. The code was written once, copied, and has since
drifted: one copy handles restart, version comparison, graceful shutdown, and crash recovery; another
has a simpler lifecycle; a third never became a daemon at all and starts a new process per
invocation. Every fix to lifecycle code (several came from real incidents) has to be rediscovered in
each copy. A reusable library lets an MCP author write only the tools and gain the proven lifecycle.

## User Story

As an MCP server author, I want to plug my tools into a shared framework that provides the daemon,
the stdio bridge, the CLI, and the configuration, so that I write only my domain logic and every
server behaves the same way when started, stopped, restarted, or recovered after a crash.

## What Changes

- New public repository `AudaciousInquiry/mcp-framework` that produces a Node.js library (npm package).
- The library provides the shared server lifecycle as a set of capabilities (listed below). An MCP
  plugs in by supplying its identity (name, version, default port), a function that registers its
  tools, and optional hooks (extra health fields, startup, shutdown, extra command-line flags).
- `call` accepts command-line arguments in addition to JSON, converted using the tool's own input
  schema (see `cli-argument-mapping`), so calling a tool from a shell no longer requires hand-written
  JSON.
- A `README.md` explains how to integrate an MCP into the library, with a complete minimal example.
- The existing MCP servers are **not** modified by this change. Migrating them is separate, later work.

## Non-Functional Requirements

- Public repository, published to the public npm registry, so public MCP projects can depend on it.
- Node.js 22 or later. CommonJS, plain JavaScript with JSDoc types, no build step.
- HTTP mode is **stateless** by default: no MCP session state is held by the server, so a restart
  loses nothing and the stdio bridge can reconnect transparently.
- The server binds to the loopback interface only.
- The default port is chosen by each MCP; the framework provides the way to declare it and lets the
  user override it in configuration.
- Behavior proven by incidents in the source servers is preserved (see Capabilities), not re-derived.

## Capabilities

### New Capabilities

- `daemon-lifecycle`: launcher that starts the server detached and waits until healthy; single-instance
  enforcement; version-aware start and restart; graceful stop through a shutdown endpoint with a kill
  fallback; PID file handling; respawn after a crash.
- `http-mcp-server`: stateless MCP over HTTP on loopback; health endpoint with an MCP-extensible
  payload; occupant check when the port is already in use; connection drain on shutdown.
- `stdio-bridge`: stdio-to-HTTP message passthrough for clients that only launch stdio servers; starts
  the daemon if needed; respawns and reconnects when the daemon dies without dropping the client.
- `cli-client`: `health`, `list`, and `call` subcommands against a running server, including
  whole-argument JSON from a file, without starting the server as a side effect.
- `cli-argument-mapping`: lets `call` (and `init`, for configuration settings) take ordinary command-line arguments instead of only JSON. The
  arguments are converted to the types the tool's own input schema declares (strings, numbers,
  booleans, dates, file paths, arrays, JSON objects) and merged into the arguments object sent to the
  tool. Nested fields are set with dotted names. JSON supplied by the user is applied first and
  command-line arguments are set on top of it. A tool author can mark an argument's command-line type
  (for example, a file path) through metadata on the tool's Zod schema.
- `mcp-configuration`: per-MCP config file with defaults merged under stored values, including the
  declared default port and a way to save updates.
- `diagnostics-logging`: rotating file logging with an optional debug mirror to stderr, and handlers
  that record uncaught exceptions and unhandled rejections with a stack trace before exiting.
- `plugin-contract`: the public API an MCP implements to plug in, and the integration documentation
  that goes with it.

### Modified Capabilities

None. This is a new repository.

## Impact

- New repository only. No existing repository changes.
- Becomes a dependency of future MCP servers; its API is therefore a compatibility commitment, so the
  plugin contract is versioned with semantic versioning.
- Depends on `@modelcontextprotocol/sdk` and `zod` (to be vetted for CVEs and maintenance per the
  library-vetting rule before adoption).

## Non-Goals

- Migrating any existing MCP to the framework.
- A stateful HTTP mode. Not needed by the current servers; can be added later if one requires it.
- Remote (non-loopback) access or authentication.
- TypeScript sources or a build step.

## Open Questions

None at the proposal stage. Per-capability detail is settled in the specs and design.
