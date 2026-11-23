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
updated:
  - date: '2026-11-23T15:35:54.032Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~6d7ab145-3d21-4ab9-86d0-f139b2710742
    summary: Bridge start-up hook runs again after every respawn
  - date: '2026-11-20T22:39:17.832Z'
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
      Requests during reconnect get an immediate error response instead of being
      held
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
keep the client connected, so the client does not have to restart the MCP. A request that cannot be
completed because the server died, whether it was already in flight or arrives while the bridge is
reconnecting, SHALL receive an error response carrying the same request id, so the client fails fast and
can retry instead of waiting for its own timeout. The bridge SHALL NOT hold requests for later forwarding.

#### Scenario: Server crashes between calls
- **WHEN** the server dies while the client is idle, the bridge finishes reconnecting, and the client then sends a tool call
- **THEN** the call is forwarded to the restarted server and its result is returned

#### Scenario: Server crashes during a call
- **WHEN** the server dies while a request is in flight
- **THEN** the client receives an error response for that request, and later requests succeed against the restarted server

#### Scenario: Client message arrives during reconnect
- **WHEN** the client sends a request while the bridge is restarting the server
- **THEN** the client receives an error response carrying that request's id right away, and the request is not forwarded later
- **AND** requests sent after the reconnect completes succeed normally

#### Scenario: Recovery fails
- **WHEN** the server cannot be restarted within the respawn timeout
- **THEN** the bridge reports the failure on standard error, closes the client connection, and exits non-zero

#### Scenario: Several bridges recover together
- **WHEN** several bridges notice the same server death
- **THEN** one server is started, all bridges reconnect to it, and none exits because of the others

### Requirement: Start-up hook for the plugin

The framework SHALL let the MCP supply a function that runs after the server is healthy and before the
bridge begins forwarding, and again each time the bridge has restarted the server, with access to the server's tools through the same client interface the command
line uses. A failure in this function SHALL be logged and SHALL NOT prevent the bridge from starting.

#### Scenario: Hook runs first
- **WHEN** the MCP supplied a bridge start-up hook
- **THEN** the hook completes before the first client message is forwarded

#### Scenario: Hook runs again after a respawn
- **WHEN** the bridge restarts a server that died
- **THEN** the hook runs again once the new server is healthy and before forwarding resumes, so state the hook set up on the server is restored

#### Scenario: Hook fails
- **WHEN** the hook throws
- **THEN** the error and stack trace are logged to standard error and the bridge starts anyway
