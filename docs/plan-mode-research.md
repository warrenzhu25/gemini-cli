# Plan Mode: A Comparative Study of Codex and OpenCode Implementations

## Table of Contents
- [Introduction](#introduction)
- [What is Plan Mode?](#what-is-plan-mode)
- [Background: Codex and OpenCode](#background-codex-and-opencode)
- [Codex Implementation](#codex-implementation)
- [OpenCode Implementation](#opencode-implementation)
- [Comparison](#comparison)
- [Key Takeaways](#key-takeaways)
- [References](#references)

---

## Introduction

This document analyzes how two AI-powered coding assistants—**Codex** (written in Rust) and **OpenCode** (written in TypeScript)—implement "Plan Mode," a feature that separates the planning phase from the implementation phase of software development.

**Target Audience**: Developers who want to implement similar features in their own AI coding tools, or anyone interested in understanding how modern AI assistants structure their workflows.

**Key Question**: How do you design an AI coding assistant that can thoroughly plan changes before making them, avoiding the common problem of AIs making hasty or poorly-thought-out modifications?

---

## What is Plan Mode?

### The Problem Plan Mode Solves

When AI coding assistants operate in a single mode, they tend to:
- Make changes too quickly without fully understanding the codebase
- Skip important architectural considerations
- Miss edge cases and integration points
- Make assumptions that turn out to be wrong
- Create technical debt by choosing quick fixes over proper solutions

### The Solution: Two-Phase Development

Plan Mode enforces a **two-phase workflow**:

```
┌─────────────────┐         ┌──────────────────┐
│   PLAN MODE     │ ──────> │   BUILD MODE     │
│   (Read-only)   │         │   (Read+Write)   │
└─────────────────┘         └──────────────────┘
     Explore                     Implement
     Research                    Execute
     Design                      Deploy
     Document
```

**Phase 1: Plan Mode (Read-Only)**
- AI can **read** files, search code, fetch documentation
- AI **cannot** edit files, run commands, make commits
- Output: A detailed implementation plan
- Goal: Deep understanding before action

**Phase 2: Build/Code Mode (Read+Write)**
- AI can **read and write** files
- AI can **execute** commands and make commits
- Input: The approved plan from Phase 1
- Goal: Execute the plan efficiently

### Why This Matters

Separating planning from implementation:
- ✅ Forces thorough codebase exploration
- ✅ Surfaces architectural issues early
- ✅ Enables human review before any changes
- ✅ Reduces wasted work from incorrect assumptions
- ✅ Creates documentation (the plan) for future reference

---

## Background: Codex and OpenCode

Before diving into implementations, let's understand what these tools are:

### Codex (codex-rs)

**What it is**: A terminal-based AI coding assistant written in Rust
- **Repository**: https://github.com/anthropics/codex (assumed)
- **Language**: Rust
- **UI**: Terminal User Interface (TUI)
- **AI Model**: Uses Claude (Anthropic's AI models)
- **Philosophy**: Fast, efficient, low-level control

**Architecture**:
- Core Rust library (`codex-rs/core`) with tool handlers
- Protocol definitions (`codex-rs/protocol`) for communication
- TUI client (`codex-rs/tui`) for user interaction

### OpenCode

**What it is**: A TypeScript-based AI coding assistant
- **Repository**: https://github.com/opencode/opencode (assumed)
- **Language**: TypeScript/Node.js
- **Philosophy**: Flexible, extensible, permission-based

**Architecture**:
- Agent system with different agent types
- Session management with prompt injection
- Permission-based access control

---

## Codex Implementation

### High-Level Design

Codex implements Plan Mode as a **collaboration mode preset**—essentially a configuration that bundles together:
1. A mode identifier (`ModeKind::Plan`)
2. A planning prompt template
3. Model settings (which AI model and reasoning effort to use)
4. UI behavior specific to planning

**Key Concept**: In Codex, "mode" is first-class—it's a configuration object that travels with the session and affects every part of the system.

### Architecture Breakdown

#### 1. Mode as Configuration (`config_types.rs`)

Plan Mode is defined as an enum variant:

```rust
pub enum ModeKind {
    Plan,           // ← Plan Mode
    Code,           // ← Normal coding mode
    PairProgramming,
    Execute,
    Custom,
}
```

This enum is wrapped in a `CollaborationMode` struct:

```rust
pub struct CollaborationMode {
    pub mode: ModeKind,        // Which mode (Plan, Code, etc.)
    pub settings: Settings,     // Model, reasoning effort, etc.
}
```

**Location**: `codex-rs/protocol/src/config_types.rs:154-171`

**Significance**: Mode is stored alongside settings, making it easy to switch between Plan and Code mode while preserving user preferences.

---

#### 2. Built-in Plan Preset (`collaboration_mode_presets.rs`)

Codex ships with a built-in "Plan" preset that wires together:

```rust
// Simplified pseudocode
PLAN_PRESET = {
    mode: ModeKind::Plan,
    template: load("templates/collaboration_mode/plan.md"),
    model: "claude-sonnet-4",
    reasoning_effort: "high"
}
```

**Location**: `codex-rs/core/src/models_manager/collaboration_mode_presets.rs:6-27`

**What this means**:
- Users don't configure Plan Mode manually
- Everything needed for planning is bundled together
- Consistent experience across all Codex users

---

#### 3. Plan Mode Template (`plan.md`)

The heart of Codex's Plan Mode is a **283-line markdown template** that serves as the AI's instructions. This template:

**Defines the workflow** (2 phases):
```
PHASE 1 — Understand user intent
  ↓
  Ask questions via request_user_input
  ↓
PHASE 2 — Technical spec & implementation plan
  ↓
  Output final plan (plan-only!)
```

**Enforces strict interaction rules**:
- Every AI turn must be **exactly one of**:
  - A) `request_user_input` tool call (to ask questions), OR
  - B) The final plan output
- **No mixing**: Can't ask questions AND output plan in same turn
- **No free-text questions**: Must use structured `request_user_input` tool

**Guides exploration strategy**:
- **Evidence-first exploration**: Search the codebase before asking user
- **Ask early for preferences**: Don't assume architectural choices
- Distinguish "discoverable facts" from "user preferences"

**Specifies plan structure** (12 required sections):
1. Title
2. Goal & Success Criteria
3. Non-goals / Out of Scope
4. Assumptions
5. Proposed Solution
6. System Design
7. Interfaces & Data Contracts
8. Execution Details
9. Testing & Quality
10. Rollout, Observability, and Ops
11. Risks & Mitigations
12. Open Questions

**Location**: `codex-rs/core/templates/collaboration_mode/plan.md:1-283`

**Example from the template**:
```markdown
## Hard interaction rule (critical)

Every assistant turn MUST be **exactly one** of:

**A) A `request_user_input` tool call** (to gather requirements), OR
**B) The final plan output** (**plan‑only**, with a good title).

Constraints:
- **Do NOT ask questions in free text.** All questions MUST be via `request_user_input`.
- **Do NOT mix** a `request_user_input` call with plan content in the same turn.
```

---

#### 4. Prompt Injection (`models.rs` and `codex.rs`)

How does the plan template reach the AI? Through **prompt injection**:

```
User message
    ↓
System checks current mode
    ↓
If mode == Plan:
    ↓
Inject plan template into system prompt
    ↓
Send to AI model
```

**Implementation**:
- `DeveloperInstructions::from_collaboration_mode()` reads the mode
- `build_initial_context()` constructs the full system prompt
- Plan template is prepended/appended to system instructions

**Locations**:
- `codex-rs/protocol/src/models.rs:264`
- `codex-rs/core/src/codex.rs:1644`

**Result**: The AI "sees" different instructions depending on the mode, but the user doesn't have to manually copy-paste templates.

---

#### 5. UI Integration (`collaboration_modes.rs` and `chatwidget.rs`)

The TUI provides mode-switching UI:

**Available modes**: Only Plan and Code are exposed to users (simplified)

**Switching workflow**:
```
User in Plan Mode
    ↓
AI outputs final plan
    ↓
TUI shows: "Plan ready! Switch to Code Mode to implement?"
    ↓
User presses [Enter] or keyboard shortcut
    ↓
Mode switches to Code
    ↓
AI can now edit files
```

**Locations**:
- Mode definitions: `codex-rs/tui/src/collaboration_modes.rs:6`
- Switch prompt: `codex-rs/tui/src/chatwidget.rs:906`

**UX benefit**: Smooth transition from planning to implementation with clear user confirmation.

---

#### 6. The `update_plan` Tool (`plan.rs`)

Separate from the mode system, Codex has an `update_plan` tool:

**Purpose**: Allows AI to emit structured plan updates that the UI can render nicely

**Behavior**:
- AI calls `update_plan({ step: "Step 1", description: "..." })`
- Tool emits `PlanUpdate` event
- TUI renders this as a checklist or progress indicator

**Important**: This tool doesn't change the collaboration mode—it's just for structured output

**Location**: `codex-rs/core/src/tools/handlers/plan.rs:20`

**Visual example**:
```
┌─────────────────────────────────┐
│ Plan Progress                   │
├─────────────────────────────────┤
│ ✓ Step 1: Research auth system  │
│ ✓ Step 2: Design OAuth flow     │
│ ⧗ Step 3: Plan implementation   │
│   Step 4: Testing strategy      │
└─────────────────────────────────┘
```

---

### Codex Workflow Example

**User's perspective**:

```
1. User: "Help me add OAuth support"

2. Codex TUI shows: [Plan Mode]
   (indicator in UI)

3. AI explores codebase:
   - Searches for auth-related files
   - Reads current authentication code
   - Fetches OAuth documentation

4. AI asks questions via structured dialog:
   ┌─────────────────────────────────────┐
   │ Which OAuth provider?               │
   │ ○ Google (Recommended)              │
   │ ○ GitHub                            │
   │ ○ Custom provider                   │
   └─────────────────────────────────────┘

5. User selects "Google"

6. AI outputs final plan (text):
   # Add Google OAuth Support

   ## Goal & Success Criteria
   Enable Google OAuth login...

   ## Proposed Solution
   Integrate google-auth-library...

   [... 11 more sections ...]

7. TUI prompts: "Switch to Code Mode to implement?"

8. User confirms → Mode switches to Code

9. AI can now edit files and implement the plan
```

---

## OpenCode Implementation

### High-Level Design

OpenCode implements Plan Mode as a **dedicated agent** with restricted permissions.

**Key Concept**: OpenCode uses an "agent" architecture where different agents have different capabilities. The "plan agent" is a specialized agent that can only read files and write to plan files.

**Philosophy**: Permission-based access control instead of prompt-based constraints.

---

### Architecture Breakdown

#### 1. Agent System (`agent.ts`)

OpenCode defines two primary agents:

```typescript
const agents = {
  build: {
    name: "build",
    permission: {
      "*": "allow",           // Can do anything
      question: "allow",      // Can ask questions
      plan_enter: "allow"     // Can enter Plan Mode
    },
    mode: "primary"
  },

  plan: {
    name: "plan",
    permission: {
      question: "allow",      // Can ask questions
      plan_exit: "allow",     // Can exit Plan Mode
      edit: {
        "*": "deny",          // CANNOT edit most files
        ".opencode/plans/*.md": "allow"  // CAN edit plan files
      }
    },
    mode: "secondary"
  }
}
```

**Location**: `opencode/packages/opencode/src/agent/agent.ts:51-104`

**Key differences from Codex**:
- Codex: One agent, different modes
- OpenCode: Different agents, each with own permissions

---

#### 2. Permission System

OpenCode's permissions are **path-aware** and use glob patterns:

```typescript
permission: {
  edit: {
    "*": "deny",                              // Deny all edits by default
    ".opencode/plans/*.md": "allow",         // Allow project plan files
    "~/.opencode/plans/*.md": "allow"        // Allow global plan files
  },

  external_directory: {
    "~/.opencode/plans/*": "allow"           // Allow global plans directory
  }
}
```

**How it works**:
1. AI tries to edit a file
2. OpenCode checks current agent's permissions
3. Matches file path against glob patterns
4. Allows or denies based on most specific match

**Example**:
```
AI: edit_file("src/auth.ts")
→ Matches "*": "deny"
→ DENIED ❌

AI: edit_file(".opencode/plans/oauth-plan.md")
→ Matches ".opencode/plans/*.md": "allow"
→ ALLOWED ✓
```

---

#### 3. Plan File Location (`session/index.ts`)

OpenCode computes plan file location based on context:

```typescript
// Simplified logic
function getPlanFilePath() {
  if (inGitRepository) {
    return `${projectRoot}/.opencode/plans/plan.md`;
  } else {
    return `${globalDataDir}/plans/plan.md`;
  }
}
```

**Location**: `opencode/packages/opencode/src/session/index.ts:235`

**File locations**:
- **Project plans**: `.opencode/plans/` (when in a Git repo)
- **Global plans**: `~/.opencode/plans/` (when not in a repo)

**Rationale**: Plans should be co-located with the project, but also support ad-hoc planning outside projects.

---

#### 4. Mode Switching Tools (`tool/plan.ts`)

OpenCode provides two tools for mode switching:

**`plan_enter` tool**:
```typescript
// When AI calls plan_enter:
1. Prompt user: "Enter Plan Mode?"
2. If user confirms:
   a. Switch to "plan" agent
   b. Synthesize user message: "Let's plan this"
   c. Inject plan mode prompt
```

**`plan_exit` tool**:
```typescript
// When AI calls plan_exit:
1. Prompt user: "Exit Plan Mode and implement?"
2. If user confirms:
   a. Switch to "build" agent
   b. Synthesize user message: "Let's implement this"
   c. Remove plan mode prompt
```

**Location**: `opencode/packages/opencode/src/tool/plan.ts:20`

**Important**: Tools require user confirmation—AI can't force mode switches

---

#### 5. Prompt Layer (`session/prompt.ts`)

When in Plan Mode, OpenCode injects a **system reminder** into every AI request:

```markdown
<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase.
STRICTLY FORBIDDEN: ANY file edits, modifications, or system changes.

Your current responsibility is to think, read, search, and construct
a well-formed plan that accomplishes the goal.

The user indicated that they do not want you to execute yet -- you
MUST NOT make any edits, run any non-readonly tools, or otherwise
make any changes to the system.
</system-reminder>
```

**Location**: `opencode/packages/opencode/src/session/prompt.ts:1191`

**Also includes**:
- When switching **to** Plan Mode: Injects plan workflow instructions
- When switching **from** Plan Mode: Reminds AI that plan file exists

**Template files**:
- `opencode/packages/opencode/src/session/prompt/plan.txt:1`
- `opencode/packages/opencode/src/session/prompt/plan-reminder-anthropic.txt:1`

---

### OpenCode Workflow Example

**User's perspective**:

```
1. User: "Help me add OAuth support"

2. AI (in build agent): "I'll help you plan this. Let me enter Plan Mode."

3. AI calls plan_enter tool
   → OpenCode prompts user: "Enter Plan Mode? [Y/n]"

4. User confirms → Agent switches to "plan"

5. OpenCode injects system reminder:
   "CRITICAL: Plan mode ACTIVE - READ-ONLY phase"

6. AI explores codebase:
   - Uses read_file on auth code
   - Uses search_code for "authentication"
   - Uses web_fetch for OAuth docs

   (All allowed because they're read-only)

7. AI tries to write plan:
   write_file(".opencode/plans/oauth-plan.md", planContent)

   → Permission check: ".opencode/plans/*.md" = "allow"
   → ALLOWED ✓

8. AI writes detailed plan to file

9. AI calls plan_exit tool
   → OpenCode prompts: "Exit Plan Mode and implement? [Y/n]"

10. User confirms → Agent switches to "build"

11. AI can now edit source files and implement the plan
```

---

## Comparison

### Side-by-Side Overview

| Aspect | Codex (Rust) | OpenCode (TypeScript) |
|--------|--------------|----------------------|
| **Core Mechanism** | Collaboration mode (configuration) | Dedicated agent (permission-based) |
| **Enforcement** | Prompt instructions | Permission system + prompts |
| **Mode Switching** | UI-driven (user clicks in TUI) | Tool-driven (AI calls plan_enter/exit) |
| **Plan Storage** | Structured output (update_plan tool) | File-based (.opencode/plans/plan.md) |
| **Architecture** | Single agent, different modes | Multiple agents, fixed capabilities |
| **Interaction Rules** | Strict (request_user_input only) | Flexible (can ask freely) |
| **Plan Structure** | Highly prescribed (12 sections) | Flexible (AI determines structure) |
| **Language** | Rust | TypeScript |

---

### Design Philosophy Differences

#### Codex: Prompt-Driven Planning

**Philosophy**: Control AI behavior through detailed prompts

**Strengths**:
- ✅ Highly structured output (12-section plan)
- ✅ Consistent experience across users
- ✅ Clear interaction patterns (request_user_input)
- ✅ Evidence-first exploration enforced by prompt

**Limitations**:
- ❌ Relies on AI following instructions (not enforced)
- ❌ Template is long (283 lines) and complex
- ❌ Harder to customize without editing template

**Use case**: Teams that want consistent, thorough planning with minimal configuration

---

#### OpenCode: Permission-Driven Planning

**Philosophy**: Control AI behavior through capability restrictions

**Strengths**:
- ✅ **Hard enforcement**: AI literally cannot edit files (permission denied)
- ✅ Flexible: AI can structure plan however it wants
- ✅ Extensible: Easy to add new agents or modify permissions
- ✅ Plan files are portable (just markdown in .opencode/)

**Limitations**:
- ❌ Less structured output (depends on AI's discretion)
- ❌ More complex architecture (agent system, permissions)
- ❌ Requires user confirmation for mode switching (can slow workflow)

**Use case**: Teams that want maximum safety and flexibility, willing to accept varied plan formats

---

### Technical Trade-offs

#### 1. Prompt vs Permissions

**Codex (Prompt)**:
```rust
// AI instructions say: "You MUST NOT edit files in Plan Mode"
// But technically AI *could* call edit_file() - nothing stops it
```

**OpenCode (Permission)**:
```typescript
// AI tries: edit_file("src/auth.ts")
// Permission check: "*": "deny" → DENIED
// AI literally cannot edit (enforcement at runtime)
```

**Trade-off**:
- Prompts are simpler but rely on AI compliance
- Permissions are safer but require more infrastructure

---

#### 2. Plan Storage

**Codex (Structured Events)**:
```rust
update_plan({ step: "1", desc: "Research" })
→ Emits PlanUpdate event
→ TUI renders in real-time
→ Plan exists in UI memory (not a file)
```

**OpenCode (File-Based)**:
```typescript
write_file(".opencode/plans/plan.md", plan)
→ Creates markdown file
→ Persists to disk
→ Can be opened in any editor
```

**Trade-off**:
- Events are real-time but ephemeral
- Files are persistent but require file I/O

---

#### 3. Mode Switching Control

**Codex (User-Initiated)**:
```
User sees: "Plan ready! Press Enter to switch to Code Mode"
→ User has explicit control
→ Clear UX but requires user action
```

**OpenCode (AI-Initiated)**:
```
AI calls: plan_enter()
→ User sees: "AI wants to enter Plan Mode. Approve? [Y/n]"
→ More automated but requires confirmation
```

**Trade-off**:
- User-initiated is explicit but slower
- AI-initiated is faster but needs trust/confirmation

---

## Key Takeaways

### For Implementers

If you're building a similar feature, consider:

1. **Decide on enforcement mechanism**:
   - **Prompt-based** (Codex style): Simpler, but AI might not comply
   - **Permission-based** (OpenCode style): Safer, but more complex
   - **Hybrid**: Prompts for guidance + permissions for safety (recommended!)

2. **Plan storage strategy**:
   - **Structured output**: Better for UI rendering, real-time updates
   - **File-based**: Better for portability, version control, editing
   - **Both**: Combine structured updates with final file output

3. **Mode switching UX**:
   - Make switching **explicit** (user always knows current mode)
   - Require **confirmation** before executing plans
   - Provide **visual indicators** (mode badge in UI)

4. **Prompt design**:
   - Define **clear phases** (explore → plan → implement)
   - Specify **interaction rules** (how AI should ask questions)
   - Include **plan structure** (what sections to include)
   - Emphasize **evidence-first** exploration

5. **Permission granularity**:
   - Allow all **read operations** (search, read files, web fetch)
   - Deny all **write operations** except plan files
   - Use **glob patterns** for path-based permissions
   - Provide **escape hatches** (user can override if needed)

### Best Practices from Both Implementations

**From Codex**:
- ✅ Structured `request_user_input` for questions (better UX than free text)
- ✅ Evidence-first exploration (search before asking)
- ✅ Distinguish "discoverable facts" from "user preferences"
- ✅ 12-section plan template (comprehensive coverage)

**From OpenCode**:
- ✅ Permission system for hard enforcement
- ✅ Path-based access control (glob patterns)
- ✅ File-based plan storage (portable, versionable)
- ✅ Dedicated agents for clear separation of concerns

**Recommended Hybrid Approach**:
```
┌─────────────────────────────────────┐
│ Plan Mode Implementation            │
├─────────────────────────────────────┤
│ 1. Permission system (hard enforcement) │
│    - Deny edits except plan files   │
│    - Path-based glob matching       │
│                                     │
│ 2. Prompt template (guidance)       │
│    - Define plan structure          │
│    - Specify interaction rules      │
│    - Emphasize evidence-first       │
│                                     │
│ 3. File-based storage               │
│    - .tool/plans/plan.md            │
│    - Versionable, portable          │
│                                     │
│ 4. Explicit mode switching          │
│    - User confirmation required     │
│    - Visual mode indicator          │
└─────────────────────────────────────┘
```

---

## References

### Codex Source Files

1. **Mode definition**: `codex-rs/protocol/src/config_types.rs:154-171`
   - Defines `ModeKind` enum and `CollaborationMode` struct

2. **Plan preset**: `codex-rs/core/src/models_manager/collaboration_mode_presets.rs:6-27`
   - Built-in Plan mode configuration

3. **Plan template**: `codex-rs/core/templates/collaboration_mode/plan.md:1-283`
   - Complete planning instructions for AI

4. **Prompt injection**:
   - `codex-rs/protocol/src/models.rs:264`
   - `codex-rs/core/src/codex.rs:1644`

5. **TUI integration**:
   - `codex-rs/tui/src/collaboration_modes.rs:6`
   - `codex-rs/tui/src/chatwidget.rs:906`

6. **update_plan tool**: `codex-rs/core/src/tools/handlers/plan.rs:20`

### OpenCode Source Files

1. **Agent definition**: `opencode/packages/opencode/src/agent/agent.ts:51-104`
   - Build and plan agents with permissions

2. **Plan file location**: `opencode/packages/opencode/src/session/index.ts:235`
   - Logic for computing plan file path

3. **Mode switching tools**: `opencode/packages/opencode/src/tool/plan.ts:20`
   - plan_enter and plan_exit implementations

4. **Prompt injection**: `opencode/packages/opencode/src/session/prompt.ts:1191`
   - System reminder injection logic

5. **Prompt templates**:
   - `opencode/packages/opencode/src/session/prompt/plan.txt:1`
   - `opencode/packages/opencode/src/session/prompt/plan-reminder-anthropic.txt:1`

---

## Conclusion

Both Codex and OpenCode demonstrate sophisticated approaches to separating planning from implementation in AI coding assistants.

**Codex** excels at providing **structure and consistency** through detailed prompt templates and built-in presets.

**OpenCode** excels at **safety and flexibility** through permission-based access control and dedicated agents.

The ideal implementation likely combines elements from both: **hard permission enforcement** for safety, **structured prompts** for consistency, **file-based storage** for portability, and **explicit user control** for trust.

As AI coding assistants become more powerful, features like Plan Mode become increasingly critical—not just for better code quality, but for maintaining human oversight and control over the development process.
