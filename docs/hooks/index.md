# Gemini CLI hooks (experimental)

Hooks are scripts or programs that Gemini CLI executes at specific points in the
agentic loop, allowing you to intercept and customize behavior without modifying
the CLI's source code.

## Availability

> **Experimental Feature**: Hooks are currently enabled by default only in the
> **Preview** and **Nightly** release channels.

If you are on the Stable channel, you must explicitly enable the hooks system in
your `settings.json`:

```json
{
  "hooksConfig": {
    "enabled": true
  }
}
```

- **[Writing hooks guide](/docs/hooks/writing-hooks)**: A tutorial on creating
  your first hook with comprehensive examples.
- **[Hooks reference](/docs/hooks/reference)**: The definitive technical
  specification of I/O schemas and exit codes.
- **[Best practices](/docs/hooks/best-practices)**: Guidelines on security,
  performance, and debugging.

## What are hooks?

Hooks run synchronously as part of the agent loop—when a hook event fires,
Gemini CLI waits for all matching hooks to complete before continuing.

With hooks, you can:

- **Add context:** Inject relevant information (like git history) before the
  model processes a request.
- **Validate actions:** Review tool arguments and block potentially dangerous
  operations.
- **Enforce policies:** Implement security scanners and compliance checks.
- **Log interactions:** Track tool usage and model responses for auditing.
- **Optimize behavior:** Dynamically filter available tools or adjust model
  parameters.

## Core concepts

### Hook events

Hooks are triggered by specific events in Gemini CLI's lifecycle.

| Event                 | When It Fires                                  | Impact                 | Common Use Cases                             |
| --------------------- | ---------------------------------------------- | ---------------------- | -------------------------------------------- |
| `SessionStart`        | When a session begins (startup, resume, clear) | Inject Context         | Initialize resources, load context           |
| `SessionEnd`          | When a session ends (exit, clear)              | Advisory               | Clean up, save state                         |
| `BeforeAgent`         | After user submits prompt, before planning     | Block Turn / Context   | Add context, validate prompts, block turns   |
| `AfterAgent`          | When agent loop ends                           | Retry / Halt           | Review output, force retry or halt execution |
| `BeforeModel`         | Before sending request to LLM                  | Block Turn / Mock      | Modify prompts, swap models, mock responses  |
| `AfterModel`          | After receiving LLM response                   | Block Turn / Redact    | Filter/redact responses, log interactions    |
| `BeforeToolSelection` | Before LLM selects tools                       | Filter Tools           | Filter available tools, optimize selection   |
| `BeforeTool`          | Before a tool executes                         | Block Tool / Rewrite   | Validate arguments, block dangerous ops      |
| `AfterTool`           | After a tool executes                          | Block Result / Context | Process results, run tests, hide results     |
| `PreCompress`         | Before context compression                     | Advisory               | Save state, notify user                      |
| `Notification`        | When a system notification occurs              | Advisory               | Forward to desktop alerts, logging           |

### Global mechanics

Understanding these core principles is essential for building robust hooks.

#### Strict JSON requirements (The "Golden Rule")

Hooks communicate via `stdin` (Input) and `stdout` (Output).

1. **Silence is Mandatory**: Your script **must not** print any plain text to
   `stdout` other than the final JSON object. **Even a single `echo` or `print`
   call before the JSON will break parsing.**
2. **Pollution = Failure**: If `stdout` contains non-JSON text, parsing will
   fail. The CLI will default to "Allow" and treat the entire output as a
   `systemMessage`.
3. **Debug via Stderr**: Use `stderr` for **all** logging and debugging (e.g.,
   `echo "debug" >&2`). Gemini CLI captures `stderr` but never attempts to parse
   it as JSON.

#### Exit codes

Gemini CLI uses exit codes to determine the high-level outcome of a hook
execution:

| Exit Code | Label            | Behavioral Impact                                                                                                                                                            |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**     | **Success**      | The `stdout` is parsed as JSON. **Preferred code** for all logic, including intentional blocks (e.g., `{"decision": "deny"}`).                                               |
| **2**     | **System Block** | **Critical Block**. The target action (tool, turn, or stop) is aborted. `stderr` is used as the rejection reason. High severity; used for security stops or script failures. |
| **Other** | **Warning**      | Non-fatal failure. A warning is shown, but the interaction proceeds using original parameters.                                                                               |

#### Matchers

You can filter which specific tools or triggers fire your hook using the
`matcher` field.

- **Tool events** (`BeforeTool`, `AfterTool`): Matchers are **Regular
  Expressions**. (e.g., `"write_.*"`).
- **Lifecycle events**: Matchers are **Exact Strings**. (e.g., `"startup"`).
- **Wildcards**: `"*"` or `""` (empty string) matches all occurrences.

## Configuration

Hook definitions are configured in `settings.json`. Gemini CLI merges
configurations from multiple layers in the following order of precedence
(highest to lowest):

1.  **Project settings**: `.gemini/settings.json` in the current directory.
2.  **User settings**: `~/.gemini/settings.json`.
3.  **System settings**: `/etc/gemini-cli/settings.json`.
4.  **Extensions**: Hooks defined by installed extensions.

### Configuration schema

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "security-check",
            "type": "command",
            "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/security.sh",
            "timeout": 5000,
            "sequential": false
          }
        ]
      }
    ]
  }
}
```

### Environment variables

Hooks are executed with a sanitized environment.

- `GEMINI_PROJECT_DIR`: The absolute path to the project root.
- `GEMINI_SESSION_ID`: The unique ID for the current session.
- `GEMINI_CWD`: The current working directory.
- `CLAUDE_PROJECT_DIR`: (Alias) Provided for compatibility.

## Security and risks

> **Warning: Hooks execute arbitrary code with your user privileges.** By
> configuring hooks, you are allowing scripts to run shell commands on your
> machine.

**Project-level hooks** are particularly risky when opening untrusted projects.
Gemini CLI **fingerprints** project hooks. If a hook's name or command changes
(e.g., via `git pull`), it is treated as a **new, untrusted hook** and you will
be warned before it executes.

See [Security Considerations](/docs/hooks/best-practices#using-hooks-securely)
for a detailed threat model.

## Managing hooks

Use the CLI commands to manage hooks without editing JSON manually:

Use the `/hooks panel` command to view all registered hooks:

```bash
/hooks panel
```

This command displays:

- All configured hooks organized by event
- Hook source (user, project, system)
- Hook type (command or plugin)
- Individual hook status (enabled/disabled)

### Enable and disable all hooks at once

You can enable or disable all hooks at once using commands:

```bash
/hooks enable-all
/hooks disable-all
```

These commands provide a shortcut to enable or disable all configured hooks
without managing them individually. The `enable-all` command removes all hooks
from the `hooks.disabled` array, while `disable-all` adds all configured hooks
to the disabled list. Changes take effect immediately without requiring a
restart.

### Enable and disable individual hooks

You can enable or disable individual hooks using commands:

```bash
/hooks enable hook-name
/hooks disable hook-name
```

These commands allow you to control hook execution without editing configuration
files. The hook name should match the `name` field in your hook configuration.
Changes made via these commands are persisted to your settings. The settings are
saved to workspace scope if available, otherwise to your global user settings
(`~/.gemini/settings.json`).

### Disabled hooks configuration

To permanently disable hooks, add them to the `hooks.disabled` array in your
`settings.json`:

```json
{
  "hooks": {
    "disabled": ["secret-scanner", "auto-test"]
  }
}
```

**Note:** The `hooks.disabled` array uses a UNION merge strategy. Disabled hooks
from all configuration levels (user, project, system) are combined and
deduplicated, meaning a hook disabled at any level remains disabled.

## Migration from Claude Code

If you have hooks configured for Claude Code, you can migrate them:

```bash
gemini hooks migrate --from-claude
```

This command:

- Reads `.claude/settings.json`
- Converts event names (`PreToolUse` → `BeforeTool`, etc.)
- Translates tool names (`Bash` → `run_shell_command`, `replace` → `replace`)
- Updates matcher patterns
- Writes to `.gemini/settings.json`

### Event name mapping

| Claude Code        | Gemini CLI     |
| ------------------ | -------------- |
| `PreToolUse`       | `BeforeTool`   |
| `PostToolUse`      | `AfterTool`    |
| `UserPromptSubmit` | `BeforeAgent`  |
| `Stop`             | `AfterAgent`   |
| `Notification`     | `Notification` |
| `SessionStart`     | `SessionStart` |
| `SessionEnd`       | `SessionEnd`   |
| `PreCompact`       | `PreCompress`  |

### Tool name mapping

| Claude Code | Gemini CLI          |
| ----------- | ------------------- |
| `Bash`      | `run_shell_command` |
| `Edit`      | `replace`           |
| `Read`      | `read_file`         |
| `Write`     | `write_file`        |
| `Glob`      | `glob`              |
| `Grep`      | `grep_search`       |
| `LS`        | `list_directory`    |

## Tool and Event Matchers Reference

### Available tool names for matchers

The following built-in tools can be used in `BeforeTool` and `AfterTool` hook
matchers:

#### File operations

- `read_file` - Read a single file
- `read_many_files` - Read multiple files at once
- `write_file` - Create or overwrite a file
- `replace` - Edit file content with find/replace

#### File system

- `list_directory` - List directory contents
- `glob` - Find files matching a pattern
- `grep_search` - Search within file contents

#### Execution

- `run_shell_command` - Execute shell commands

#### Web and external

- `google_web_search` - Google Search with grounding
- `web_fetch` - Fetch web page content

#### Agent features

- `write_todos` - Manage TODO items
- `save_memory` - Save information to memory
- `delegate_to_agent` - Delegate tasks to sub-agents

#### Example matchers

```json
{
  "matcher": "write_file|replace" // File editing tools
}
```

```json
{
  "matcher": "read_.*" // All read operations
}
```

```json
{
  "matcher": "run_shell_command" // Only shell commands
}
```

```json
{
  "matcher": "*" // All tools
}
```

### Event-specific matchers

#### SessionStart event matchers

- `startup` - Fresh session start
- `resume` - Resuming a previous session
- `clear` - Session cleared

#### SessionEnd event matchers

- `exit` - Normal exit
- `clear` - Session cleared
- `logout` - User logged out
- `prompt_input_exit` - Exit from prompt input
- `other` - Other reasons

#### PreCompress event matchers

- `manual` - Manually triggered compression
- `auto` - Automatically triggered compression

#### Notification event matchers

- `ToolPermission` - Tool permission notifications

## Learn more

- [Writing Hooks](writing-hooks.md) - Tutorial and comprehensive example
- [Best Practices](best-practices.md) - Security, performance, and debugging
- [Custom Commands](../cli/custom-commands.md) - Create reusable prompt
  shortcuts
- [Configuration](../get-started/configuration.md) - Gemini CLI configuration
  options
- [Hooks Design Document](../hooks-design.md) - Technical architecture details
