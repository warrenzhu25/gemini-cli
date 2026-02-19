# Gemini CLI Developer Architecture Guide

> **A comprehensive reference for contributors implementing features in the Gemini CLI codebase**

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Components Deep Dive](#3-core-components-deep-dive)
4. [The Tool System](#4-the-tool-system)
5. [The Command System](#5-the-command-system)
6. [Extension System](#6-extension-system)
7. [Configuration System](#7-configuration-system)
8. [Testing Guide](#8-testing-guide)
9. [Common Development Workflows](#9-common-development-workflows)
10. [Gotchas and Common Pitfalls](#10-gotchas-and-common-pitfalls)
11. [Quick Reference](#11-quick-reference)

---

## 1. Introduction

### 1.1 Purpose

This guide provides architectural documentation for developers ready to implement features in the Gemini CLI codebase. It covers the internal structure, design patterns, and implementation details you need to understand before writing code.

### 1.2 Relationship to CONTRIBUTING.md

- **CONTRIBUTING.md**: Process-focused (how to submit PRs, coding standards, testing requirements)
- **This guide**: Implementation-focused (how the code works, where to add features, design patterns)

Use CONTRIBUTING.md for workflow guidance and this document for architectural understanding.

### 1.3 Prerequisites

Before diving in, you should be familiar with:

- **TypeScript**: The codebase is written entirely in TypeScript
- **React**: Terminal UI uses React with Ink
- **Node.js**: Runtime environment and APIs (fs, path, crypto, etc.)
- **Async/Await**: Heavy use of promises and async generators
- **JSON Schema**: Used for tool parameter validation

### 1.4 How to Use This Guide

- **New contributors**: Read sections 1-3 for foundational understanding
- **Adding tools**: Focus on section 4 (The Tool System)
- **Adding commands**: Focus on section 5 (The Command System)
- **Extension development**: Focus on section 6 (Extension System)
- **Quick lookups**: Jump to section 11 (Quick Reference)

### 1.5 Glossary

| Term | Definition |
|------|------------|
| **Tool** | A function callable by the LLM (e.g., ReadFile, Shell, Grep) |
| **Command** | A slash command typed by users (e.g., `/help`, `/clear`, `/model`) |
| **Skill** | A reusable prompt template activatable via `/skill` |
| **Agent** | An autonomous sub-system that can execute multi-turn tasks |
| **Hook** | A customization point that fires before/after events |
| **MCP** | Model Context Protocol - standard for tool servers |
| **Config** | Central configuration hub and service locator |
| **MessageBus** | Pub/sub system for cross-module communication |
| **PolicyEngine** | Safety system that decides tool execution permissions |
| **ApprovalMode** | Permission level (default, autoEdit, yolo, plan) |

---

## 2. Architecture Overview

### 2.1 Package Structure

```
gemini-cli/
├── packages/
│   ├── cli/                    # Terminal UI (React/Ink)
│   │   ├── src/
│   │   │   ├── ui/
│   │   │   │   ├── commands/   # Slash commands (~56 files)
│   │   │   │   ├── components/ # React components
│   │   │   │   ├── hooks/      # React hooks
│   │   │   │   ├── contexts/   # Context providers
│   │   │   │   ├── state/      # State management
│   │   │   │   └── types.ts    # UI type definitions
│   │   │   ├── services/       # CLI-specific services
│   │   │   └── config/         # CLI configuration
│   │   └── vitest.config.ts
│   │
│   ├── core/                   # Backend logic
│   │   ├── src/
│   │   │   ├── core/           # LLM orchestration
│   │   │   │   ├── client.ts   # GeminiClient
│   │   │   │   ├── contentGenerator.ts
│   │   │   │   └── chat.ts     # Chat management
│   │   │   ├── tools/          # Tool implementations (~52 files)
│   │   │   ├── services/       # Business services (~20 files)
│   │   │   ├── agents/         # Agent system (~26 files)
│   │   │   ├── skills/         # Skills system
│   │   │   ├── hooks/          # Hooks system (~19 files)
│   │   │   ├── mcp/            # MCP integration (~21 files)
│   │   │   ├── policy/         # Policy engine (~14 files)
│   │   │   ├── config/         # Core configuration
│   │   │   │   ├── config.ts   # Config class (~2000 lines)
│   │   │   │   └── storage.ts  # File storage
│   │   │   ├── confirmation-bus/ # MessageBus
│   │   │   └── utils/          # Shared utilities
│   │   └── vitest.config.ts
│   │
│   ├── a2a-server/             # Agent-to-Agent server
│   ├── test-utils/             # Testing utilities
│   └── vscode-ide-companion/   # VS Code extension
│
├── integration-tests/          # E2E tests (~64 test suites)
├── docs/                       # Documentation
└── scripts/                    # Build scripts
```

### 2.2 Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          packages/cli                                │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │   Commands   │  │  React/Ink   │  │     CommandService         │ │
│  │   (Slash)    │  │  Components  │  │    (Loader Pattern)        │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────────┬──────────────┘ │
└─────────┼─────────────────┼────────────────────────┼────────────────┘
          │                 │                        │
          ▼                 ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          packages/core                               │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ GeminiClient │  │    Config    │  │      ToolRegistry          │ │
│  │ (API Orch.)  │◄─┤   (Central)  │──►│     (Tool Mgmt)            │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────────┬──────────────┘ │
│         │                 │                        │                 │
│         ▼                 ▼                        ▼                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │  GeminiChat  │  │  MessageBus  │  │   Tools (Read/Write/       │ │
│  │   + Turn     │  │ PolicyEngine │  │   Shell/Web/MCP)           │ │
│  └──────────────┘  └──────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       External Services                              │
│                                                                      │
│       Gemini API       │      MCP Servers      │     File System    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.3 Data Flow

```
User Input
    │
    ▼
┌─────────────────────────────────────┐
│  CommandService                      │
│  (parse slash commands)              │
│  OR                                  │
│  AtCommandProcessor                  │
│  (parse @commands)                   │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  GeminiClient.sendMessageStream()   │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  ContentGenerator                    │
│  (create request)                    │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  HookSystem.fireBeforeModelEvent()  │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  GenerateContent API Call           │
│  (Gemini API)                        │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Tool Call Requests                  │
│       │                              │
│       ▼                              │
│  ToolRegistry.getTool()              │
│       │                              │
│       ▼                              │
│  PolicyEngine.evaluate()             │
│       │                              │
│       ▼                              │
│  User Confirmation (if needed)       │
│       │                              │
│       ▼                              │
│  Tool Execution                      │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Tool Results → Model Response      │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Output Formatting                   │
│  (Text/JSON/StreamJSON)              │
└─────────────────────────────────────┘
```

### 2.4 Key Design Principles

1. **Modularity**: Clear separation between frontend (CLI) and backend (Core)
2. **Extensibility**: Tool system and MCP support for custom integrations
3. **Composability**: React components with hooks for reusable logic
4. **Event-driven**: Event emitters and MessageBus for cross-module communication
5. **Context-based**: React Context for managing shared state
6. **Policy-driven**: Configurable approval modes for tool execution
7. **Two-class pattern**: Tools separate validation (DeclarativeTool) from execution (ToolInvocation)

---

## 3. Core Components Deep Dive

### 3.1 GeminiClient - API Orchestration

**File**: `packages/core/src/core/client.ts`

The `GeminiClient` is the main orchestrator for Gemini API interactions. It manages conversation turns, tool execution, and hooks.

**Responsibilities**:

- Main API orchestrator for Gemini interactions
- Turn management and event streaming
- Hook firing (before/after model calls)
- Chat compression when approaching token limits

**Key Methods**:

```typescript
class GeminiClient {
  // Initialize client with configuration
  async initialize(): Promise<void>;

  // Send message and stream response (main entry point)
  async sendMessageStream(
    message: string,
    options?: SendMessageOptions
  ): AsyncGenerator<TurnEvent>;

  // Process a single turn with tool calls
  async processTurn(
    turn: Turn,
    signal: AbortSignal
  ): Promise<TurnResult>;

  // Reset conversation history
  async resetChat(): Promise<void>;

  // Update available tools
  async setTools(): Promise<void>;

  // Check if initialized
  isInitialized(): boolean;
}
```

**Usage Pattern**:

```typescript
const client = config.getGeminiClient();
await client.initialize();

for await (const event of client.sendMessageStream("Hello")) {
  switch (event.type) {
    case 'text':
      console.log(event.content);
      break;
    case 'tool_call':
      // Handle tool execution
      break;
    case 'error':
      console.error(event.error);
      break;
  }
}
```

### 3.2 Config - Central Configuration Hub

**File**: `packages/core/src/config/config.ts`

The `Config` class is the central hub for configuration and service location. Almost every component receives a `Config` instance.

**Responsibilities**:

- Central configuration hub and service locator
- Manages ToolRegistry, SkillManager, AgentRegistry, PolicyEngine, MessageBus
- Settings hierarchy: CLI args > env vars > project > user > defaults
- Extension lifecycle management

**Key Properties and Methods**:

```typescript
class Config {
  // Service accessors
  getToolRegistry(): ToolRegistry;
  getSkillManager(): SkillManager;
  getAgentRegistry(): AgentRegistry;
  getPolicyEngine(): PolicyEngine;
  getMessageBus(): MessageBus;
  getMcpClientManager(): McpClientManager | undefined;
  getGeminiClient(): GeminiClient;
  getHookSystem(): HookSystem | undefined;

  // Configuration accessors
  getTargetDir(): string;
  getApprovalMode(): ApprovalMode;
  getModel(): string;
  isTrustedFolder(): boolean;
  getDebugMode(): boolean;

  // Initialization (MUST be awaited)
  async initialize(): Promise<void>;

  // Tool registry creation
  async createToolRegistry(): Promise<ToolRegistry>;
}
```

**IMPORTANT**: `Config.initialize()` must be awaited before using services:

```typescript
const config = new Config(params);
await config.initialize(); // REQUIRED before using any services
const tools = config.getToolRegistry();
```

### 3.3 ToolRegistry - Tool Management

**File**: `packages/core/src/tools/tool-registry.ts`

The `ToolRegistry` manages tool registration, discovery, and retrieval.

**Responsibilities**:

- Tool registration and discovery
- Schema management for function declarations
- MCP tool integration
- Tool sorting by priority

**Key Methods**:

```typescript
class ToolRegistry {
  // Register a tool
  registerTool(tool: AnyDeclarativeTool): void;

  // Unregister a tool by name
  unregisterTool(name: string): void;

  // Get tool by name
  getTool(name: string): AnyDeclarativeTool | undefined;

  // Get all tools
  getAllTools(): AnyDeclarativeTool[];

  // Get all function declarations for Gemini API
  getFunctionDeclarations(): FunctionDeclaration[];

  // Discover tools from MCP servers and project config
  async discoverAllTools(): Promise<void>;

  // Sort tools by priority
  sortTools(): void;
}
```

**Tool Priority Order**:

1. Built-in tools (highest priority)
2. Discovered tools (from project config)
3. MCP tools (by server name)

### 3.4 MessageBus and PolicyEngine

**Files**:
- `packages/core/src/confirmation-bus/message-bus.ts`
- `packages/core/src/policy/policy-engine.ts`

The MessageBus enables decoupled communication between tools and the UI layer for confirmations. The PolicyEngine makes safety decisions.

**MessageBus Types**:

```typescript
enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  TOOL_POLICY_REJECTION = 'tool-policy-rejection',
  UPDATE_POLICY = 'update-policy',
  ASK_USER_REQUEST = 'ask-user-request',
  ASK_USER_RESPONSE = 'ask-user-response',
}
```

**Policy Decisions**:

```typescript
enum PolicyDecision {
  ALLOW = 'allow',    // Execute without confirmation
  DENY = 'deny',      // Block execution
  ASK_USER = 'ask_user', // Require user confirmation
}
```

**Approval Modes**:

```typescript
enum ApprovalMode {
  DEFAULT = 'default',    // Standard confirmation for mutations
  AUTO_EDIT = 'autoEdit', // Auto-confirm file edits
  YOLO = 'yolo',          // Auto-approve all (trusted folder only)
  PLAN = 'plan',          // Preview-only mode
}
```

---

## 4. The Tool System

### 4.1 Tool Architecture Pattern

**Core Principle**: The tool system uses a two-class pattern separating definition from execution.

```
┌─────────────────────────────────────────┐
│      BaseDeclarativeTool                │
│  - Schema definition                    │
│  - Parameter validation                 │
│  - Factory for invocations              │
└──────────────────┬──────────────────────┘
                   │ creates
                   ▼
┌─────────────────────────────────────────┐
│      BaseToolInvocation                 │
│  - Validated parameters                 │
│  - Confirmation logic                   │
│  - Execution logic                      │
└─────────────────────────────────────────┘
```

**Why two classes?**

1. **Separation of concerns**: Validation is separate from execution
2. **Reusable invocations**: The same validated invocation can be confirmed and executed
3. **Policy integration**: Invocations handle MessageBus communication
4. **Testability**: Each class can be tested independently

### 4.2 Core Tool Interfaces

**File**: `packages/core/src/tools/tools.ts`

```typescript
/**
 * Represents a validated and ready-to-execute tool call.
 */
interface ToolInvocation<TParams extends object, TResult extends ToolResult> {
  // The validated parameters
  params: TParams;

  // Pre-execution description for display
  getDescription(): string;

  // File paths this tool will affect
  toolLocations(): ToolLocation[];

  // Check if confirmation is needed
  shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false>;

  // Execute the tool
  execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<TResult>;
}

/**
 * Interface for a tool builder that validates parameters and creates invocations.
 */
interface ToolBuilder<TParams extends object, TResult extends ToolResult> {
  // Internal name (used for API calls)
  name: string;

  // User-friendly display name
  displayName: string;

  // Description of what the tool does
  description: string;

  // Kind for categorization and permissions
  kind: Kind;

  // Function declaration schema
  schema: FunctionDeclaration;

  // Whether output should be rendered as markdown
  isOutputMarkdown: boolean;

  // Whether the tool supports live output
  canUpdateOutput: boolean;

  // Build a validated invocation
  build(params: TParams): ToolInvocation<TParams, TResult>;
}
```

### 4.3 Base Classes

**BaseToolInvocation** - Base class for tool invocations:

```typescript
abstract class BaseToolInvocation<TParams extends object, TResult extends ToolResult>
  implements ToolInvocation<TParams, TResult> {

  constructor(
    readonly params: TParams,
    protected readonly messageBus: MessageBus,
    readonly _toolName?: string,
    readonly _toolDisplayName?: string,
    readonly _serverName?: string,
  ) {}

  // Must be implemented by subclasses
  abstract getDescription(): string;

  // Default: no file locations
  toolLocations(): ToolLocation[] {
    return [];
  }

  // Policy engine integration via MessageBus
  async shouldConfirmExecute(abortSignal: AbortSignal): Promise<ToolCallConfirmationDetails | false> {
    const decision = await this.getMessageBusDecision(abortSignal);
    if (decision === 'ALLOW') return false;
    if (decision === 'DENY') throw new Error(`Tool execution denied by policy.`);
    if (decision === 'ASK_USER') return this.getConfirmationDetails(abortSignal);
    return this.getConfirmationDetails(abortSignal);
  }

  // Override for custom confirmation UI
  protected async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Default implementation returns generic info confirmation
    return {
      type: 'info',
      title: `Confirm: ${this._toolDisplayName || this._toolName}`,
      prompt: this.getDescription(),
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        await this.publishPolicyUpdate(outcome);
      },
    };
  }

  // Must be implemented by subclasses
  abstract execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<TResult>;
}
```

**BaseDeclarativeTool** - Base class for tool definitions:

```typescript
abstract class BaseDeclarativeTool<TParams extends object, TResult extends ToolResult>
  extends DeclarativeTool<TParams, TResult> {

  // Validates parameters and creates invocation
  build(params: TParams): ToolInvocation<TParams, TResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      throw new Error(validationError);
    }
    return this.createInvocation(
      params,
      this.messageBus,
      this.name,
      this.displayName,
    );
  }

  // JSON schema validation + custom validation
  override validateToolParams(params: TParams): string | null {
    const errors = SchemaValidator.validate(
      this.schema.parametersJsonSchema,
      params,
    );
    if (errors) return errors;
    return this.validateToolParamValues(params);
  }

  // Override for custom value validation
  protected validateToolParamValues(_params: TParams): string | null {
    return null;
  }

  // Must be implemented: factory method for creating invocations
  protected abstract createInvocation(
    params: TParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<TParams, TResult>;
}
```

### 4.4 Tool Kind Enumeration

```typescript
enum Kind {
  Read = 'read',           // File reading (typically auto-approved)
  Edit = 'edit',           // File modifications (requires confirmation)
  Delete = 'delete',       // Deletion operations
  Move = 'move',           // Move/rename operations
  Search = 'search',       // Search operations
  Execute = 'execute',     // Shell execution
  Think = 'think',         // Thinking/reasoning
  Fetch = 'fetch',         // Web fetching
  Communicate = 'communicate', // User communication
  Other = 'other',         // Uncategorized
}

// Mutator kinds (have side effects)
const MUTATOR_KINDS: Kind[] = [Kind.Edit, Kind.Delete, Kind.Move, Kind.Execute];
```

### 4.5 Tool Result Types

```typescript
interface ToolResult {
  // Content for LLM history
  llmContent: PartListUnion;

  // User-friendly display
  returnDisplay: ToolResultDisplay;

  // Present if tool call failed
  error?: {
    message: string;
    type?: ToolErrorType;
  };
}

// Display type variants
type ToolResultDisplay = string | FileDiff | AnsiOutput | TodoList;

// FileDiff for write/edit operations
interface FileDiff {
  fileDiff: string;           // Unified diff format
  fileName: string;
  filePath: string;
  originalContent: string | null;
  newContent: string;
  diffStat?: DiffStat;
  isNewFile?: boolean;
}

// TodoList for task management
interface TodoList {
  todos: Todo[];
}

interface Todo {
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}
```

### 4.6 Confirmation Flow Patterns

**Edit Confirmation** (for write-file, edit tools):

```typescript
interface ToolEditConfirmationDetails {
  type: 'edit';
  title: string;
  fileName: string;
  filePath: string;
  fileDiff: string;
  originalContent: string | null;
  newContent: string;
  onConfirm: (
    outcome: ToolConfirmationOutcome,
    payload?: ToolConfirmationPayload,
  ) => Promise<void>;
  ideConfirmation?: Promise<DiffUpdateResult>;
}
```

**Execution Confirmation** (for shell tool):

```typescript
interface ToolExecuteConfirmationDetails {
  type: 'exec';
  title: string;
  command: string;
  rootCommand: string;
  rootCommands: string[];
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
}
```

**MCP Tool Confirmation**:

```typescript
interface ToolMcpConfirmationDetails {
  type: 'mcp';
  title: string;
  serverName: string;
  toolName: string;
  toolDisplayName: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
}
```

**Info Confirmation** (generic):

```typescript
interface ToolInfoConfirmationDetails {
  type: 'info';
  title: string;
  prompt: string;
  urls?: string[];
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
}
```

**Confirmation Outcomes**:

```typescript
enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',           // Execute this time only
  ProceedAlways = 'proceed_always',       // Auto-approve for session
  ProceedAlwaysAndSave = 'proceed_always_and_save', // Save to policy
  ProceedAlwaysServer = 'proceed_always_server',   // Trust MCP server
  ProceedAlwaysTool = 'proceed_always_tool',       // Trust specific MCP tool
  ModifyWithEditor = 'modify_with_editor', // Edit before applying
  Cancel = 'cancel',                       // Reject execution
}
```

### 4.7 Complete Tool Implementation Example: ReadFileTool

**File**: `packages/core/src/tools/read-file.ts`

This is a real implementation showing the full pattern:

```typescript
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import path from 'node:path';
import { makeRelative, shortenPath } from '../utils/paths.js';
import type { ToolInvocation, ToolLocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { PartUnion } from '@google/genai';
import { processSingleFileContent } from '../utils/fileUtils.js';
import type { Config } from '../config/config.js';
import { READ_FILE_TOOL_NAME } from './tool-names.js';

// 1. Parameter Interface
export interface ReadFileToolParams {
  file_path: string;
  offset?: number;
  limit?: number;
}

// 2. Invocation Class
class ReadFileToolInvocation extends BaseToolInvocation<
  ReadFileToolParams,
  ToolResult
> {
  private readonly resolvedPath: string;

  constructor(
    private config: Config,
    params: ReadFileToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
    this.resolvedPath = path.resolve(
      this.config.getTargetDir(),
      this.params.file_path,
    );
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.resolvedPath,
      this.config.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.resolvedPath, line: this.params.offset }];
  }

  async execute(): Promise<ToolResult> {
    const result = await processSingleFileContent(
      this.resolvedPath,
      this.config.getTargetDir(),
      this.config.getFileSystemService(),
      this.params.offset,
      this.params.limit,
    );

    if (result.error) {
      return {
        llmContent: result.llmContent,
        returnDisplay: result.returnDisplay || 'Error reading file',
        error: {
          message: result.error,
          type: result.errorType,
        },
      };
    }

    let llmContent: PartUnion;
    if (result.isTruncated) {
      const [start, end] = result.linesShown!;
      const total = result.originalLineCount!;
      const nextOffset = this.params.offset
        ? this.params.offset + end - start + 1
        : end;
      llmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines ${start}-${end} of ${total} total lines.
Action: To read more, use offset: ${nextOffset}.

--- FILE CONTENT (truncated) ---
${result.llmContent}`;
    } else {
      llmContent = result.llmContent || '';
    }

    return {
      llmContent,
      returnDisplay: result.returnDisplay || '',
    };
  }
}

// 3. Tool Definition Class
export class ReadFileTool extends BaseDeclarativeTool<
  ReadFileToolParams,
  ToolResult
> {
  static readonly Name = READ_FILE_TOOL_NAME;

  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    super(
      ReadFileTool.Name,
      'ReadFile',
      `Reads and returns the content of a specified file. If the file is large,
       the content will be truncated. Handles text, images, audio, and PDF files.`,
      Kind.Read,
      {
        properties: {
          file_path: {
            description: 'The path to the file to read.',
            type: 'string',
          },
          offset: {
            description: 'Line number to start reading from (0-based).',
            type: 'number',
          },
          limit: {
            description: 'Maximum number of lines to read.',
            type: 'number',
          },
        },
        required: ['file_path'],
        type: 'object',
      },
      messageBus,
      true,  // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  protected override validateToolParamValues(
    params: ReadFileToolParams,
  ): string | null {
    if (params.file_path.trim() === '') {
      return "The 'file_path' parameter must be non-empty.";
    }

    // Validate path is within workspace
    const workspaceContext = this.config.getWorkspaceContext();
    const resolvedPath = path.resolve(
      this.config.getTargetDir(),
      params.file_path,
    );

    if (!workspaceContext.isPathWithinWorkspace(resolvedPath)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within workspace: ${directories.join(', ')}`;
    }

    if (params.offset !== undefined && params.offset < 0) {
      return 'Offset must be a non-negative number';
    }
    if (params.limit !== undefined && params.limit <= 0) {
      return 'Limit must be a positive number';
    }

    return null;
  }

  protected createInvocation(
    params: ReadFileToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<ReadFileToolParams, ToolResult> {
    return new ReadFileToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
```

### 4.8 Tool with Custom Confirmation: ShellTool

**File**: `packages/core/src/tools/shell.ts` (excerpt)

Tools that need confirmation override `getConfirmationDetails()`:

```typescript
export interface ShellToolParams {
  command: string;
  description?: string;
  dir_path?: string;
}

export class ShellToolInvocation extends BaseToolInvocation<
  ShellToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ShellToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    let description = `${this.params.command}`;
    if (this.params.dir_path) {
      description += ` [in ${this.params.dir_path}]`;
    }
    if (this.params.description) {
      description += ` (${this.params.description.replace(/\n/g, ' ')})`;
    }
    return description;
  }

  // Custom policy update options for command-specific allowlisting
  protected override getPolicyUpdateOptions(
    outcome: ToolConfirmationOutcome,
  ): PolicyUpdateOptions | undefined {
    if (
      outcome === ToolConfirmationOutcome.ProceedAlwaysAndSave ||
      outcome === ToolConfirmationOutcome.ProceedAlways
    ) {
      const command = stripShellWrapper(this.params.command);
      const rootCommands = [...new Set(getCommandRoots(command))];
      if (rootCommands.length > 0) {
        return { commandPrefix: rootCommands };
      }
      return { commandPrefix: this.params.command };
    }
    return undefined;
  }

  // Custom confirmation with command analysis
  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const command = stripShellWrapper(this.params.command);
    const parsed = parseCommandDetails(command);

    let rootCommandDisplay = '';
    if (!parsed || parsed.hasError || parsed.details.length === 0) {
      const fallback = command.trim().split(/\s+/)[0];
      rootCommandDisplay = fallback || 'shell command';
    } else {
      rootCommandDisplay = parsed.details.map((d) => d.name).join(', ');
    }

    const rootCommands = [...new Set(getCommandRoots(command))];

    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: this.params.command,
      rootCommand: rootCommandDisplay,
      rootCommands,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        await this.publishPolicyUpdate(outcome);
      },
    };
    return confirmationDetails;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<ToolResult> {
    // Shell execution implementation...
  }
}
```

### 4.9 Tool Registration

**File**: `packages/core/src/config/config.ts` (excerpt from createToolRegistry)

```typescript
async createToolRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry(this, this.messageBus);

  // Helper to register core tools that are enabled
  const registerCoreTool = (ToolClass: any, ...args: unknown[]) => {
    const toolName = ToolClass.Name;
    const coreTools = this.getCoreTools();

    let isEnabled = true;
    if (coreTools) {
      isEnabled = coreTools.some(
        (tool) => tool === toolName || tool.startsWith(`${toolName}(`),
      );
    }

    if (isEnabled) {
      const toolArgs = [...args, this.getMessageBus()];
      registry.registerTool(new ToolClass(...toolArgs));
    }
  };

  // Register built-in tools
  registerCoreTool(LSTool, this);
  registerCoreTool(ReadFileTool, this);
  registerCoreTool(GrepTool, this);
  registerCoreTool(GlobTool, this);
  registerCoreTool(EditTool, this);
  registerCoreTool(WriteFileTool, this);
  registerCoreTool(WebFetchTool, this);
  registerCoreTool(ShellTool, this);
  registerCoreTool(MemoryTool);
  registerCoreTool(WebSearchTool, this);

  // Register subagent tools
  this.registerSubAgentTools(registry);

  // Discover tools from MCP servers and project config
  await registry.discoverAllTools();
  registry.sortTools();
  return registry;
}
```

### 4.10 Step-by-Step: Adding a New Tool

1. **Create file**: `packages/core/src/tools/my-tool.ts`

2. **Add tool name constant**: Add to `packages/core/src/tools/tool-names.ts`:
   ```typescript
   export const MY_TOOL_NAME = 'my_tool';
   ```

3. **Define params interface**:
   ```typescript
   export interface MyToolParams {
     required_param: string;
     optional_param?: number;
   }
   ```

4. **Create invocation class**:
   ```typescript
   class MyToolInvocation extends BaseToolInvocation<MyToolParams, ToolResult> {
     constructor(
       private config: Config,
       params: MyToolParams,
       messageBus: MessageBus,
       toolName?: string,
       toolDisplayName?: string,
     ) {
       super(params, messageBus, toolName, toolDisplayName);
     }

     getDescription(): string {
       return `Processing ${this.params.required_param}`;
     }

     async execute(signal: AbortSignal): Promise<ToolResult> {
       // Implementation
       return {
         llmContent: 'Result text',
         returnDisplay: 'Display text',
       };
     }
   }
   ```

5. **Create tool class**:
   ```typescript
   export class MyTool extends BaseDeclarativeTool<MyToolParams, ToolResult> {
     static readonly Name = MY_TOOL_NAME;

     constructor(config: Config, messageBus: MessageBus) {
       super(
         MyTool.Name,
         'MyTool',
         'Description for the LLM',
         Kind.Other,
         {
           type: 'object',
           properties: {
             required_param: { type: 'string', description: '...' },
             optional_param: { type: 'number', description: '...' },
           },
           required: ['required_param'],
         },
         messageBus,
       );
     }

     protected createInvocation(
       params: MyToolParams,
       messageBus: MessageBus,
       toolName?: string,
       toolDisplayName?: string,
     ): ToolInvocation<MyToolParams, ToolResult> {
       return new MyToolInvocation(
         this.config,
         params,
         messageBus,
         toolName,
         toolDisplayName,
       );
     }
   }
   ```

6. **Register in Config**: Add to `createToolRegistry()` in `config.ts`:
   ```typescript
   registerCoreTool(MyTool, this);
   ```

7. **Export from index**: Add to `packages/core/src/index.ts` if needed

8. **Write tests**: Create `packages/core/src/tools/my-tool.test.ts`

9. **Run preflight**: `npm run preflight`

---

## 5. The Command System

### 5.1 SlashCommand Interface

**File**: `packages/cli/src/ui/commands/types.ts`

```typescript
interface SlashCommand {
  // Primary command name (e.g., 'help', 'model')
  name: string;

  // Alternative names/aliases (e.g., ['?'] for help)
  altNames?: string[];

  // Shown in autocomplete
  description: string;

  // Hide from autocomplete
  hidden?: boolean;

  // Categorization
  kind: CommandKind;

  // If true, Enter executes immediately; if false, Enter autocompletes
  autoExecute?: boolean;

  // Optional metadata for extension commands
  extensionName?: string;
  extensionId?: string;

  // The action to run (optional for parent commands with subcommands)
  action?: (
    context: CommandContext,
    args: string,
  ) =>
    | void
    | SlashCommandActionReturn
    | Promise<void | SlashCommandActionReturn>;

  // Provides argument completion
  completion?: (
    context: CommandContext,
    partialArg: string,
  ) => Promise<string[]> | string[];

  // Show loading indicator while fetching completions
  showCompletionLoading?: boolean;

  // Nested commands (e.g., /chat list, /chat resume)
  subCommands?: SlashCommand[];
}

enum CommandKind {
  BUILT_IN = 'built-in',
  FILE = 'file',
  MCP_PROMPT = 'mcp-prompt',
  AGENT = 'agent',
}
```

### 5.2 CommandContext

The `CommandContext` provides access to services and UI methods:

```typescript
interface CommandContext {
  // Invocation details
  invocation?: {
    raw: string;      // Original input (e.g., "/model sonnet")
    name: string;     // Matched command name (e.g., "model")
    args: string;     // Arguments after command (e.g., "sonnet")
  };

  // Core services
  services: {
    config: Config | null;
    settings: LoadedSettings;
    git: GitService | undefined;
    logger: Logger;
  };

  // UI state and methods
  ui: {
    addItem: (item: HistoryItemWithoutId, timestamp?: number) => void;
    clear: () => void;
    setDebugMessage: (message: string) => void;
    pendingItem: HistoryItemWithoutId | null;
    setPendingItem: (item: HistoryItemWithoutId | null) => void;
    loadHistory: (history: HistoryItem[], postLoadInput?: string) => void;
    toggleCorgiMode: () => void;
    toggleVimEnabled: () => Promise<boolean>;
    reloadCommands: () => void;
    openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
    extensionsUpdateState: Map<string, ExtensionUpdateStatus>;
    removeComponent: () => void;
  };

  // Session data
  session: {
    stats: SessionStatsState;
    sessionShellAllowlist: Set<string>;
  };

  // Confirmation flag
  overwriteConfirmed?: boolean;
}
```

### 5.3 Action Return Types

```typescript
type SlashCommandActionReturn =
  // Return items to add to history
  | CommandActionReturn<HistoryItemWithoutId[]>
  // Quit the application
  | QuitActionReturn
  // Open a dialog
  | OpenDialogActionReturn
  // Request shell command confirmation
  | ConfirmShellCommandsActionReturn
  // Generic confirmation
  | ConfirmActionReturn
  // Custom dialog component
  | OpenCustomDialogActionReturn
  // Logout
  | LogoutActionReturn;

interface QuitActionReturn {
  type: 'quit';
  messages: HistoryItem[];
}

interface OpenDialogActionReturn {
  type: 'dialog';
  props?: Record<string, unknown>;
  dialog:
    | 'help'
    | 'auth'
    | 'theme'
    | 'editor'
    | 'privacy'
    | 'settings'
    | 'sessionBrowser'
    | 'model'
    | 'agentConfig'
    | 'permissions';
}

interface ConfirmActionReturn {
  type: 'confirm_action';
  prompt: ReactNode;
  originalInvocation: { raw: string };
}
```

### 5.4 Command Examples

**Simple Command: /clear**

```typescript
// File: packages/cli/src/ui/commands/clearCommand.ts

import { uiTelemetryService, SessionEndReason, SessionStartSource } from '@google/gemini-cli-core';
import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import { randomUUID } from 'node:crypto';

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear the screen and conversation history',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, _args) => {
    const geminiClient = context.services.config?.getGeminiClient();
    const config = context.services.config;

    // Fire SessionEnd hook before clearing
    const hookSystem = config?.getHookSystem();
    if (hookSystem) {
      await hookSystem.fireSessionEndEvent(SessionEndReason.Clear);
    }

    if (geminiClient) {
      context.ui.setDebugMessage('Clearing terminal and resetting chat.');
      await geminiClient.resetChat();
    }

    // Start a new session
    if (config) {
      const newSessionId = randomUUID();
      config.setSessionId(newSessionId);
    }

    // Fire SessionStart hook
    let result;
    if (hookSystem) {
      result = await hookSystem.fireSessionStartEvent(SessionStartSource.Clear);
    }

    uiTelemetryService.setLastPromptTokenCount(0);
    context.ui.clear();

    if (result?.systemMessage) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: result.systemMessage,
      }, Date.now());
    }
  },
};
```

**Dialog Command: /model**

```typescript
export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Opens a dialog to configure the model',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    if (context.services.config) {
      await context.services.config.refreshUserQuota();
    }
    return { type: 'dialog', dialog: 'model' };
  },
};
```

**Command with Subcommands: /chat**

```typescript
const listCommand: SlashCommand = {
  name: 'list',
  description: 'List saved conversations',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const chats = await getSavedChatTags(context, true);
    // Display list...
    return { type: 'message', messageType: 'info', content: formatList(chats) };
  },
};

const resumeCommand: SlashCommand = {
  name: 'resume',
  altNames: ['load'],
  description: 'Resume a conversation. Usage: /chat resume <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args) => {
    const tag = args.trim();
    if (!tag) {
      return { type: 'message', messageType: 'error', content: 'Missing tag' };
    }
    // Load conversation...
    return { type: 'load_history', history, clientHistory };
  },
  completion: async (context, partialArg) => {
    const chats = await getSavedChatTags(context, true);
    return chats.map(c => c.name).filter(n => n.startsWith(partialArg));
  },
};

export const chatCommand: SlashCommand = {
  name: 'chat',
  description: 'Manage conversation history',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [listCommand, resumeCommand, deleteCommand, saveCommand],
};
```

**Command with Confirmation**

```typescript
export const dangerousCommand: SlashCommand = {
  name: 'dangerous',
  description: 'Does something dangerous',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args) => {
    // Check if already confirmed
    if (!context.overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: <Text>Are you sure you want to do this?</Text>,
        originalInvocation: { raw: `/dangerous ${args}` },
      };
    }
    // Proceed with dangerous action...
  },
};
```

### 5.5 CommandService and Loaders

**File**: `packages/cli/src/services/CommandService.ts`

Commands are loaded via loader classes:

```typescript
interface ICommandLoader {
  loadCommands(signal: AbortSignal): Promise<SlashCommand[]>;
}

class CommandService {
  static async create(
    loaders: ICommandLoader[],
    signal: AbortSignal,
  ): Promise<CommandService> {
    // Run all loaders in parallel
    const results = await Promise.allSettled(
      loaders.map((loader) => loader.loadCommands(signal)),
    );

    // Aggregate and handle conflicts
    const commandMap = new Map<string, SlashCommand>();
    for (const cmd of allCommands) {
      // Extension conflicts get renamed to "extensionName.commandName"
      commandMap.set(finalName, cmd);
    }

    return new CommandService(Array.from(commandMap.values()));
  }
}
```

**Loaders**:

- `BuiltinCommandLoader`: 30+ built-in commands
- `FileCommandLoader`: `.toml` files from `.gemini/commands/`
- `McpPromptLoader`: Commands from MCP servers

### 5.6 Step-by-Step: Adding a New Command

1. **Create file**: `packages/cli/src/ui/commands/myCommand.ts`

2. **Implement SlashCommand**:
   ```typescript
   import type { SlashCommand } from './types.js';
   import { CommandKind } from './types.js';

   export const myCommand: SlashCommand = {
     name: 'my-command',
     altNames: ['mc'], // optional aliases
     description: 'Does something useful',
     kind: CommandKind.BUILT_IN,
     autoExecute: true,
     action: async (context, args) => {
       // Implementation
     },
   };
   ```

3. **Add to BuiltinCommandLoader**: In `packages/cli/src/ui/commands/index.ts`:
   ```typescript
   export { myCommand } from './myCommand.js';
   ```

4. **Write tests**: Create `packages/cli/src/ui/commands/myCommand.test.ts`

5. **Run preflight**: `npm run preflight`

---

## 6. Extension System

### 6.1 Extension Architecture

Extensions provide a way to add custom functionality without modifying core code.

**Extension Manifest**: `gemini-extension.json`

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["${extensionPath}/server.js"]
    }
  },
  "contextFileName": "GEMINI.md",
  "settings": [
    {
      "name": "API_KEY",
      "envVar": "MY_API_KEY",
      "sensitive": true
    }
  ]
}
```

**GeminiCLIExtension Interface**:

```typescript
interface GeminiCLIExtension {
  name: string;
  version: string;
  isActive: boolean;
  path: string;
  id: string;
  installMetadata?: ExtensionInstallMetadata;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFiles: string[];
  excludeTools?: string[];
  hooks?: { [K in HookEventName]?: HookDefinition[] };
  settings?: ExtensionSetting[];
  resolvedSettings?: ResolvedExtensionSetting[];
  skills?: SkillDefinition[];
  agents?: AgentDefinition[];
}
```

### 6.2 Skills System

Skills are reusable prompt templates.

**Skill Definition**: `SKILL.md` file

```markdown
---
name: my-skill
description: What this skill does
---

Your skill instructions here. These become the system prompt
when the skill is activated.
```

**SkillManager Methods**:

```typescript
class SkillManager {
  // Discover skills from all sources
  async discoverSkills(storage: Storage, extensions: GeminiCLIExtension[]): Promise<void>;

  // Get enabled skills
  getSkills(): SkillDefinition[];

  // Get a specific skill
  getSkill(name: string): SkillDefinition | null;

  // Manage disabled skills
  setDisabledSkills(names: string[]): void;
}
```

**Precedence** (lowest to highest): Built-in → Extensions → User → Workspace

### 6.3 Hooks System

Hooks provide customization points at various stages of execution.

**Hook Events**:

```typescript
enum HookEventName {
  BeforeTool = 'BeforeTool',         // Before tool execution
  AfterTool = 'AfterTool',           // After tool execution
  BeforeAgent = 'BeforeAgent',       // Before agent start
  AfterAgent = 'AfterAgent',         // After agent completion
  Notification = 'Notification',     // Notifications
  SessionStart = 'SessionStart',     // Session initialization
  SessionEnd = 'SessionEnd',         // Session termination
  PreCompress = 'PreCompress',       // Before history compression
  BeforeModel = 'BeforeModel',       // Before model API call
  AfterModel = 'AfterModel',         // After model response
  BeforeToolSelection = 'BeforeToolSelection', // Before tool selection
}
```

**Hook Configuration**: `hooks.toml`

```toml
[hooks.BeforeTool]
sequential = true
hooks = [
  { type = "command", command = "node ${extensionPath}/validate.js" }
]

[hooks.AfterTool]
hooks = [
  { type = "command", command = "echo 'Tool completed'" }
]
```

**Hook I/O** (JSON via stdin/stdout):

```typescript
// Input sent to hook command
interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  timestamp: string;
}

// Output expected from hook command
interface HookOutput {
  continue?: boolean;           // Continue execution
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;       // Modify system prompt
  decision?: HookDecision;      // 'allow'|'deny'|'ask'|'block'
  reason?: string;
  hookSpecificOutput?: Record<string, unknown>;
}
```

**Hook Exit Codes**:
- `0`: Success, continue execution
- `1`: Warning (logged but continues)
- `2`: Blocking error (stops execution)

### 6.4 Agents System

Agents are autonomous sub-systems that execute multi-turn tasks.

**Agent Definition Types**:

```typescript
interface LocalAgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown>
  extends BaseAgentDefinition<TOutput> {
  kind: 'local';
  promptConfig: PromptConfig;     // System prompt, initial messages
  modelConfig: ModelConfig;       // Model selection
  runConfig: RunConfig;           // Timeout, max turns
  toolConfig?: ToolConfig;        // Available tools
  processOutput?: (output: z.infer<TOutput>) => string;
}

interface RemoteAgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown>
  extends BaseAgentDefinition<TOutput> {
  kind: 'remote';
  agentCardUrl: string;           // Remote agent endpoint
}

interface PromptConfig {
  systemPrompt?: string;
  initialMessages?: Content[];
  query?: string;
}

interface RunConfig {
  maxTimeMinutes: number;
  maxTurns?: number;
}

interface ToolConfig {
  tools: Array<string | FunctionDeclaration | AnyDeclarativeTool>;
}
```

**Agent Definition File**: `agent.md`

```markdown
---
name: code-reviewer
display_name: Code Reviewer
description: Reviews code for quality
kind: local
tools:
  - Bash
  - Read
model: gemini-2.0-flash
max_turns: 10
---

You are an expert code reviewer. Analyze the code provided and...
```

### 6.5 MCP Integration

MCP (Model Context Protocol) servers provide additional tools.

**MCP Server Config**:

```typescript
class MCPServerConfig {
  constructor(
    // For stdio transport
    readonly command?: string,
    readonly args?: string[],
    readonly env?: Record<string, string>,
    readonly cwd?: string,
    // For SSE/HTTP transport
    readonly url?: string,
    readonly type?: 'sse' | 'http',
    // For WebSocket transport
    readonly tcp?: string,
    // Common
    readonly timeout?: number,
    readonly trust?: boolean,
    readonly description?: string,
    readonly includeTools?: string[],
    readonly excludeTools?: string[],
    readonly oauth?: MCPOAuthConfig,
  ) {}
}
```

**MCP Server Example**:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });

server.registerTool('my_tool', {
  description: 'Does something',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    },
    required: ['input'],
  },
}, async (args) => {
  return { content: [{ type: 'text', text: 'Result' }] };
});

await server.connect(new StdioServerTransport());
```

**MCP Settings**: `~/.gemini/mcp-settings.json`

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"],
      "trust": true
    }
  }
}
```

---

## 7. Configuration System

### 7.1 Settings Hierarchy

```
CLI Arguments (highest priority)
       ↓
Environment Variables
       ↓
Project Settings (.gemini/settings.json)
       ↓
User Settings (~/.gemini/settings.json)
       ↓
Default Values (lowest priority)
```

### 7.2 Key Configuration Files

| File | Purpose | Scope |
|------|---------|-------|
| `~/.gemini/settings.json` | User settings | Global |
| `.gemini/settings.json` | Project settings | Project |
| `GEMINI.md` | Project context | Project |
| `~/.gemini/auth-cache.json` | Auth tokens | Global |
| `~/.gemini/mcp-settings.json` | MCP server config | Global |
| `.gemini/hooks.toml` | Project hooks | Project |
| `~/.gemini/hooks.toml` | User hooks | Global |
| `.gemini/policies.toml` | Project policies | Project |

### 7.3 ConfigParameters Interface

Key configuration options:

```typescript
interface ConfigParameters {
  sessionId: string;
  targetDir: string;
  debugMode: boolean;
  model: string;

  // Tool configuration
  coreTools?: string[];         // Enabled core tools
  allowedTools?: string[];      // Additional allowed tools
  excludeTools?: string[];      // Tools to exclude

  // MCP configuration
  mcpServers?: Record<string, MCPServerConfig>;
  mcpEnabled?: boolean;

  // Approval modes
  approvalMode?: ApprovalMode;

  // Features
  sandbox?: SandboxConfig;
  checkpointing?: boolean;
  enableHooks?: boolean;
  enableAgents?: boolean;
  skillsSupport?: boolean;

  // Telemetry
  telemetry?: TelemetrySettings;

  // Output
  output?: OutputSettings;
}
```

### 7.4 Settings File Format

**User/Project Settings** (`settings.json`):

```json
{
  "model": "gemini-2.0-flash",
  "approvalMode": "default",
  "sandbox": {
    "command": "docker",
    "image": "gemini-sandbox"
  },
  "telemetry": {
    "enabled": true
  },
  "fileFiltering": {
    "respectGitIgnore": true,
    "maxFileCount": 20000
  },
  "mcpServers": {
    "local-server": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

---

## 8. Testing Guide

### 8.1 Test Structure

```
packages/core/src/tools/read-file.test.ts   # Unit test alongside source
packages/cli/src/ui/commands/clear.test.ts  # Command test
integration-tests/                           # E2E tests
```

### 8.2 Test Commands

```bash
# Run all unit tests
npm run test

# Run specific test file
npm run test -- read-file.test.ts

# Run integration tests
npm run test:e2e

# Run integration tests with Docker sandbox
npm run test:integration:sandbox:docker

# Full validation (lint, typecheck, test)
npm run preflight

# De-flake tests (run multiple times)
npm run deflake -- --runs=5
```

### 8.3 Testing Patterns

**Environment Variables**:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('MyTool', () => {
  beforeEach(() => {
    vi.stubEnv('MY_VAR', 'test-value');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should use environment variable', () => {
    expect(process.env.MY_VAR).toBe('test-value');
  });
});
```

**Command Testing**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearCommand } from './clearCommand.js';
import { MessageType } from '../types.js';

describe('clearCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      services: {
        config: {
          getGeminiClient: vi.fn().mockReturnValue({
            resetChat: vi.fn().mockResolvedValue(undefined),
          }),
          getHookSystem: vi.fn().mockReturnValue(undefined),
          setSessionId: vi.fn(),
        },
        settings: {},
        git: undefined,
        logger: { log: vi.fn() },
      },
      ui: {
        addItem: vi.fn(),
        clear: vi.fn(),
        setDebugMessage: vi.fn(),
        setPendingItem: vi.fn(),
      },
      session: {
        stats: {},
        sessionShellAllowlist: new Set(),
      },
    } as unknown as CommandContext;
  });

  it('should clear the UI', async () => {
    await clearCommand.action!(mockContext, '');
    expect(mockContext.ui.clear).toHaveBeenCalled();
  });

  it('should reset the chat', async () => {
    await clearCommand.action!(mockContext, '');
    expect(mockContext.services.config?.getGeminiClient().resetChat).toHaveBeenCalled();
  });
});
```

**Tool Testing**:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReadFileTool } from './read-file.js';

describe('ReadFileTool', () => {
  const mockConfig = {
    getTargetDir: vi.fn().mockReturnValue('/workspace'),
    getWorkspaceContext: vi.fn().mockReturnValue({
      isPathWithinWorkspace: vi.fn().mockReturnValue(true),
      getDirectories: vi.fn().mockReturnValue(['/workspace']),
    }),
    getFileSystemService: vi.fn(),
    getFileService: vi.fn().mockReturnValue({
      shouldIgnoreFile: vi.fn().mockReturnValue(false),
    }),
    getFileFilteringOptions: vi.fn().mockReturnValue({}),
    storage: { getProjectTempDir: vi.fn().mockReturnValue('/tmp') },
  };

  const mockMessageBus = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };

  it('should validate file_path is non-empty', () => {
    const tool = new ReadFileTool(mockConfig as any, mockMessageBus as any);
    expect(() => tool.build({ file_path: '' })).toThrow('non-empty');
  });

  it('should validate path is within workspace', () => {
    mockConfig.getWorkspaceContext().isPathWithinWorkspace.mockReturnValue(false);
    const tool = new ReadFileTool(mockConfig as any, mockMessageBus as any);
    expect(() => tool.build({ file_path: '/outside/file.txt' })).toThrow('within');
  });

  it('should create valid invocation', () => {
    mockConfig.getWorkspaceContext().isPathWithinWorkspace.mockReturnValue(true);
    const tool = new ReadFileTool(mockConfig as any, mockMessageBus as any);
    const invocation = tool.build({ file_path: 'test.txt' });
    expect(invocation).toBeDefined();
    expect(invocation.params.file_path).toBe('test.txt');
  });
});
```

### 8.4 Integration Testing

Integration tests live in `integration-tests/` and test end-to-end flows:

```typescript
// integration-tests/tools/shell.test.ts
import { describe, it, expect } from 'vitest';
import { createTestConfig, executeCommand } from '../test-utils.js';

describe('Shell Tool Integration', () => {
  it('should execute simple command', async () => {
    const config = await createTestConfig();
    const result = await executeCommand(config, 'echo "hello"');
    expect(result.output).toContain('hello');
  });
});
```

---

## 9. Common Development Workflows

### 9.1 Adding a New Tool

See [Section 4.10](#410-step-by-step-adding-a-new-tool) for detailed steps.

**Quick Checklist**:

- [ ] Create `packages/core/src/tools/my-tool.ts`
- [ ] Add name to `tool-names.ts`
- [ ] Define params interface
- [ ] Create invocation class extending `BaseToolInvocation`
- [ ] Create tool class extending `BaseDeclarativeTool`
- [ ] Register in `Config.createToolRegistry()`
- [ ] Add tests
- [ ] Run `npm run preflight`

### 9.2 Adding a New Command

See [Section 5.6](#56-step-by-step-adding-a-new-command) for detailed steps.

**Quick Checklist**:

- [ ] Create `packages/cli/src/ui/commands/myCommand.ts`
- [ ] Implement `SlashCommand` interface
- [ ] Export from `index.ts`
- [ ] Add tests
- [ ] Run `npm run preflight`

### 9.3 Adding an Extension

**Quick Checklist**:

- [ ] Create `gemini-extension.json` manifest
- [ ] Add MCP server (optional): `server.js`
- [ ] Add skills in `skills/` directory
- [ ] Add hooks in `hooks.json`
- [ ] Add agents in `agents/` directory
- [ ] Install with `gemini extensions install <path>`

### 9.4 Debugging Tips

**Enable Debug Mode**:

```bash
gemini --debug
```

**Debug Logging**:

```typescript
import { debugLogger } from '../utils/debugLogger.js';

debugLogger.debug('My message', { context: 'data' });
debugLogger.error('Error occurred', error);
```

**Inspect MessageBus**:

```typescript
messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, (msg) => {
  console.log('Confirmation request:', msg);
});
```

---

## 10. Gotchas and Common Pitfalls

### 10.1 Async Initialization

**Problem**: Using `Config` services before initialization.

```typescript
// ❌ Wrong
const config = new Config(params);
const tools = config.getToolRegistry(); // May be undefined!

// ✅ Correct
const config = new Config(params);
await config.initialize();
const tools = config.getToolRegistry();
```

### 10.2 Import Restrictions

**Problem**: ESLint enforces package boundaries.

```typescript
// ❌ Wrong: CLI importing from Core internals
import { someInternalFn } from '@google/gemini-cli-core/src/internal/module.js';

// ✅ Correct: Import from public API
import { publicFn } from '@google/gemini-cli-core';
```

### 10.3 Tool Two-Class Pattern

**Problem**: Forgetting to separate validation and execution.

```typescript
// ❌ Wrong: Single class doing everything
class MyTool {
  execute(params) {
    // Validation mixed with execution
    if (!params.required) throw new Error('Missing required');
    // Do work...
  }
}

// ✅ Correct: Two-class pattern
class MyToolInvocation extends BaseToolInvocation { /* execute */ }
class MyTool extends BaseDeclarativeTool { /* build, validate */ }
```

### 10.4 MessageBus Required

**Problem**: Tools need MessageBus for policy integration.

```typescript
// ❌ Wrong: Missing MessageBus
const tool = new MyTool(config);

// ✅ Correct: Pass MessageBus
const tool = new MyTool(config, config.getMessageBus());
```

### 10.5 AbortSignal Handling

**Problem**: Not respecting cancellation signals.

```typescript
// ❌ Wrong: Ignoring signal
async execute(signal: AbortSignal) {
  await longOperation(); // Can't be cancelled
}

// ✅ Correct: Check signal
async execute(signal: AbortSignal) {
  if (signal.aborted) {
    return { llmContent: 'Cancelled', returnDisplay: 'Cancelled' };
  }
  await longOperation({ signal });
}
```

### 10.6 Environment Variables in Tests

**Problem**: Tests polluting environment.

```typescript
// ❌ Wrong: Direct assignment
process.env.MY_VAR = 'test';
// Leaks to other tests!

// ✅ Correct: Use vi.stubEnv
beforeEach(() => vi.stubEnv('MY_VAR', 'test'));
afterEach(() => vi.unstubAllEnvs());
```

### 10.7 Node.js Version

**Problem**: Using wrong Node.js version.

The project requires Node.js `~20.19.0`. Use nvm:

```bash
nvm use
# or
nvm install
```

### 10.8 Ink Fork

**Problem**: Using standard Ink instead of fork.

The project uses a custom Ink fork: `@jrichman/ink@6.4.7`. Import from there:

```typescript
// ❌ Wrong
import { Box, Text } from 'ink';

// ✅ Correct
import { Box, Text } from '@jrichman/ink';
```

### 10.9 Trusted Folders

**Problem**: Project hooks running in untrusted folders.

```typescript
// Check before running project hooks
if (!config.isTrustedFolder()) {
  // Skip project-level hooks
  return;
}
```

### 10.10 Hook Exit Codes

**Problem**: Wrong exit codes in hook scripts.

```bash
# Exit codes:
# 0 = Success
# 1 = Warning (logged, continues)
# 2 = Blocking error (stops execution)

# ❌ Wrong: Using exit 1 to block
exit 1  # Only logs warning

# ✅ Correct: Use exit 2 to block
exit 2  # Blocks execution
```

---

## 11. Quick Reference

### 11.1 Package Locations

| Package | Location | Purpose |
|---------|----------|---------|
| CLI | `packages/cli` | Terminal UI, commands |
| Core | `packages/core` | Backend, tools, API |
| A2A | `packages/a2a-server` | Agent-to-Agent server |
| Test Utils | `packages/test-utils` | Testing utilities |

### 11.2 Key Interfaces

| Interface | Location |
|-----------|----------|
| `ToolInvocation` | `packages/core/src/tools/tools.ts` |
| `BaseDeclarativeTool` | `packages/core/src/tools/tools.ts` |
| `ToolResult` | `packages/core/src/tools/tools.ts` |
| `SlashCommand` | `packages/cli/src/ui/commands/types.ts` |
| `CommandContext` | `packages/cli/src/ui/commands/types.ts` |
| `Config` | `packages/core/src/config/config.ts` |
| `GeminiClient` | `packages/core/src/core/client.ts` |
| `ToolRegistry` | `packages/core/src/tools/tool-registry.ts` |
| `PolicyEngine` | `packages/core/src/policy/policy-engine.ts` |
| `HookEventName` | `packages/core/src/hooks/types.ts` |
| `AgentDefinition` | `packages/core/src/agents/types.ts` |

### 11.3 Common Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development
npm run start

# Run tests
npm run test

# Run specific test
npm run test -- my-tool.test.ts

# Full validation
npm run preflight

# Auto-fix linting
npm run lint:fix

# Type checking
npm run typecheck

# Generate coverage
npm run test:coverage
```

### 11.4 File Patterns

| Pattern | Purpose |
|---------|---------|
| `*.ts` | TypeScript source |
| `*.test.ts` | Test file (alongside source) |
| `*.d.ts` | Type declarations |
| `GEMINI.md` | Project context file |
| `SKILL.md` | Skill definition |
| `agent.md` | Agent definition |
| `hooks.toml` | Hook configuration |
| `policies.toml` | Policy rules |
| `gemini-extension.json` | Extension manifest |

### 11.5 Import Aliases

```typescript
// Core package
import { Config, ToolRegistry } from '@google/gemini-cli-core';

// Types
import type { ToolResult, SlashCommand } from '@google/gemini-cli-core';
```

### 11.6 Tool Categories

| Kind | Description | Auto-Approve |
|------|-------------|--------------|
| `Read` | File reading | Yes |
| `Search` | Text search | Yes |
| `Think` | Reasoning | Yes |
| `Edit` | File editing | No |
| `Delete` | File deletion | No |
| `Move` | Move/rename | No |
| `Execute` | Shell execution | No |
| `Fetch` | Web requests | Depends |
| `Communicate` | User comms | Yes |

### 11.7 Approval Modes

| Mode | Description |
|------|-------------|
| `default` | Confirm mutations |
| `autoEdit` | Auto-confirm edits |
| `yolo` | Auto-confirm all (trusted only) |
| `plan` | Preview-only mode |

### 11.8 Hook Events

| Event | When |
|-------|------|
| `SessionStart` | Session begins |
| `SessionEnd` | Session ends |
| `BeforeModel` | Before API call |
| `AfterModel` | After API response |
| `BeforeTool` | Before tool execution |
| `AfterTool` | After tool completion |
| `BeforeAgent` | Before agent start |
| `AfterAgent` | After agent completion |
| `PreCompress` | Before compression |
| `BeforeToolSelection` | Before tool selection |

---

## Appendix A: Architecture Decision Records

### A.1 Two-Class Tool Pattern

**Decision**: Separate tool validation (DeclarativeTool) from execution (ToolInvocation).

**Context**: Tools need to validate parameters before execution and handle confirmations.

**Rationale**:
- Clear separation of concerns
- Invocations can be confirmed before execution
- Policy engine integration is cleaner
- Easier testing

### A.2 MessageBus for Confirmations

**Decision**: Use pub/sub MessageBus for tool confirmations instead of direct UI calls.

**Context**: Tools in Core package can't depend on CLI package.

**Rationale**:
- Decouples Core from CLI
- Enables different UIs (CLI, IDE, API)
- Testable without UI

### A.3 React/Ink for Terminal UI

**Decision**: Use React with Ink for terminal rendering.

**Context**: Need rich, interactive terminal UI.

**Rationale**:
- Component-based architecture
- Hooks for reusable logic
- Context for shared state
- Active ecosystem

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Agent** | Autonomous sub-system that executes multi-turn tasks |
| **ApprovalMode** | Permission level for tool execution |
| **Command** | Slash command typed by users |
| **Config** | Central configuration hub |
| **ContentGenerator** | Creates API requests from prompts |
| **DeclarativeTool** | Base class for tool definitions |
| **Extension** | Third-party add-on package |
| **GeminiClient** | Main API orchestrator |
| **Hook** | Customization point at events |
| **Invocation** | Validated, executable tool call |
| **Kind** | Tool category (Read, Edit, etc.) |
| **MCP** | Model Context Protocol |
| **MessageBus** | Pub/sub communication system |
| **PolicyEngine** | Safety decision maker |
| **Skill** | Reusable prompt template |
| **Tool** | Function callable by LLM |
| **ToolRegistry** | Tool management system |
| **Turn** | Single API request/response cycle |

---

*This guide is maintained alongside the codebase. For process documentation, see CONTRIBUTING.md.*
