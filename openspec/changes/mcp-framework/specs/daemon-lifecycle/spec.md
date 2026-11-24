---
schema_version: '1.0'
created:
  date: '2026-11-18T13:11:55.503Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: daemon-lifecycle spec for mcp-framework
updated:
  - date: '2026-11-24T15:00:12.220Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~3d33f0d5-21dc-4cb4-a45b-87cd381b62aa
    summary: >-
      Process id file holds the shutdown token; kill only a process the file
      names
  - date: '2026-11-23T14:13:29.028Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~2c55edeb-4548-4656-9210-b0d58b24d1cb
    summary: >-
      Server standard error is inherited from the launcher, not captured to a
      file
  - date: '2026-11-21T17:33:20.737Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~396f0a69-9a9a-4adb-a527-4de3d9718030
    summary: Startup timeout reports and leaves the new server running; no kill
  - date: '2026-11-21T16:45:15.680Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~baac6f7a-02f4-4973-a8ef-c61895f56901
    summary: >-
      Replace busy-is-not-dead retry with an advisory report: refused connection
      starts a server; silent connection is reported, never killed
  - date: '2026-11-21T16:25:24.802Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~4d54a732-1d43-4d70-82ef-b57c1f6aa41a
    summary: Port-in-use scenario wording follows the shape-only identification
  - date: '2026-11-20T22:39:13.737Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~11091216-f733-4bdf-8e35-9211803e7e81
    summary: Port-in-use scenario no longer relies on a server name in /health
  - date: '2026-11-20T22:20:17.345Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~dfd27b0f-5b6e-4cab-aea6-e1ce81ef0e0a
    summary: >-
      Restart no longer replaces a newer running server; user stops it first
      (aligns spec with the launcher help text)
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Start on demand and wait until healthy

Running the MCP's launcher with no arguments SHALL start the server as a detached background process
that outlives the launcher, then wait until the server answers its health check before reporting
success. The launcher SHALL NOT report success until the server is healthy.

#### Scenario: Server not running
- **WHEN** the launcher is run and no server is listening on the configured port
- **THEN** a detached server process is started
- **AND** the launcher prints that the server started, with its process id, once the health check passes
- **AND** the launcher exits while the server keeps running

#### Scenario: Server exits during startup
- **WHEN** the started server process exits before becoming healthy
- **THEN** the launcher reports that the server exited prematurely, including the exit code
- **AND** exits with a non-zero status

#### Scenario: Server never becomes healthy
- **WHEN** the server is still not healthy after the startup timeout
- **THEN** the launcher reports the timeout, says the server may still be starting, names its process id and the log file, and exits non-zero
- **AND** the process it started is left running, because only an explicit stop or restart ends a server

#### Scenario: Server output
- **WHEN** the server is started in the background
- **THEN** its standard output is discarded and its standard error is the launcher's own standard error
- **AND** where the server's log lines go is decided by the server's logging configuration, so a failure before the logger starts appears on the console the launcher was run from

### Requirement: Single instance per port

At most one server per MCP SHALL run on a given port. A second start request while the server is healthy
at the same version SHALL succeed without starting another process.

#### Scenario: Launcher run while the same version is running
- **WHEN** the launcher is run and a healthy server of the same version is already running
- **THEN** the launcher reports that it is already running and exits with status zero without starting a process

#### Scenario: Concurrent starts
- **WHEN** several launchers start a server at the same moment
- **THEN** exactly one server binds the port and the others exit without error
- **AND** every launcher ends up reporting a healthy server

#### Scenario: Port held by something else
- **WHEN** the configured port is in use by a process whose health response does not have the base fields (see the HTTP server's port-in-use identification)
- **THEN** the server reports that the port is held by another process and exits non-zero

### Requirement: Version-aware start

When a server is already running, a start request SHALL compare the running version, reported by the
health endpoint, with the launcher's own version.

#### Scenario: Running server is older
- **WHEN** the launcher is run and the running server reports an older version than the launcher
- **THEN** the older server is stopped and the launcher's version is started in its place

#### Scenario: Running server is newer
- **WHEN** the launcher is run, with or without the restart option, and the running server reports a newer version
- **THEN** the launcher reports that a newer version is running, leaves it alone, and exits non-zero
- **AND** the message tells the user to stop the server with the stop command, after which a normal start succeeds

#### Scenario: Pre-release and build suffixes
- **WHEN** versions carry pre-release or build suffixes such as `1.2.3-beta.1+build5`
- **THEN** the comparison uses only the numeric major, minor, and patch parts

### Requirement: Explicit restart

The launcher SHALL accept a restart option that stops the running server, if any, and starts the launcher's
version in its place. A running server that is newer than the launcher SHALL NOT be replaced (see
Version-aware start); the user stops it with the stop command first. Configuration and data SHALL be preserved.

#### Scenario: Restart a running server
- **WHEN** the launcher is run with the restart option and a server is running
- **THEN** the server is stopped and a new one is started and reported healthy

#### Scenario: Restart when nothing is running
- **WHEN** the launcher is run with the restart option and no server is running
- **THEN** the launcher reports that the server was not running and starts it

### Requirement: Graceful stop with kill fallback

Stopping a server SHALL first ask it to shut down through a shutdown request on its HTTP interface, so
the server can finish its own cleanup, and SHALL fall back to terminating the process only when that
fails. The wait for a graceful exit SHALL be longer than the server's own drain time so that a busy server
is not killed mid-shutdown. After stopping, the launcher SHALL wait for the port to be free.

#### Scenario: Server honors the shutdown request
- **WHEN** a stop is requested and the server answers the shutdown request
- **THEN** the launcher waits for the process to exit and reports the stop as graceful

#### Scenario: Server cannot be asked to shut down
- **WHEN** the shutdown request times out or is not understood (for example an older server without the route)
- **THEN** the launcher terminates the process, escalating to a forced kill if it does not exit within the allowed time, and reports that it was killed

#### Scenario: Port reuse after stop
- **WHEN** a stop completes
- **THEN** the launcher returns only after the port no longer accepts connections, so an immediate start does not fail on a port in use

#### Scenario: Shutdown route is local only
- **WHEN** the shutdown route is called
- **THEN** it is reachable only through the loopback interface the server is bound to, and it is not presented to MCP clients as a tool

### Requirement: Stop command

The launcher SHALL accept a stop option that stops a running server and exits without starting one.

#### Scenario: Stop a running server
- **WHEN** the launcher is run with the stop option and a server is running
- **THEN** the server's process id and version are reported, it is stopped, and the launcher reports how it stopped

#### Scenario: Nothing to stop
- **WHEN** the launcher is run with the stop option and no server is running
- **THEN** the launcher reports that the server is not running and exits with status zero

### Requirement: An unresponsive server is reported, not killed

When a health check gets no answer, the launcher SHALL tell a server that is gone from one that is merely
not answering. A refused connection means nothing is listening, so no server is running and the launcher
starts one. A connection that is accepted but gets no answer within the check's timeout means a server is
running and may be busy. In that case the launcher SHALL NOT stop it and SHALL NOT retry in a loop; it SHALL
report that the server is not answering and may be busy, and exit non-zero. The report is advice only. Only
an explicit stop or restart ever ends a running server.

#### Scenario: Nothing is listening
- **WHEN** the health check's connection is refused
- **THEN** a stale process id file, if there is one, is removed and a new server is started without waiting

#### Scenario: Server connected but not answering
- **WHEN** the health check connects but gets no answer within its timeout
- **THEN** the launcher reports that the server is not answering and may be busy, names its process id when the process id file names a running process, and says the stop command ends it
- **AND** the server is left running and the launcher exits non-zero

### Requirement: Process id file

The server SHALL write its process id, and the bearer token its shutdown route requires, to a file in the MCP's
data directory only after it has bound its port, readable by the owner only where the system allows, and SHALL
remove the file when it shuts down. A stop SHALL send the token only to a server whose reported process id is the
one in the file, and SHALL NOT kill a process the file does not name.

#### Scenario: Written after binding
- **WHEN** the server starts
- **THEN** the process id file does not exist until the port is bound successfully

#### Scenario: Stale file
- **WHEN** the process id file names a process that is not running
- **THEN** the file is removed and startup continues

### Requirement: Crash recovery by respawn

The launcher SHALL provide a way to restart a crashed server that is safe to call from several processes at
once, so that clients holding open connections can recover. The port bind SHALL be the only coordination:
callers that lose the race exit silently, and all callers wait for a healthy response.

#### Scenario: Several callers respawn at once
- **WHEN** a server has crashed and several callers request a respawn together
- **THEN** one new server runs and every caller returns after the server is healthy

#### Scenario: Respawn fails
- **WHEN** no healthy server appears within the respawn timeout
- **THEN** the respawn reports failure to its caller

### Requirement: Graceful shutdown sequence

On a termination signal or a shutdown request, the server SHALL stop accepting new connections, give
in-flight requests up to a configured drain time to finish, close the rest, run the MCP's shutdown
cleanup, remove the process id file, and exit with status zero. The cleanup SHALL complete before the
process exits. A second shutdown request while one is in progress SHALL be ignored.

#### Scenario: In-flight request during shutdown
- **WHEN** shutdown starts while a request is in flight and the request finishes within the drain time
- **THEN** the request completes normally before the connection is closed

#### Scenario: Request outlasts the drain time
- **WHEN** a request is still running when the drain time ends
- **THEN** its connection is destroyed and shutdown continues

#### Scenario: MCP cleanup hook
- **WHEN** the MCP supplied a shutdown hook
- **THEN** the hook runs after connections drain and finishes before the process exits

#### Scenario: Repeated signals
- **WHEN** a second signal arrives while shutdown is running
- **THEN** it has no effect

### Requirement: Debug mode

The launcher SHALL accept a debug option that starts the server with its log output mirrored to the
terminal in addition to the log file.

#### Scenario: Debug start
- **WHEN** the launcher is run with the debug option
- **THEN** server log lines appear on the terminal and are also written to the log file
