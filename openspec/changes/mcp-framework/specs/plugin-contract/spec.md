---
schema_version: '1.0'
created:
  date: '2026-11-18T13:18:29.599Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: plugin-contract spec for mcp-framework
updated:
  - date: '2026-11-23T22:12:19.755Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~f3aee51d-0f37-49bb-8b66-3fda7fac7831
    summary: >-
      Reconcile plugin-contract with the two-file layout, base class, shared
      tools, ctx and Node version check
  - date: '2026-11-21T17:33:23.834Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~396f0a69-9a9a-4adb-a527-4de3d9718030
    summary: >-
      Document that slow setup belongs in the after-listening hook so health
      answers during it
  - date: '2026-11-18T14:06:24.636Z'
    user: boonek
    agent:
      name: claude-code
      version: 2.x
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~e148b5d8-e4eb-4d94-abe8-9e4b485b264f
    summary: Add optional settings schema to the plugin definition
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: One definition produces a complete MCP

An MCP author SHALL be able to produce a working MCP, with the launcher, server, stdio bridge, command-line
client, configuration, and logging described by the other capabilities, from three small files: a launcher that
calls the framework's `runLauncher` with the MCP's definition, a server file that exports a class extending the
framework's server base class, and a shared file of tool schemas written with `defineTools`. The author SHALL
NOT need to write lifecycle, transport, or command-line parsing code.

#### Scenario: Minimal MCP
- **WHEN** an author writes the launcher with a default port, a server class that registers one tool, and a tools file that declares it
- **THEN** running the executable with no arguments starts a server offering that tool
- **AND** `--stdio`, `--stop`, `--restart`, `--debug`, `--help`, `health`, `list`, `call`, and `init` all work

#### Scenario: Entry point from an executable
- **WHEN** the MCP's launcher calls `runLauncher` and its server file starts the server class
- **THEN** neither file needs further code to support those modes

#### Scenario: Loading
- **WHEN** the framework is loaded from CommonJS or from an ES module
- **THEN** both can use it

### Requirement: Required definition fields are validated

The launcher's definition SHALL include the MCP's default port. The MCP's name and version SHALL be read from
its own `package.json`. The framework SHALL check these at startup and fail with a message naming the missing
or invalid field. The name SHALL be usable as a directory name and as part of an environment variable name. The
version SHALL be a semantic version. The launcher SHALL check that the server file exists, and the server class
SHALL provide its tool registration method.

#### Scenario: Missing field
- **WHEN** the server class does not provide its tool registration method
- **THEN** startup fails saying that the method is required

#### Scenario: Missing server file
- **WHEN** the launcher starts and the server file named by the definition, or `server.js` by default, does not exist
- **THEN** the launcher fails naming the file it looked for

#### Scenario: Invalid name
- **WHEN** the name contains characters that cannot form a directory name
- **THEN** startup fails saying how the name must be formed

#### Scenario: Invalid version
- **WHEN** the version is not a semantic version
- **THEN** startup fails naming the field

### Requirement: Tool registration

Tools SHALL be declared once, in a shared file, with a name, a description, and an input schema written in Zod,
so that the same schema drives validation on the server and argument conversion on the command line. The
server's tool registration method SHALL receive the MCP server object and the MCP's context (see below) and
attach a handler to each declared tool with the framework's `register` helper. The helper wraps every handler:
an exception becomes an error result with the stack trace logged, and the call's start, duration and outcome
are logged.

#### Scenario: Schema drives validation
- **WHEN** a client calls a tool with an argument that violates the Zod schema
- **THEN** the call is rejected with a validation error and the handler is not run

#### Scenario: Schema drives the command line
- **WHEN** a tool's schema has an integer field
- **THEN** `call` converts `--field 3` to the number 3 for that tool without any additional code from the author

#### Scenario: Handler throws
- **WHEN** a handler registered with `register` throws
- **THEN** the client receives an error result with the exception's message, the stack trace is in the log, and the server keeps running

#### Scenario: Result helpers
- **WHEN** the author uses the framework's helpers to return text or an error
- **THEN** the result has the standard shape: text content, with the error flag set for an error

### Requirement: Context that lives as long as the server

The framework SHALL let the MCP create its long-lived resources once, when the server process starts, and SHALL
pass what it created to the tool registration method, to the health extension, and to the shutdown method. The
framework SHALL NOT create such state per request.

The framework SHALL document that setup which can take long, such as downloading or loading a model, belongs in
the after-listening method and not in the startup method, because the launcher and
the bridge wait only until the server answers its health check. Tool calls made before that work finishes are
the MCP's to answer, normally with a clear "still starting, try again shortly" error.

#### Scenario: Shared resource
- **WHEN** the startup method opens a resource and returns it
- **THEN** every tool handler can use that same resource on every request

#### Scenario: Startup failure
- **WHEN** the startup method throws
- **THEN** the server logs the error with its stack trace, does not bind the port, writes no process id file, and exits non-zero

#### Scenario: Slow setup after listening
- **WHEN** the MCP starts a long download from the after-listening method
- **THEN** the server answers its health check while the download runs, and the launcher and bridge report success without waiting for it

### Requirement: Optional hooks

The server class MAY override: `startup`, which runs before the port is bound; `afterListening`, which runs
once the server is listening, for background work such as timers or workers; `healthExtension`; and `shutdown`.
The launcher's definition MAY include: a function that adds default arguments to `call`; a function that runs
when a bridge starts, and again after each respawn; a Zod schema for its settings, which types the arguments to
`init`; a validation and normalization function for configuration; extra configuration settings to prompt for in
`init`; and extra launcher options with their help text and handlers. In the server, the configuration and the
logger are `this.config` and `this.log`. Every launcher hook receives one object, `ctx`, with `ctx.config`,
`ctx.client` (which calls the server's tools, as the command line does) and `ctx.log`. Every hook SHALL be
optional and the MCP SHALL work without any of them.

#### Scenario: Order of hooks
- **WHEN** the server starts and stops
- **THEN** the startup function runs first, then the port is bound and the process id file is written, then the after-listening function runs
- **AND** on shutdown the shutdown function runs after in-flight requests drain and before the process exits

#### Scenario: Failure after listening
- **WHEN** the after-listening function throws
- **THEN** the error is logged with its stack trace and the server shuts down cleanly with a non-zero status, so a half-started server is not left running

#### Scenario: Extra launcher option
- **WHEN** the MCP declares an option `--rebuild` with a handler and help text
- **THEN** running with `--rebuild` calls the handler and `--help` lists the option

#### Scenario: Name collision
- **WHEN** the MCP declares an option or command with a name the framework reserves
- **THEN** startup fails naming the collision

#### Scenario: Configuration from a launcher hook
- **WHEN** a launcher hook runs
- **THEN** `ctx.config` holds the merged configuration and `ctx.client` can call the server's tools

#### Scenario: No hooks
- **WHEN** the definition has only the required fields
- **THEN** everything works with default behavior

### Requirement: Stable, versioned contract

The framework SHALL follow semantic versioning. The launcher definition fields, `runLauncher`, the server base
class and its overridable methods, `defineTools` and `register`, the `ctx` object, `this.config` and `this.log`,
the settings `maxBodyBytes`, `drainMs` and `startupTimeoutMs`, the `/health` base fields, the shutdown route, the
data directory layout, and the command-line options including `--log-level` SHALL be the public contract, and
removing or changing the meaning of any of them SHALL be a major version change.

#### Scenario: Compatible update
- **WHEN** a minor or patch version of the framework is installed
- **THEN** an MCP written against the earlier version of the same major version continues to work unchanged

#### Scenario: Documented contract
- **WHEN** a reader looks at the README
- **THEN** it identifies which behaviors are part of the contract

### Requirement: Integration documentation

The repository's `README.md` SHALL explain how to integrate an MCP into the library. It SHALL contain: what the
framework provides; installation; a complete, runnable minimal MCP made of the three files (launcher, server class, shared tools); a
description of every launcher definition field, hook and overridable method, with an example of each, and of
`ctx`; how to write tools with `defineTools` and `register`; how to run, stop, restart, and debug the MCP; how to register the MCP with an
agent over stdio and over HTTP; how to call tools from the command line, with examples for every argument type,
for dotted names, for the `@` prefix, and for quoting in both cmd.exe and POSIX shells; how to mark a field as
a file path; the configuration file and the log level; the behaviors that surprise people (a launcher whose standard error
is read through a pipe waits until the server stops; a default changed in a later version does not reach an
existing configuration file; `/shutdown` is the only graceful stop on Windows; the 1 MB request limit and
`maxBodyBytes`); and troubleshooting for a port in use, a server that will
not start, and a stale process id file.

#### Scenario: New author
- **WHEN** an author follows the README from an empty directory
- **THEN** they have a running MCP offering a tool, reachable over HTTP and over stdio, within the steps listed

#### Scenario: Example is tested
- **WHEN** the repository's tests run
- **THEN** the README's minimal example is built from the stand-in MCP's files, which the tests run, so the example cannot drift from the code

#### Scenario: Shell examples
- **WHEN** the README shows a command line with quoting
- **THEN** it shows how the same call is written in cmd.exe and in a POSIX shell

### Requirement: Supported Node version

The framework SHALL require Node.js 22 or later, declared in the package's `engines` field. Because that field is
only advisory, the launcher SHALL check the Node major version before doing anything else and, when it is lower,
print one line saying which version is needed and which was found, and exit non-zero.

#### Scenario: Older Node
- **WHEN** the launcher is run on Node 20
- **THEN** it prints that Node 22 or later is needed and that 20 was found, and exits non-zero without starting anything

#### Scenario: Supported Node
- **WHEN** the launcher is run on Node 22 or later
- **THEN** the check passes without output

### Requirement: Public and self-contained

The framework SHALL be published as a public package with no dependency on any private package or service, and
its repository SHALL NOT contain credentials or the names of private projects.

#### Scenario: Install without private access
- **WHEN** a user without access to any private registry installs the framework
- **THEN** installation succeeds and every dependency resolves from the public registry
