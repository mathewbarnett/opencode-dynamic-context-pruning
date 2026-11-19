/**
 * Minimal JSON Schema builders for DCP's tool definitions.
 *
 * The plugin used to rely on the V1 `tool.schema` zod-like helpers. Under
 * OpenCode 2 tool inputs are plain JSON Schema (or Effect schemas), so the
 * definitions are built directly as JSON Schema and shared by both the
 * compression tools and the tool registered with the host.
 */
export interface JsonSchema {
    [key: string]: unknown
    type: "string" | "number" | "boolean" | "array" | "object"
    description?: string
    items?: JsonSchema
    properties?: Record<string, JsonSchema>
    required?: string[]
    additionalProperties?: boolean
}

export interface ToolDefinition {
    description: string
    args: JsonSchema
    execute: (args: any, ctx: any) => Promise<string>
}

export const schema = {
    string: (description: string): JsonSchema => ({ type: "string", description }),
    number: (description: string): JsonSchema => ({ type: "number", description }),
    boolean: (description: string): JsonSchema => ({ type: "boolean", description }),
    array: (items: JsonSchema, description?: string): JsonSchema => ({
        type: "array",
        items,
        ...(description ? { description } : {}),
    }),
    object: (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
        type: "object",
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
        ...(description ? { description } : {}),
    }),
}

export function defineTool(definition: ToolDefinition): ToolDefinition {
    return definition
}
