---
schema_version: '1.0'
created:
  date: '2026-11-24T07:49:34.478Z'
  user: boonek
  agent:
    name: claude-code
    version: unknown
  llm:
    name: claude-sonnet-5-5
    version: '5.5'
  prompt_uri: >-
    prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~9e7343b6-3205-4e29-8416-e3780929ded3
  summary: doc/index.md documentation entry point
updated:
  - date: '2026-11-24T07:49:40.466Z'
    user: boonek
    agent:
      name: claude-code
      version: unknown
    llm:
      name: claude-sonnet-5-5
      version: '5.5'
    prompt_uri: >-
      prompt:/claude-code/d670cca5-e0f3-47c9-b239-7d358eabbeb6/~9e7343b6-3205-4e29-8416-e3780929ded3
    summary: Drop the RELEASING link until that file exists (group 15)
change_request: mcp-framework
---
# mcp-framework documentation

- [README](../README.md): what the framework provides, a five-minute example, and how to integrate an MCP: the
  launcher definition, writing tools, the server class, the command line, registering with a client,
  configuration, logging, the public contract and troubleshooting.
- [Design](../openspec/changes/mcp-framework/design.md): the decisions behind the framework and the alternatives
  that were considered.
- [Requirements](../openspec/changes/mcp-framework/specs): the specification of each capability.
- [Tasks](../openspec/changes/mcp-framework/tasks.md): the implementation checklist.
