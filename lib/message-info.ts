/**
 * Structural message/part types used by the shared pruning engine.
 *
 * The engine works against a small, stable subset of OpenCode's session message
 * shapes. Keeping that subset local avoids depending on any V1 SDK types and
 * lets the OC2 layer provide messages that satisfy it directly.
 */
export interface TokenInfo {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
}

export interface MessageInfo {
    id: string
    sessionID: string
    role: "user" | "assistant" | "system" | "tool"
    time: { created: number }
    agent?: string
    model: { providerID: string; modelID: string; variant?: string }
    providerID?: string
    modelID?: string
    tokens: TokenInfo
    summary?: boolean
    [key: string]: unknown
}

export interface TextPartLike {
    type: "text"
    text: string
    [key: string]: unknown
}

export interface ToolStateLike {
    status: "pending" | "running" | "completed" | "error"
    input?: any
    output?: any
    error?: any
    metadata?: Record<string, unknown>
    time?: { start?: number; end?: number; completed?: number }
    title?: string
    [key: string]: unknown
}

export interface ToolPartLike {
    type: "tool"
    callID: string
    tool: string
    state: ToolStateLike
    [key: string]: unknown
}

// The engine inspects many part variants (text, tool, step-start, file, ...)
// and its helpers already narrow by `type`. Keep this permissive until the
// native OC2 message model lands in Phase 2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PartLike = any
