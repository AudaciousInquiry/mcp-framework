---
schema_version: '1.0'
created:
  date: '2026-11-21T17:55:50.887Z'
  user: boonek
  agent:
    name: claude-code
    version: unknown
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~285ce071-e06a-4c44-91b0-266717d6a482
  summary: >-
    Design draft with approved Decisions 1 and 2 (launcher entry point; two
    files with a server base class and detached spawn)
updated:
  - date: '2026-11-21T18:01:43.133Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~6458f374-26f1-4f25-bd2b-c4ff95167ca8
    summary: >-
      Add Decision 3 (dependencies) with log4js recorded as a user-approved
      maintenance exception
change_request: mcp-framework
---
# Design

> **Status: draft in review.** Decisions 1 to 3 are approved. The remaining decisions are reviewed with
> the user one at a time and added here as they are approved.

## Context

See `proposal.md` (Why) for the motivation and `specs/` for the requirements. This design explains how the
framework is built.

Constraints that shape the approach:

- The framework is extracted from two working servers that share one pattern: a launcher that starts a
  detached HTTP server, a server that exposes the tools, and a stdio bridge for clients that can only launch
  stdio programs. Both keep the launcher and the server in separate files.
- Node 22 or later, CommonJS, plain JavaScript with JSDoc, no build step (proposal, non-functional
  requirements).
- It must work on Windows as well as Linux and macOS. In particular, Windows never delivers `SIGTERM` to a
  handler, so a graceful stop cannot rely on signals.
- The package is public and self-contained, so nothing in it may refer to a private project.

## Goals / Non-Goals

**Goals:**

- An MCP author writes only what is specific to the MCP (its tools, defaults, and hooks). Everything about
  process lifecycle, transport, command line, configuration, and logging comes from the framework.
- The launcher stays light. Commands that only query or configure (`list`, `call`, `health`, `stop`, `init`)
  never load the author's tool code.
- A small public surface, so the semver contract stays small.

**Non-Goals:**

- Migrating the existing MCPs to the framework. That is a separate change.
- An in-process stdio mode that skips the daemon. A framework MCP always runs as daemon plus bridge.

## Decisions

### Decision 1: One entry point for the launcher

The launcher file calls a single function, `runLauncher(definition)`. It validates the definition at start-up
and fails with a clear message when a required field is missing. Everything else the framework does (daemon
control, bridge, command line, configuration, logging) is internal. The only other public exports are the
base class for the server (Decision 2), the logger factory, and the helpers for marking argument schemas,
such as the `x-cli: 'file'` marker.

```js
const { runLauncher } = require('mcp-framework');

runLauncher({
  defaultPort: 7561,
  serverScript: 'server.js',                 // optional, this is the default
  nodeArgs: ['--max-old-space-size=8192'],   // optional
  settings: z.object({ /* types for init */ }),
  // launcher-side hooks: default arguments for call, bridge start-up, init prompts
});
```

**Alternative considered:** export the pieces (start the daemon, create the bridge, create the command line)
and let each MCP wire them together. That is more flexible, but it recreates the copy-and-drift problem the
framework exists to remove, and it makes the semver surface much larger.

### Decision 2: Two files, a base class for the server, and a detached spawn

An MCP has two files, as both existing servers do.

- **Launcher** (`index.js` by convention): calls `runLauncher`. It handles the command line, starts and stops
  the daemon, and runs the stdio bridge. It does not load the tool code.
- **Server** (`server.js` by default): exports a class that extends the framework's `McpServerBase`, and
  starts it only when the file is run directly.

```js
const { McpServerBase } = require('mcp-framework');

class MyServer extends McpServerBase {
  async startup(config, log) { /* create long-lived resources; return the context */ }
  registerTools(server, context) { /* register the tools */ }
  async afterListening(context) { /* slow setup goes here */ }
  healthExtension(context) { /* extra health fields */ }
  async shutdown(context) { /* release resources */ }
}

module.exports = MyServer;
if (require.main === module) new MyServer().run();
```

`McpServerBase` carries the shared behavior: stateless HTTP on loopback, `/health`, port-in-use handling,
the process id file, the graceful `POST /shutdown` sequence, logging, and the fatal-error handlers. The author
overrides only what is specific to the MCP. Exporting the class without starting it lets tests load it
without starting a server.

Details:

- **Server file name:** the launcher definition names it in `serverScript`, relative to the launcher's
  directory, defaulting to `server.js`. It is not a user setting, because a user has no reason to run a
  different script and a configuration value that makes the launcher execute an arbitrary path is a hazard.
  The launcher checks that the file exists and fails with a clear message when it does not.
- **Name and version:** the framework reads both from the MCP's own `package.json`, so they cannot drift from
  the package.
- **Starting the server:** the launcher uses detached `spawn` of `process.execPath` with the optional
  `nodeArgs` placed before the script path, the server's standard error going to a log file, and `unref` so
  the server outlives the launcher. Node ignores a runtime option such as the heap limit if it comes after
  the script path, which is why `nodeArgs` goes first.

**Alternatives considered:**

- *One file that re-runs itself with an internal flag.* Less to write, but it depends on `process.argv[1]`
  being the real script, which a shim or `npx` can break, and it differs from the layout both existing
  servers already use.
- *`child_process.fork`.* It is `spawn` plus a message channel, and the channel is of no use because the
  server must outlive the launcher. It would need a `disconnect` and `unref`, it passes the launcher's own
  Node flags (such as a debugger flag) on to the server by default, and it would add a second way to learn
  that the server is up when polling `/health` is needed anyway.

### Decision 3: Dependencies

Three runtime dependencies, a few small pieces written in the framework, and everything else built in.

- `@modelcontextprotocol/sdk` (`^1.32`), a direct dependency. The framework owns the version it is tested
  against.
- `log4js` (`^6.9`), a direct dependency. It provides the daily rotation, size limit, backups, and levels that
  the diagnostics-logging spec describes, and the existing servers already use it with the same settings, so
  their log files keep the same shape. It is an approved exception to the maintenance rule (see below).
- `zod` (`^4.4`), a peer dependency. The SDK declares `zod` as a required peer as well. A peer means one copy of
  Zod is shared with the author's schemas; two copies would break the `.meta()` markers that argument typing
  reads.

Written in the framework:

- **The argument parser.** Node's `util.parseArgs` rejects `--since -7d` as ambiguous (only `--since=-7d`
  works), and the argument-mapping spec requires the first form, along with dotted names, `--no-name`, and its
  own quoting rules.
- **Date parsing.** The spec allows ISO forms and a short list of relative words and forbids natural language,
  which a date library would add back.
- **Comma and quote splitting**, which follows the spec's own quoting rules.
- **A thin logging module** that configures `log4js`: appenders, named loggers, the level override, and the
  standard error mirror. It is the only code that imports `log4js`.

Built in, no dependency: `node:http`, `child_process`, `readline/promises` for the `init` prompts, and
`node:test` for tests.

**Vetting.** `npm audit` on the SDK, `zod`, and `log4js` together reports no vulnerabilities of any severity.
The SDK (2026-10-23) and `zod` (2026-10-12) were released within the past 12 months. `log4js` has had no
release since 2023-03-08, which fails the 12-month rule; the user approved it as an exception on 2026-11-21.
The exception covers the maintenance criterion only, and the no-unfixable-CVE rule still applies. Licenses are
MIT (SDK, `zod`) and Apache-2.0 (`log4js`).

**Alternatives considered:**

- *`rotating-file-stream` with a small formatting layer of our own.* It passes every vetting check (released
  2026-11-11, no dependencies), but it replaces a working library with code we would have to write and test. It
  is the fallback if `log4js` ever develops a problem.
- *`pino-roll` and `winston-daily-rotate-file`.* Their last releases were 2025-10-06 and 2024-02-09, so they
  fail the same rule that `log4js` does, with no offsetting advantage.

## Risks / Trade-offs

- **Two files per MCP.** An author keeps a launcher and a server in step. Mitigation: the launcher is a few
  lines, `serverScript` defaults to the conventional name, and the launcher checks for the file at start-up.
- **Inheritance.** A base class couples authors to the framework's class shape. Mitigation: the overridable
  methods are the documented contract and follow the same semver rules as the rest of the public surface.
- **An unmaintained logging library.** `log4js` has had no release in over three years. Mitigation: the user
  approved it as an exception, `npm audit` is clean today, and only one internal module imports it, so
  `rotating-file-stream` can replace it without changing the public surface.
