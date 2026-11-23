---
schema_version: '1.0'
created:
  date: '2026-11-18T13:13:19.118Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: cli-client spec for mcp-framework
updated:
  - date: '2026-11-23T22:12:24.721Z'
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
      Reconcile cli-client: list and help work without a server, tools from the
      shared file, fuller help
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Query commands never start the server

The `health` and `call` commands SHALL act on a server that is already running, and no query command SHALL
start one as a side effect. `list`, `call <tool> --help`, and argument errors need no server, because the tool
schemas are read from the MCP's shared tools file. A command whose purpose is to ask whether the server is running, or what it can do,
must not change whether it is running.

#### Scenario: Server not running
- **WHEN** `health` or `call` is run and nothing is listening on the configured port
- **THEN** the command reports that the MCP is not reachable on that port and tells the user to start it with the launcher
- **AND** exits with a non-zero status
- **AND** no server process is started

#### Scenario: Short wait when unreachable
- **WHEN** the server does not answer
- **THEN** the command gives up within a few seconds instead of hanging

#### Scenario: Commands that need no server
- **WHEN** `list` or `call <tool> --help` is run and nothing is listening
- **THEN** the command works from the shared tools file and no server is started

### Requirement: Health command

`health` SHALL print the server's health response as formatted JSON.

#### Scenario: Healthy server
- **WHEN** `health` is run against a running server
- **THEN** the full health body is printed as indented JSON and the exit status is zero

#### Scenario: Unhealthy response
- **WHEN** the health route answers with a status other than 200 or with a body that is not JSON
- **THEN** the command reports what it received and exits with a non-zero status

### Requirement: List command

`list` SHALL print every tool declared in the MCP's shared tools file, with its description, and under each tool its parameters,
showing each parameter's name, type, whether it is required, and its description.

#### Scenario: Tool with parameters
- **WHEN** `list` is run against a server with a tool that has one required string parameter and one optional number parameter
- **THEN** the output shows the tool name and description followed by both parameters, marked required and optional

#### Scenario: Type display
- **WHEN** a parameter is an enumeration or an array
- **THEN** the type is shown as the allowed values (for example `enum(a|b)`) or the element type (for example `string[]`)

#### Scenario: Nested object parameter
- **WHEN** a parameter is an object
- **THEN** it is shown with type `object` and its own fields are not expanded in the list

#### Scenario: Tool registered at run time
- **WHEN** the server registers a tool that is not in the shared tools file
- **THEN** `list` does not show it

#### Scenario: Tool without parameters
- **WHEN** a tool takes no parameters
- **THEN** its name and description are printed with no parameter lines

### Requirement: Call command

`call <tool> [arguments]` SHALL invoke the named tool on the running server and print the tool's text result
to standard output. The arguments can be given as a JSON object or, as specified by the argument-mapping
capability, as ordinary command-line arguments.

#### Scenario: Successful call
- **WHEN** `call` is run with a tool name and valid arguments
- **THEN** the tool's text content is printed to standard output and the exit status is zero

#### Scenario: Tool reports an error
- **WHEN** the tool returns a result flagged as an error
- **THEN** its text is printed to standard error and the exit status is non-zero

#### Scenario: Missing tool name
- **WHEN** `call` is run without a tool name
- **THEN** a usage message is printed and the exit status is non-zero

#### Scenario: Unknown tool
- **WHEN** the named tool is not in the shared tools file and no JSON arguments are given
- **THEN** the command reports that the tool is unknown and exits with a non-zero status

#### Scenario: Tool registered at run time
- **WHEN** `call` names a tool that is not in the shared tools file and the arguments are JSON
- **THEN** the JSON is sent to the server as it is
- **AND** flag-style arguments for that tool are rejected with a message saying the tool has no declared schema

#### Scenario: Non-text content
- **WHEN** the tool's result contains content that is not text
- **THEN** only the text items are printed, joined by newlines

### Requirement: JSON arguments inline or from a file

A JSON object given as the call's argument SHALL be read as the tool's arguments. A value starting with `@`
SHALL be read as a path to a file containing the JSON, which avoids shell quoting problems on Windows where
the shell alters embedded quotes in an inline argument.

#### Scenario: Inline JSON
- **WHEN** `call tool '{"a":1}'` is run
- **THEN** the tool receives `{ "a": 1 }`

#### Scenario: JSON from a file
- **WHEN** `call tool @args.json` is run and the file contains a JSON object
- **THEN** the tool receives that object

#### Scenario: Invalid JSON
- **WHEN** the argument is not valid JSON
- **THEN** the command reports that the arguments must be valid JSON, with the parse error, and exits non-zero without calling the tool

#### Scenario: Missing file
- **WHEN** an `@` path does not exist
- **THEN** the command reports the missing file and exits non-zero without calling the tool

### Requirement: User errors are short messages

Problems caused by the user's input SHALL be reported as a one-line message prefixed with the MCP's name. Only
unexpected failures SHALL include a stack trace.

#### Scenario: Bad input
- **WHEN** the user supplies invalid arguments
- **THEN** the output is a single message line and not a stack trace

#### Scenario: Unexpected failure
- **WHEN** the command fails for a reason that is not the user's input
- **THEN** the message includes the stack trace and the exit status is non-zero

### Requirement: Plugin may supply default arguments

The framework SHALL let the MCP supply a function that receives the tool name and the assembled arguments
before a `call` is sent and may return adjusted arguments. This lets an MCP add arguments that a human at a
terminal cannot reasonably supply, such as an identity for provenance, without the framework knowing about them.

#### Scenario: Plugin fills a missing field
- **WHEN** the MCP's function adds a field that the user did not supply
- **THEN** the tool receives the added field

#### Scenario: User's value wins
- **WHEN** the user supplied a value for a field the MCP's function would default
- **THEN** the MCP's function does not overwrite it

#### Scenario: No function supplied
- **WHEN** the MCP supplied no such function
- **THEN** the arguments are sent as assembled

### Requirement: Help

The launcher SHALL print usage when run with `--help` or `-h`, covering its options, the `health`, `list`, `call`,
and `init` commands, the start, stop, restart, `--stdio`, `--debug` and `--log-level` options, the configuration
file location, and the default port for this MCP. It SHALL include the
help text for any options the MCP added.

#### Scenario: Help output
- **WHEN** the launcher is run with `--help`
- **THEN** usage for every framework option and command is printed, with this MCP's name and default port, and the process exits with status zero

#### Scenario: Plugin option help
- **WHEN** the MCP declared extra options with help text
- **THEN** that text appears in the help output
