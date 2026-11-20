---
schema_version: '1.0'
created:
  date: '2026-11-18T13:12:25.936Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: http-mcp-server spec for mcp-framework
updated:
  - date: '2026-11-20T22:39:11.740Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~11091216-f733-4bdf-8e35-9211803e7e81
    summary: >-
      Drop server name from /health; uptime_seconds is a number; identify port
      occupant by pid vs process id file
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: MCP over HTTP on loopback only

The server SHALL serve the Model Context Protocol over HTTP at the root path of the configured port, and
SHALL bind only to the loopback interface. It SHALL NOT be reachable from other machines.

#### Scenario: Client connects over loopback
- **WHEN** an MCP client connects to `http://127.0.0.1:<port>/`
- **THEN** the initialize handshake, tool listing, and tool calls work

#### Scenario: Not reachable from the network
- **WHEN** a connection is attempted to the machine's non-loopback address on the configured port
- **THEN** the connection is refused

#### Scenario: Unknown route
- **WHEN** a request is made to any route that is neither the MCP route, the health route, nor the shutdown route
- **THEN** the response is 404

### Requirement: Stateless request handling

The server SHALL hold no MCP session state. Each request SHALL be handled independently, and the server
SHALL NOT issue or require a session identifier. Restarting the server SHALL lose nothing that a client
depends on, so a client can continue after a restart without re-initializing.

#### Scenario: Call after restart
- **WHEN** a client sends a tool call to a server that has been restarted since the client last connected
- **THEN** the call succeeds without a new initialize handshake

#### Scenario: No session header
- **WHEN** a client sends requests without any session identifier
- **THEN** every request is handled the same as any other

#### Scenario: Concurrent clients
- **WHEN** several clients call tools at the same time
- **THEN** each call is handled independently and none interferes with another's request or response

#### Scenario: State that must outlive a request
- **WHEN** a tool needs state that spans requests (for example a pagination cursor)
- **THEN** the MCP keeps it in its own storage, not in per-connection state, and the framework gives the MCP a place that lives as long as the server process

### Requirement: Tool registration from the plugin

For every request the server SHALL make the MCP's tools available by calling the MCP's tool registration
function, and SHALL present the tool names, descriptions, and input schemas exactly as the MCP defines them.

#### Scenario: Tool list
- **WHEN** a client lists tools
- **THEN** it receives every tool the MCP registered, each with its description and input schema

#### Scenario: Registration failure
- **WHEN** the MCP's registration function throws
- **THEN** the request fails with a 500 response carrying an error message, and the server keeps running

### Requirement: Tool errors are results, not transport failures

A tool that reports a failure SHALL produce a normal MCP response marked as an error, with the message in
its text content. An unexpected exception outside a tool handler SHALL produce a 500 response with a JSON
error body, unless response headers were already sent.

#### Scenario: Tool reports an error
- **WHEN** a tool handler returns an error result
- **THEN** the client receives an HTTP 200 MCP response whose result is flagged as an error

#### Scenario: Unexpected exception
- **WHEN** the server throws while handling an MCP request before sending headers
- **THEN** the response is 500 with a JSON body containing the error message

#### Scenario: Malformed JSON body
- **WHEN** a request body is not valid JSON
- **THEN** the protocol layer rejects it with an error response, and the server keeps running

### Requirement: Health endpoint

`GET /health` SHALL return status 200 with a JSON body containing at least: `status` (`"ok"`), `version`,
`pid`, and `uptime_seconds` (a whole number of seconds; the unit is part of the name). The body SHALL NOT
include a server name: the MCP's name is already known to anyone who can reach its data directory or
launcher. The MCP MAY add its own fields.

#### Scenario: Base fields
- **WHEN** a client requests `/health` on a running server
- **THEN** the body has `status`, `version`, `pid`, and `uptime_seconds`, and `uptime_seconds` is a number

#### Scenario: Plugin adds fields
- **WHEN** the MCP supplied a health extension function
- **THEN** its fields appear in the body alongside the base fields

#### Scenario: Plugin cannot overwrite base fields
- **WHEN** the MCP's extension returns a field with the same name as a base field
- **THEN** the base field's value is kept

#### Scenario: Extension throws
- **WHEN** the MCP's health extension throws
- **THEN** the endpoint still returns 200 with the base fields and an indication that the extension failed, so launchers and clients can still tell the server is up

### Requirement: Port-in-use identification

When the configured port is already bound, the server SHALL read the occupant's health response to decide
what to do. The occupant is this MCP when the `pid` in its health response equals the process id recorded
in this MCP's own process id file (each MCP has its own data directory, so the file identifies the MCP). If
the health response answers but the file does not exist yet, the server SHALL wait briefly and check again,
because the occupant writes the file just after binding the port. An occupant that is this MCP makes the
new process exit quietly with status zero; any other occupant is reported and the process exits non-zero.

#### Scenario: Same MCP already running
- **WHEN** the port is in use and `/health` answers with a `pid` that matches this MCP's process id file
- **THEN** the new process logs that it is already running and exits with status zero

#### Scenario: Occupant is still writing its process id file
- **WHEN** the port is in use, `/health` answers, and the process id file does not exist yet
- **THEN** the new process waits briefly and checks again before deciding, so two processes started together do not report each other as conflicts

#### Scenario: Different program on the port
- **WHEN** the port is in use and `/health` is missing, not JSON, has no `pid`, or has a `pid` that does not match this MCP's process id file
- **THEN** the new process logs the conflict, including the response when there is one, and exits with a non-zero status

#### Scenario: Other bind errors
- **WHEN** binding fails for a reason other than the port being in use
- **THEN** the server logs the error and exits with a non-zero status

### Requirement: Tool call observability

The server SHALL log the start and the outcome of every tool call, with the tool name, the elapsed time,
and success or failure, so a slow or failing call can be found afterwards.

#### Scenario: Successful call
- **WHEN** a tool call completes
- **THEN** the log has a start entry and an end entry with the tool name and duration

#### Scenario: Failing call
- **WHEN** a request fails with an exception
- **THEN** the log has an error entry with the tool name, duration, message, and stack trace
