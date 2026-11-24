---
schema_version: '1.0'
updated:
  - date: '2026-11-24T04:04:45.392Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~9e7343b6-3205-4e29-8416-e3780929ded3
    summary: README configuration section
change_request: mcp-framework
created:
  date: '2026-11-24T04:02:27.000Z'
  user: Keith W. Boone
---
# mcp-framework

A framework for local MCP servers: a detached HTTP daemon, a stdio bridge, a command-line client,
configuration and logging.

## What it is

## Five-minute example

## The launcher definition and the `ctx` object

## Writing tools

## The server class

## The command line

## Registering with a client

## Configuration

Each MCP has its own data directory, `~/.mcp/<name>/`, where `<name>` is the `name` in the MCP's
`package.json`. It holds `config.json`, the process id file `server.pid` and the `logs` folder.

The MCP declares its default settings, and `port` is required. Stored values in `config.json` are merged over the
defaults: nested objects merge key by key, arrays are replaced, and keys the defaults do not mention are kept.

Framework settings:

| Setting | Meaning | Default |
|---|---|---|
| `port` | Port on 127.0.0.1, a whole number from 1 to 65535 | declared by the MCP |
| `log_level` | `trace`, `debug`, `info`, `warn` or `error` | `info` |
| `maxBodyBytes` | Largest request body the server accepts | 1048576 (1 MB) |
| `drainMs` | How long a shutdown lets in-flight requests finish | 10000 |

**First run.** The launcher, the bridge and the command-line commands write the defaults to `config.json` when
the file is missing. The server never creates it; with no file it uses the defaults in memory. A file that is not
valid JSON, or a port outside 1 to 65535, stops the command with a message naming the file; the file is never
overwritten.

**Changed defaults.** Stored values win over defaults. A user whose file holds a value that a later version
of your MCP changes as a default keeps the old value.

**Saving.** The configuration object has a `save` function. `config.save()` stores the current settings,
including changes made in place. `config.save({ setting: value })` merges the update into a copy, runs your
`validate` function (return a normalized copy, or throw to reject), writes the file by temporary file and rename,
and only then updates the object in memory. A rejected update changes nothing.

## Logging

## Things worth knowing
