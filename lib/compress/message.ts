// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineTool, schema, type ToolDefinition } from "../tool-schema"
import type { ToolContext } from "./types"
import { countTokens } from "../token-utils"
import { messageFormat } from "../prompts/extensions/tool"
import { formatMessageRef, type IdFormat } from "../message-ids"
import { formatIssues, formatResult, resolveMessages, validateArgs } from "./message-utils"
import { finalizeSession, prepareSession, type NotificationEntry } from "./pipeline"
import { appendProtectedPromptInfo, appendProtectedTools } from "./protected-content"
import {
    allocateBlockId,
    allocateRunId,
    applyCompressionState,
    wrapCompressedSummary,
} from "./state"
import type { CompressMessageToolArgs } from "./types"

function buildSchema(format: IdFormat) {
    return schema.object(
        {
            topic: schema.string(
                "Short label (3-5 words) for the overall batch - e.g., 'Closed Research Notes'",
            ),
            content: schema.array(
                schema.object({
                    messageId: schema.string(
                        `Raw message ID to compress (e.g. ${formatMessageRef(1, format)})`,
                    ),
                    topic: schema.string("Short label (3-5 words) for this one message summary"),
                    summary: schema.string("Complete technical summary replacing that one message"),
                }),
                "Batch of individual message summaries to create in one tool call",
            ),
        },
        "Batch of individual message summaries to create in one tool call",
    )
}

export function createCompressMessageTool(ctx: ToolContext): ToolDefinition {
    ctx.prompts.reload()
    const runtimePrompts = ctx.prompts.getRuntimePrompts()

    return defineTool({
        description: runtimePrompts.compressMessage + messageFormat(ctx.state.idFormat),
        args: buildSchema(ctx.state.idFormat),
        async execute(args, toolCtx) {
            const input = args as CompressMessageToolArgs
            validateArgs(input)
            const callId =
                typeof (toolCtx as unknown as { callID?: unknown }).callID === "string"
                    ? (toolCtx as unknown as { callID: string }).callID
                    : undefined

            const { rawMessages, searchContext } = await prepareSession(
                ctx,
                toolCtx,
                `Compress Message: ${input.topic}`,
            )
            const { plans, skippedIssues, skippedCount } = resolveMessages(
                input,
                searchContext,
                ctx.state,
                ctx.config,
            )

            if (plans.length === 0 && skippedCount > 0) {
                throw new Error(formatIssues(skippedIssues, skippedCount))
            }

            const notifications: NotificationEntry[] = []

            const preparedPlans: Array<{
                plan: (typeof plans)[number]
                summaryWithTools: string
            }> = []

            for (const plan of plans) {
                const summaryWithPromptInfo = appendProtectedPromptInfo(
                    plan.entry.summary,
                    plan.selection,
                    searchContext,
                    ctx.state,
                    ctx.config.compress.protectTags,
                )

                const summaryWithTools = await appendProtectedTools(
                    ctx.client,
                    ctx.state,
                    ctx.config.experimental.allowSubAgents,
                    summaryWithPromptInfo,
                    plan.selection,
                    searchContext,
                    ctx.config.compress.protectedTools,
                    ctx.config.protectedFilePatterns,
                )

                preparedPlans.push({
                    plan,
                    summaryWithTools,
                })
            }

            const runId = allocateRunId(ctx.state)

            for (const { plan, summaryWithTools } of preparedPlans) {
                const blockId = allocateBlockId(ctx.state)
                const storedSummary = wrapCompressedSummary(
                    blockId,
                    summaryWithTools,
                    ctx.state.idFormat,
                )
                const summaryTokens = countTokens(storedSummary)

                applyCompressionState(
                    ctx.state,
                    {
                        topic: plan.entry.topic,
                        batchTopic: input.topic,
                        startId: plan.entry.messageId,
                        endId: plan.entry.messageId,
                        mode: "message",
                        runId,
                        compressMessageId: toolCtx.messageID,
                        compressCallId: callId,
                        summaryTokens,
                    },
                    plan.selection,
                    plan.anchorMessageId,
                    blockId,
                    storedSummary,
                    [],
                )

                notifications.push({
                    blockId,
                    runId,
                    summary: summaryWithTools,
                    summaryTokens,
                })
            }

            await finalizeSession(ctx, toolCtx, rawMessages, notifications, input.topic)

            return formatResult(plans.length, skippedIssues, skippedCount)
        },
    })
}
