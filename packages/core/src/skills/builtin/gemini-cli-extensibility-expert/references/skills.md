# Agent Skills

Agent Skills are modular packages that provide specialized knowledge, workflows,
and tools to the agent.

## File Locations

- **Project Skills**: `.gemini/skills/` (**Preferred for development and
  iteration**)
- **User Skills**: `~/.gemini/skills/` (manually added for global use)
- **Extension Skills**: `skills/` directory within an extension folder.

## Skill Structure

A skill is a directory containing a `SKILL.md` file and optional resource
directories.

```
my-skill/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description)
│   └── Markdown instructions
├── scripts/    - Executable code
├── references/ - Documentation to be loaded as needed
└── assets/     - Templates, boilerplate, etc.
```

### SKILL.md

The `SKILL.md` file defines the skill's identity and provides its core
instructions.

#### Frontmatter (YAML)

```yaml
---
name: my-skill
description:
  'Briefly explain WHAT the skill does and WHEN to use it. This is the primary
  triggering mechanism.'
---
```

#### Body (Markdown)

Contains detailed instructions for the agent on how to use the skill and its
resources.

## Discovery and Reloading

- **New Sessions**: Skills are automatically discovered whenever Gemini CLI
  starts.
- **Active Sessions**: **The user** can run `/skills reload` in an interactive
  session to rediscover skills without restarting.

## Best Practices

- **Concise**: Only include context the agent doesn't already have.
- **Progressive Disclosure**: Use `references/` for detailed docs and link to
  them from `SKILL.md`.
- **Scripts**: Use scripts for deterministic tasks or complex logic.
- **Tone**: Use an imperative tone (e.g., "Analyze the logs").

## Verification

To validate that a skill is correctly discovered and can be activated:

1.  **Verification Choice**: **Ask the user first** if they want to verify
    **manually** (interactive session, requires `/skills reload`) or have
    **you** (the agent) verify it on their behalf. Mention that agent-led
    verification involves the agent invoking itself headlessly and will require
    extra confirmations.
2.  **Security WARNING**: If the user chooses agent-led verification, **you must
    explicitly WARN them** that you will be invoking Gemini CLI on their behalf
    and will need to allow-list the tools required for verification (including
    `activate_skill`). This means those tools will run without further
    confirmation for that specific command.
3.  **Confirmation & Invocation**: Once the user provides verbal confirmation,
    inform them you are using the `--allowed-tools` flag and then execute the
    targeted headless command:
    `gemini --debug --allowed-tools activate_skill,<minimal_tools> "your targeted prompt"`
4.  **Troubleshooting**: Inspect the `--debug` logs to verify skill discovery
    and activation within the new process.
5.  **UI List**: **The user** can use `/skills list` in an interactive session
    (after a reload) to see the skill's status.

**Note**: You must include `activate_skill` and any _modifying_ tools the skill
intends to use in the `--allowed-tools` list. Read-only tools like `read_file`
are permitted by default headlessly.

## Documentation

For more information, visit the
[official skills documentation](https://geminicli.com/docs/cli/skills).
