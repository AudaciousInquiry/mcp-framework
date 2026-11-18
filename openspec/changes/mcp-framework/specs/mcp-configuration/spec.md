---
schema_version: '1.0'
created:
  date: '2026-11-18T13:14:57.616Z'
  user: boonek
  agent:
    name: claude-code
    version: 2.x
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~80990185-d187-4a21-8126-b18a46afb811
  summary: mcp-configuration spec for mcp-framework
updated:
  - date: '2026-11-18T14:03:42.545Z'
    user: boonek
    agent:
      name: claude-code
      version: 2.x
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~e148b5d8-e4eb-4d94-abe8-9e4b485b264f
    summary: >-
      init takes the same typed command-line arguments as call, typed from a
      settings schema
change_request: mcp-framework
---
## ADDED Requirements

### Requirement: Per-MCP configuration file in a data directory

Each MCP SHALL have its own data directory, `.mcp/<mcp-name>/` under the user's home directory, holding its
configuration file `config.json`, its process id file, and its logs. The framework SHALL create the directory
when it is first needed. The directory and file of one MCP SHALL NOT be shared with another.

#### Scenario: First run
- **WHEN** an MCP's configuration is loaded and no configuration file exists
- **THEN** the data directory is created and a configuration file holding the defaults is written

#### Scenario: Two MCPs
- **WHEN** two MCPs built on the framework run on the same machine
- **THEN** each reads and writes only its own directory

### Requirement: The MCP declares its defaults, including its port

The MCP SHALL supply its default settings when it plugs into the framework, and the default port SHALL be a
required part of them. The framework SHALL use the declared port unless the user's configuration file sets
another.

#### Scenario: Declared default
- **WHEN** an MCP declares port 7561 and the configuration file has no port
- **THEN** the server listens on 7561 and the CLI connects to 7561

#### Scenario: User override
- **WHEN** the configuration file sets a port
- **THEN** that port is used by the server, the launcher, the bridge, and the CLI

#### Scenario: Port not declared
- **WHEN** an MCP plugs in without declaring a default port
- **THEN** the framework refuses to start and says that a default port is required

### Requirement: Stored values over defaults

When a configuration is loaded, the stored values SHALL be merged over the defaults, so a setting added to the
MCP's defaults in a later version is present for users whose file predates it. Nested settings declared as
objects SHALL be merged key by key. Keys in the file that the defaults do not mention SHALL be kept.

#### Scenario: New default after upgrade
- **WHEN** a newer version adds a default setting and the user's file lacks it
- **THEN** the loaded configuration has the new setting at its default

#### Scenario: Nested object
- **WHEN** a default object has keys `a` and `b` and the file sets only `a`
- **THEN** the loaded object has the stored `a` and the default `b`

#### Scenario: Unknown key
- **WHEN** the file holds a key the defaults do not declare
- **THEN** the key is present in the loaded configuration and is preserved when the file is saved

### Requirement: Saving updates

The framework SHALL provide a way to save a partial set of settings, merging them into the stored
configuration and returning the full result. The MCP MAY supply a function that validates or normalizes
updates, such as clamping a number to a minimum or rejecting a bad value, and the framework SHALL apply it
before writing. A write SHALL NOT leave a truncated file if the process stops part way through.

#### Scenario: Partial update
- **WHEN** an update sets one setting
- **THEN** every other stored setting is unchanged and the full configuration is returned

#### Scenario: Zero is a real value
- **WHEN** an update sets a numeric setting to 0
- **THEN** 0 is stored and not replaced by the default

#### Scenario: MCP normalizes
- **WHEN** the MCP's function raises a value below its minimum
- **THEN** the adjusted value is what is written

#### Scenario: MCP rejects
- **WHEN** the MCP's function rejects a value
- **THEN** nothing is written and the caller receives the reason

#### Scenario: Interrupted write
- **WHEN** the process is killed while a save is in progress
- **THEN** the file holds either the complete old content or the complete new content

### Requirement: Invalid configuration is reported, not hidden

A configuration file that is not valid JSON, or whose port is not a whole number from 1 to 65535, SHALL
produce an error that names the file and the problem. The file SHALL NOT be overwritten with defaults in
that case.

#### Scenario: Corrupt file
- **WHEN** the file cannot be parsed
- **THEN** the command fails with a message naming the file and the parse error, and the file is left as it was

#### Scenario: Bad port
- **WHEN** the file sets the port to 0, 70000, or text
- **THEN** the command fails naming the setting and the allowed range

### Requirement: Init command

The launcher SHALL accept `init [json|@file] [arguments]`. The arguments SHALL be written and converted
exactly as for `call` (see the argument-mapping capability): `--port 7561`, `--no-name`, dotted names for
nested settings, quoting, comma-separated lists, dates, file paths, and the `@` prefix, with any JSON applied
first and the command-line arguments set on top. The types SHALL come from the MCP's settings schema, written
in Zod, which covers the framework's own settings as well; a setting with no declared type SHALL be typed from
the type of its default value. `init` SHALL work without a running server and SHALL NOT start one. When any
settings are given it SHALL save them without prompting. Without arguments it SHALL prompt for each setting the
framework and the MCP declared as promptable, showing the current value and keeping it when the user presses
Enter. It SHALL print the resulting configuration and how to start the server and register it with a client.

#### Scenario: Non-interactive with JSON
- **WHEN** `init '{"port":7561}'` is run
- **THEN** the port is saved and the full configuration is printed

#### Scenario: Non-interactive with arguments
- **WHEN** `init --port 7561 --log_level debug` is run
- **THEN** the port is saved as the number 7561 and the log level as the string `debug`

#### Scenario: JSON and arguments together
- **WHEN** `init @base.json --port 7562` is run
- **THEN** the settings in the file are applied first and the port is then set to 7562

#### Scenario: Nested setting
- **WHEN** `init --reindex_defaults.agent.name claude` is run and the setting is a nested object
- **THEN** only that field is set and the object's other fields are kept

#### Scenario: Unknown setting
- **WHEN** `init --prot 7561` is run and no such setting exists
- **THEN** the command fails naming `prot`, suggests `port`, and saves nothing

#### Scenario: Wrong type
- **WHEN** `init --port abc` is run
- **THEN** the command fails naming the setting and the value, and saves nothing

#### Scenario: Setting typed from its default
- **WHEN** a setting has no declared type and its default is a boolean, and `init --no-feature` is run
- **THEN** the setting is saved as false

#### Scenario: No server needed
- **WHEN** `init --port 7561` is run and the server has never been started
- **THEN** the setting is saved and no server is started

#### Scenario: Interactive
- **WHEN** `init` is run in a terminal and the user answers only the port prompt
- **THEN** the port is updated and the other settings keep their values

#### Scenario: Invalid answer
- **WHEN** the user enters a value that fails validation
- **THEN** the command reports why and saves nothing

#### Scenario: Next steps
- **WHEN** init finishes
- **THEN** it prints how to start the server and examples for registering it with a client over stdio and over HTTP
