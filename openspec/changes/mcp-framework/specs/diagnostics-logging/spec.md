---
schema_version: '1.0'
created:
  date: '2026-11-18T13:19:23.707Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: diagnostics-logging spec for mcp-framework
updated:
  - date: '2026-11-23T20:09:08.105Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~f8e179ac-6bee-4bae-b41b-941d801448f1
    summary: >-
      Add launcher --log-level option; precedence option, environment, setting,
      default
  - date: '2026-11-23T14:13:31.658Z'
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
      No captured standard error file; trace goes to log or inherited standard
      error
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Rotating log file

The server SHALL write its log to `server.log` in the `logs` folder of the MCP's data directory. The log SHALL
roll over each day and when a file reaches 10 MB, and SHALL keep the 7 most recent files. Each line SHALL
carry a timestamp, a level, the name of the part of the program that wrote it, and the message.

#### Scenario: Normal logging
- **WHEN** the server logs a message
- **THEN** a line with timestamp, level, category, and message is appended to the log file

#### Scenario: Daily roll-over
- **WHEN** the date changes
- **THEN** a new log file is started and no more than 7 old files are kept

#### Scenario: Size roll-over
- **WHEN** the current file reaches 10 MB
- **THEN** a new file is started

#### Scenario: Log folder not writable
- **WHEN** the log file cannot be opened
- **THEN** the server writes its log lines to standard error and keeps running

### Requirement: Configurable log level

The log level SHALL default to `info` and SHALL be settable in the MCP's configuration as `log_level` with the
values `trace`, `debug`, `info`, `warn`, and `error`. An environment variable named after the MCP SHALL
override the setting for one run: the MCP name in upper case with dashes replaced by underscores, followed by
`_LOG_LEVEL` (for example `MY_MCP_LOG_LEVEL` for `my-mcp`). The launcher SHALL also accept `--log-level <level>`, which
applies to the server that command starts and overrides both the environment variable and the setting; a
server that is already running keeps its level. The level SHALL apply in worker threads the MCP
starts as well as in the main thread.

#### Scenario: Default
- **WHEN** no level is configured
- **THEN** messages at `info` and above are written and `debug` messages are not

#### Scenario: Configured level
- **WHEN** the configuration sets `log_level` to `debug`
- **THEN** `debug` messages are written

#### Scenario: Environment override
- **WHEN** the environment variable is set to `error` and the configuration says `debug`
- **THEN** only `error` messages are written for that run

#### Scenario: Launcher option
- **WHEN** the launcher starts a server with `--log-level debug` while the environment variable says `error`
- **THEN** that server writes `debug` messages

#### Scenario: Option and a running server
- **WHEN** the launcher is run with `--log-level debug` and a server is already running
- **THEN** the running server keeps its level, and the launcher says the option was not applied and that a restart is needed

#### Scenario: Invalid level
- **WHEN** the level is not one of the five values
- **THEN** startup fails naming the setting and the allowed values

#### Scenario: Worker thread
- **WHEN** the MCP starts a worker thread and the worker logs a message
- **THEN** the message is written to the same log with the same level rules

### Requirement: Debug mirror to the terminal

When started with the debug option, the server SHALL write its log lines to standard error as well as to the
file, and SHALL NOT change the log level on its own.

#### Scenario: Debug option
- **WHEN** the server is started with the debug option
- **THEN** every line written to the file also appears on standard error

### Requirement: Named loggers for the plugin

The framework SHALL give the MCP a way to get a named logger, so that the MCP's own code logs to the same
file, with the same format, level, and rotation as the framework.

#### Scenario: Plugin logger
- **WHEN** the MCP gets a logger named `indexer` and logs a message
- **THEN** the line appears in the server log with category `indexer`

### Requirement: Fatal errors always leave a trace

Uncaught exceptions and unhandled promise rejections, in the launcher, the server, and the bridge, SHALL be
written with their stack trace before the process exits with a non-zero status. A failure that happens outside
the main startup chain, such as in a timer or a callback that nobody awaits, SHALL be covered.

#### Scenario: Exception in a timer
- **WHEN** a timer callback in the server throws
- **THEN** the message and stack trace are written and the process exits non-zero

#### Scenario: Unhandled rejection
- **WHEN** a promise is rejected and nothing handles it
- **THEN** the reason and stack trace are written and the process exits non-zero

#### Scenario: Server started in the background
- **WHEN** a background server dies from such an error
- **THEN** the trace is in the log file, or on the standard error the server inherited from the launcher, so the cause can be found afterwards

### Requirement: Tool and request timing is logged

Start and end of every tool call SHALL be logged at `info` with the tool name and duration, so that a slow call
can be traced afterwards (see the HTTP server's observability requirement). Operations a plugin runs on the
main thread MAY be timed with a helper the framework provides, which SHALL cost nothing beyond a function call
unless the level is `debug` or lower.

#### Scenario: Slow call
- **WHEN** a tool call takes 20 seconds
- **THEN** the log's end entry for that call shows about 20 seconds

#### Scenario: Timing helper at default level
- **WHEN** the plugin wraps a job in the timing helper and the level is `info`
- **THEN** the job runs as if unwrapped and nothing extra is logged

#### Scenario: Timing helper at debug level
- **WHEN** the same job runs at level `debug` and it blocks the main thread longer than a configured threshold
- **THEN** a log line names the job and how long it held the thread
