import { z } from "zod"

export const notificationEvent = z.object({
    title: z.string().optional(),
    message: z.string(),
    variant: z.enum(["info", "success", "warning", "error"]).optional(),
    duration: z.number().optional(),
    sessionID: z.string().optional(),
})

export type NotificationEvent = z.infer<typeof notificationEvent>

const stats = z.object({
    sessionTokens: z.number(),
    sessionSummaryTokens: z.number(),
    sessionDurationMs: z.number(),
    sessionTools: z.number(),
    sessionMessages: z.number(),
    allTime: z.object({
        totalTokens: z.number(),
        totalTools: z.number(),
        totalMessages: z.number(),
        sessionCount: z.number(),
    }),
})

const context = z.object({
    system: z.number(),
    user: z.number(),
    assistant: z.number(),
    tools: z.number(),
    toolCount: z.number(),
    toolsInContextCount: z.number(),
    prunedTokens: z.number(),
    prunedToolCount: z.number(),
    prunedMessageCount: z.number(),
    total: z.number(),
})

export const rpc = {
    id: "dcp",
    methods: {
        status: {
            input: z.object({}),
            output: z.object({ enabled: z.boolean() }),
        },
        snapshot: {
            input: z.object({ sessionID: z.string() }),
            output: z.object({
                manualMode: z.boolean(),
                canCompress: z.boolean(),
                blockedReason: z.string().optional(),
                context,
                stats,
            }),
        },
        manual: {
            input: z.object({ sessionID: z.string(), enabled: z.boolean() }),
            output: z.object({}),
        },
    },
    events: {
        notification: { schema: notificationEvent },
        openPanel: { schema: z.object({}) },
    },
} as const
