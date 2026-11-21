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
updated: []
change_request: mcp-framework
---
# Design

> **Status: draft in review.** Decisions 1 and 2 are approved. The remaining decisions are reviewed with
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

## Risks / Trade-offs

- **Two files per MCP.** An author keeps a launcher and a server in step. Mitigation: the launcher is a few
  lines, `serverScript` defaults to the conventional name, and the launcher checks for the file at start-up.
- **Inheritance.** A base class couples authors to the framework's class shape. Mitigation: the overridable
  methods are the documented contract and follow the same semver rules as the rest of the public surface.
