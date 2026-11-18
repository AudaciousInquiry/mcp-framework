---
schema_version: '1.0'
created:
  date: '2026-11-18T13:12:57.665Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: stdio-bridge spec for mcp-framework
updated: []
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Bridge mode for stdio-only clients

The launcher SHALL accept a stdio option that makes the launching process a bridge between an MCP client
speaking over standard input and output and the MCP's HTTP server. The bridge SHALL make sure the server is
running, starting it if needed, before it begins forwarding.

#### Scenario: Server not running when the client launches the bridge
- **WHEN** a client launches the MCP with the stdio option and no server is running
- **THEN** the server is started in the background and, once healthy, the bridge begins forwarding

#### Scenario: Server already running
- **WHEN** a client launches the bridge and a healthy server is already running
- **THEN** the bridge connects to it and does not start another

#### Scenario: Server cannot be started
- **WHEN** the server cannot be started or never becomes healthy
- **THEN** the bridge writes the reason to standard error and exits with a non-zero status without writing anything to standard output

### Requirement: Transparent message passthrough

The bridge SHALL forward every protocol message from the client to the server and every message from the
server to the client without interpreting or changing it. The initialize handshake, tool listing, tool
calls, and notifications SHALL flow through like any other message.

#### Scenario: Round trip
- **WHEN** the client sends a tool call through the bridge
- **THEN** the server receives that exact message and the server's response is delivered to the client unchanged

#### Scenario: Server-initiated message
- **WHEN** the server sends a message that is not a response to a request
- **THEN** the bridge delivers it to the client

#### Scenario: Several clients
- **WHEN** several bridge processes connect to the same server
- **THEN** each carries its own client's traffic and none sees another's

### Requirement: Standard output carries only protocol messages

While running as a bridge, the process SHALL write nothing but protocol messages to standard output. All
diagnostic text, including startup notices, SHALL go to standard error.

#### Scenario: Server started by the bridge
- **WHEN** the bridge has to start the server
- **THEN** the "server started" notice is written to standard error, not standard output

#### Scenario: Forwarding problem
- **WHEN** a message cannot be forwarded
- **THEN** the problem is reported on standard error and standard output stays a clean protocol stream

### Requirement: Bridge lifetime follows the client

The bridge SHALL run until the client closes standard input, then exit. It SHALL NOT stop the server when it
exits, because other clients may be using it.

#### Scenario: Client disconnects
- **WHEN** the client closes its end of standard input
- **THEN** the bridge closes its connection to the server and exits with status zero
- **AND** the server keeps running

### Requirement: Recover from server death without dropping the client

When the connection to the server closes unexpectedly, the bridge SHALL restart the server, reconnect, and
keep the client connected, so the client does not have to restart the MCP. Messages the client sends while
the bridge is reconnecting SHALL be held and forwarded after the reconnect. A request that was already in
flight when the server died and cannot be completed SHALL receive an error response carrying the same
request id, so the client is not left waiting.

#### Scenario: Server crashes between calls
- **WHEN** the server dies while the client is idle and the client then sends a tool call
- **THEN** the bridge restarts the server, reconnects, forwards the call, and returns its result

#### Scenario: Server crashes during a call
- **WHEN** the server dies while a request is in flight
- **THEN** the client receives an error response for that request, and later requests succeed against the restarted server

#### Scenario: Client message arrives during reconnect
- **WHEN** the client sends a request while the bridge is restarting the server
- **THEN** the request is forwarded once the reconnect completes and its response is returned normally

#### Scenario: Recovery fails
- **WHEN** the server cannot be restarted within the respawn timeout
- **THEN** the bridge reports the failure on standard error, closes the client connection, and exits non-zero

#### Scenario: Several bridges recover together
- **WHEN** several bridges notice the same server death
- **THEN** one server is started, all bridges reconnect to it, and none exits because of the others

### Requirement: Start-up hook for the plugin

The framework SHALL let the MCP supply a function that runs once, after the server is healthy and before the
bridge begins forwarding, with access to the server's tools through the same client interface the command
line uses. A failure in this function SHALL be logged and SHALL NOT prevent the bridge from starting.

#### Scenario: Hook runs first
- **WHEN** the MCP supplied a bridge start-up hook
- **THEN** the hook completes before the first client message is forwarded

#### Scenario: Hook fails
- **WHEN** the hook throws
- **THEN** the error and stack trace are logged to standard error and the bridge starts anyway
