# Plan mode implementation in Codex and OpenCode

## Codex (codex-rs)
- Plan mode is a collaboration mode (ModeKind::Plan) carried by CollaborationMode settings. It is one of the enumerated mode kinds and is stored alongside model, reasoning effort, and developer instructions. `codex-rs/protocol/src/config_types.rs:154` `codex-rs/protocol/src/config_types.rs:165`
- The built-in plan preset wires ModeKind::Plan to the plan template, model, and reasoning effort. `codex-rs/core/src/models_manager/collaboration_mode_presets.rs:6` `codex-rs/core/src/models_manager/collaboration_mode_presets.rs:27`
- Plan mode instructions come from the plan template, which enforces a strict plan-only or request_user_input-only output and defines the planning workflow. `codex-rs/core/templates/collaboration_mode/plan.md:1`
- Collaboration mode instructions are injected into the developer instructions for each turn via DeveloperInstructions::from_collaboration_mode and build_initial_context. `codex-rs/protocol/src/models.rs:264` `codex-rs/core/src/codex.rs:1644`
- The TUI only exposes Plan and Code presets and prompts the user to switch from Plan to Code after a plan response (the plan implementation prompt). `codex-rs/tui/src/collaboration_modes.rs:6` `codex-rs/tui/src/chatwidget.rs:906`
- The update_plan tool exists separately and emits PlanUpdate events for the UI to render structured plan steps, but it does not toggle the collaboration mode itself. `codex-rs/core/src/tools/handlers/plan.rs:20`

## OpenCode (opencode)
- Plan mode is implemented as a dedicated plan agent with a restricted permission set. It allows question and plan_exit, denies general edits, and only allows editing plan files under the plans directory. `opencode/packages/opencode/src/agent/agent.ts:51` `opencode/packages/opencode/src/agent/agent.ts:87`
- The plan file location is computed per session, stored under `.opencode/plans` when in a repo or in the global data directory otherwise. `opencode/packages/opencode/src/session/index.ts:235`
- The plan_enter and plan_exit tools prompt the user to switch agents and synthesize a user message to move between plan and build modes. `opencode/packages/opencode/src/tool/plan.ts:20`
- When entering plan mode, the session prompt layer injects a system reminder that enforces read-only behavior (except the plan file) and lays out a multi-phase planning workflow. It also adds a reminder when switching back to build mode and a plan file exists. `opencode/packages/opencode/src/session/prompt.ts:1191`
- The plan agent uses plan-mode reminder templates (for example plan.txt and plan-reminder-anthropic.txt) to enforce read-only planning constraints and workflow details. `opencode/packages/opencode/src/session/prompt/plan.txt:1` `opencode/packages/opencode/src/session/prompt/plan-reminder-anthropic.txt:1`
