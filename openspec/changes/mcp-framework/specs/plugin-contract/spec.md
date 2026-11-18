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
client, configuration, and logging described by the other capabilities, by supplying one definition to the
framework and calling one entry point from the MCP's executable. The author SHALL NOT need to write lifecycle,
transport, or command-line parsing code.

#### Scenario: Minimal MCP
- **WHEN** an author supplies a name, a version, a default port, and a function that registers one tool
- **THEN** running the executable with no arguments starts a server offering that tool
- **AND** `--stdio`, `--stop`, `--restart`, `--debug`, `--help`, `health`, `list`, `call`, and `init` all work

#### Scenario: Entry point from an executable
- **WHEN** the MCP's executable script calls the framework's entry point
- **THEN** the script needs no further code to support those modes

#### Scenario: Loading
- **WHEN** the framework is loaded from CommonJS or from an ES module
- **THEN** both can use it

### Requirement: Required definition fields are validated

The definition SHALL include the MCP's name, its version, its default port, and its tool registration function.
The framework SHALL check these at startup and fail with a message naming the missing or invalid field. The name
SHALL be usable as a directory name and as part of an environment variable name. The version SHALL be a
semantic version.

#### Scenario: Missing field
- **WHEN** the definition has no tool registration function
- **THEN** startup fails saying that field is required

#### Scenario: Invalid name
- **WHEN** the name contains characters that cannot form a directory name
- **THEN** startup fails saying how the name must be formed

#### Scenario: Invalid version
- **WHEN** the version is not a semantic version
- **THEN** startup fails naming the field

### Requirement: Tool registration

The tool registration function SHALL receive the MCP server object to which tools are added, and the MCP's
context (see below). Tools SHALL be defined with a name, a description, and an input schema written in Zod,
so that the schema drives validation on the server and argument conversion on the command line.

#### Scenario: Schema drives validation
- **WHEN** a client calls a tool with an argument that violates the Zod schema
- **THEN** the call is rejected with a validation error and the handler is not run

#### Scenario: Schema drives the command line
- **WHEN** a tool's schema has an integer field
- **THEN** `call` converts `--field 3` to the number 3 for that tool without any additional code from the author

#### Scenario: Result helpers
- **WHEN** the author uses the framework's helpers to return text or an error
- **THEN** the result has the standard shape: text content, with the error flag set for an error

### Requirement: Context that lives as long as the server

The framework SHALL let the MCP create its long-lived resources once, when the server process starts, and SHALL
pass what it created to the tool registration function, to the health extension, and to the shutdown hook. The
framework SHALL NOT create such state per request.

#### Scenario: Shared resource
- **WHEN** the startup function opens a resource and returns it
- **THEN** every tool handler can use that same resource on every request

#### Scenario: Startup failure
- **WHEN** the startup function throws
- **THEN** the server logs the error with its stack trace, does not bind the port, writes no process id file, and exits non-zero

### Requirement: Optional hooks

The definition MAY include: a startup function that runs before the port is bound; a function that runs after
the server is listening, for background work such as timers or workers; a health extension; a shutdown function;
a function that adds default arguments to `call`; a function that runs when a bridge starts; a Zod schema for its settings, which types the arguments to `init`; a validation and
normalization function for configuration updates; extra configuration settings to prompt for in `init`; and extra
launcher options with their help text and handlers. Every hook SHALL be optional and the MCP SHALL work without
any of them.

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

#### Scenario: No hooks
- **WHEN** the definition has only the required fields
- **THEN** everything works with default behavior

### Requirement: Stable, versioned contract

The framework SHALL follow semantic versioning. The definition fields, hook signatures, the `/health` base
fields, the shutdown route, the data directory layout, and the command-line options SHALL be the public
contract, and removing or changing the meaning of any of them SHALL be a major version change.

#### Scenario: Compatible update
- **WHEN** a minor or patch version of the framework is installed
- **THEN** an MCP written against the earlier version of the same major version continues to work unchanged

#### Scenario: Documented contract
- **WHEN** a reader looks at the README
- **THEN** it identifies which behaviors are part of the contract

### Requirement: Integration documentation

The repository's `README.md` SHALL explain how to integrate an MCP into the library. It SHALL contain: what the
framework provides; installation; a complete, runnable minimal MCP; a description of every definition field and
hook, with an example of each; how to run, stop, restart, and debug the MCP; how to register the MCP with an
agent over stdio and over HTTP; how to call tools from the command line, with examples for every argument type,
for dotted names, for the `@` prefix, and for quoting in both cmd.exe and POSIX shells; how to mark a field as
a file path; the configuration file and the log level; and troubleshooting for a port in use, a server that will
not start, and a stale process id file.

#### Scenario: New author
- **WHEN** an author follows the README from an empty directory
- **THEN** they have a running MCP offering a tool, reachable over HTTP and over stdio, within the steps listed

#### Scenario: Example is tested
- **WHEN** the repository's tests run
- **THEN** the README's minimal example is built from a file that the tests execute, so the example cannot drift from the code

#### Scenario: Shell examples
- **WHEN** the README shows a command line with quoting
- **THEN** it shows how the same call is written in cmd.exe and in a POSIX shell

### Requirement: Public and self-contained

The framework SHALL be published as a public package with no dependency on any private package or service, and
its repository SHALL NOT contain credentials or the names of private projects.

#### Scenario: Install without private access
- **WHEN** a user without access to any private registry installs the framework
- **THEN** installation succeeds and every dependency resolves from the public registry
