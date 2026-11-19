import type { Message, ContentPart, ToolResultPart } from "@opencode/ai"
import type { Plugin } from "@opencode/plugin"
import type { WithParts } from "../state"

type History = Awaited<ReturnType<Plugin.Context["session"]["context"]>>
type Session = Awaited<ReturnType<Plugin.Context["session"]["get"]>>
type Entry = History[number]
type Part = WithParts["parts"][number]

/**
 * Build engine metadata from a real stored session entry. Returns undefined when
 * the entry is missing or lacks the fields the shared engine requires. We never
 * synthesize timestamps, token counts, model identity, or message IDs here:
 * fabricated values previously fed compaction detection and nudge thresholds
 * with data that did not exist in the session.
 */
function info(
    entry: Entry | undefined,
    session: Session,
    role: string,
): WithParts["info"] | undefined {
    if (!entry || typeof entry.time?.created !== "number") return undefined
    const model = entry.type === "assistant" ? entry.model : session.model
    return {
        id: entry.id,
        role,
        sessionID: session.id,
        time: { created: entry.time.created },
        agent: entry.type === "assistant" ? entry.agent : session.agent,
        model: model
            ? { providerID: model.providerID, modelID: model.id, variant: model.variant }
            : undefined,
        providerID: model?.providerID,
        modelID: model?.id,
        tokens: entry.type === "assistant" ? entry.tokens : undefined,
        summary: entry.type === "compaction" && entry.status === "completed",
    } as unknown as WithParts["info"]
}

/** Project stored entries into the engine's working shape for the compress tool. */
export function history(entries: History, session: Session): WithParts[] {
    return entries.flatMap((entry): WithParts[] => {
        const role =
            entry.type === "assistant" || entry.type === "compaction" ? "assistant" : "user"
        const meta = info(entry, session, role)
        if (!meta) return []
        const base = { sessionID: session.id, messageID: entry.id }
        if (entry.type === "assistant") {
            const parts = entry.content.map((part, index) => {
                if (part.type !== "tool")
                    return { ...base, id: `${entry.id}:${index}`, type: part.type, text: part.text }
                const state = part.state
                return {
                    ...base,
                    id: part.id,
                    type: "tool",
                    callID: part.id,
                    tool: part.name,
                    state: {
                        ...state,
                        input: structuredClone(state.input),
                        ...(state.status === "completed" ? { output: output(state.content) } : {}),
                    },
                }
            })
            return [
                {
                    info: meta,
                    parts: [{ ...base, id: `${entry.id}:step`, type: "step-start" }, ...parts],
                } as WithParts,
            ]
        }
        let text: string | undefined
        if (entry.type === "user")
            text = [
                ...(entry.skills ?? []).flatMap((skill) =>
                    skill.text === undefined ? [] : [skill.text],
                ),
                entry.text,
            ].join("\n\n")
        if (entry.type === "synthetic" || entry.type === "skill") text = entry.text
        if (entry.type === "location-switched")
            text = `The working directory has been changed to ${entry.location.directory}.`
        if (entry.type === "shell" && entry.metadata?.background !== true)
            text = `The following shell command was executed by the user:\n\nCommand:\n${entry.command}\n\nOutput:\n${entry.output?.output ?? ""}`
        if (text !== undefined)
            return [
                {
                    info: meta,
                    parts: [{ ...base, id: `${entry.id}:text`, type: "text", text }],
                } as WithParts,
            ]
        if (entry.type === "compaction" && entry.status === "completed")
            return [{ info: meta, parts: [] } as WithParts]
        return []
    })
}

function output(content: ReadonlyArray<{ type: string; text?: string }>): unknown {
    return content.length === 1 && content[0]?.type === "text"
        ? content[0].text
        : structuredClone(content)
}

/**
 * Build an editable view of the native provider messages. Every field on the
 * view comes from a real stored entry; messages without one are left untouched
 * (they are passed through verbatim by commit()).
 */
export function view(native: Message[], entries: History, session: Session) {
    const byID = new Map(entries.map((entry) => [entry.id, entry]))
    const results = new Map<string, ToolResultPart>()
    const owners = new Map<string, string>()
    const links = new Map<ContentPart, Part>()
    const originals = new Map<string, WithParts>()
    const messages: WithParts[] = []
    for (const message of native)
        for (const part of message.content) {
            if (part.type === "tool-result") results.set(part.id, part)
            if (part.type === "tool-call" && message.id) owners.set(part.id, message.id)
        }
    for (const message of native) {
        if (!message.id || !["user", "assistant"].includes(message.role)) continue
        const entry = byID.get(message.id)
        if (!entry || entry.type === "compaction") continue
        const meta = info(entry, session, message.role)
        if (!meta) continue
        const base = { sessionID: session.id, messageID: message.id }
        const parts: Part[] = []
        if (message.role === "assistant")
            parts.push({ ...base, id: `${message.id}:step`, type: "step-start" })
        for (const [index, part] of message.content.entries()) {
            let projected: Part | undefined
            if (part.type === "text")
                projected = { ...base, id: `${message.id}:${index}`, type: "text", text: part.text }
            if (part.type === "media") {
                const legacy = part as typeof part & {
                    mediaType?: string
                    data?: string | Uint8Array
                }
                const asset = part.media
                projected = {
                    ...base,
                    id: `${message.id}:${index}`,
                    type: "file",
                    mime: asset?.mediaType ?? legacy.mediaType ?? "application/octet-stream",
                    url:
                        asset?.inline()?.dataUrl ??
                        (asset?.source.type === "url" ? asset.source.url : "") ??
                        (typeof legacy.data === "string" ? legacy.data : ""),
                }
            }
            if (part.type === "tool-call") {
                const result = results.get(part.id)
                const durable =
                    entry.type === "assistant"
                        ? entry.content.find((item) => item.type === "tool" && item.id === part.id)
                        : undefined
                projected = {
                    ...base,
                    id: part.id,
                    type: "tool",
                    callID: part.id,
                    tool: part.name,
                    state: {
                        status: !result
                            ? "running"
                            : result.result.type === "error"
                              ? "error"
                              : "completed",
                        input: structuredClone(part.input),
                        ...(result?.result.type === "error"
                            ? { error: result.result.value }
                            : {
                                  output: structuredClone(
                                      result?.result.type === "text"
                                          ? result.result.value
                                          : result?.result,
                                  ),
                              }),
                        metadata:
                            durable?.type === "tool" && "metadata" in durable.state
                                ? durable.state.metadata
                                : {},
                    },
                } as Part
                if (result) links.set(result, projected)
            }
            if (projected) {
                parts.push(projected)
                links.set(part, projected)
            }
        }
        const projected = { info: meta, parts } as WithParts
        messages.push(projected)
        originals.set(message.id, projected)
    }

    /** Write engine edits back onto the native messages, preserving order. */
    function commit(): Message[] {
        const retained = new Set(messages.map((message) => message.info.id))
        const linked = new Set(links.values())
        const output: Message[] = []
        let next = 0
        const synthetic = () => {
            while (next < messages.length && !originals.has(messages[next]!.info.id)) {
                const message = messages[next++]!
                output.push({
                    id: message.info.id,
                    role: "user",
                    content: message.parts
                        .filter((part) => part.type === "text")
                        .map((part) => ({ type: "text", text: part.text })),
                } as Message)
            }
        }
        for (const message of native) {
            const projected = message.id ? originals.get(message.id) : undefined
            if (projected) {
                synthetic()
                if (!retained.has(message.id!)) continue
                next++
            }
            const content: ContentPart[] = []
            const added =
                projected?.parts.flatMap((part) =>
                    part.type === "text" && !linked.has(part)
                        ? [{ type: "text" as const, text: part.text }]
                        : [],
                ) ?? []
            for (const part of message.content) {
                if (part.type === "tool-call") content.push(...added.splice(0))
                if (
                    part.type === "tool-result" &&
                    originals.has(owners.get(part.id)!) &&
                    !retained.has(owners.get(part.id)!)
                )
                    continue
                const edit = links.get(part)
                if (part.type === "text" && edit?.type === "text")
                    content.push({ ...part, text: edit.text })
                else if (part.type === "tool-call" && edit?.type === "tool")
                    content.push({ ...part, input: edit.state.input })
                else if (
                    part.type === "tool-result" &&
                    edit?.type === "tool" &&
                    edit.state.status === "completed" &&
                    typeof edit.state.output === "string" &&
                    edit.state.output !== part.result.value
                ) {
                    content.push({ ...part, result: { type: "text", value: edit.state.output } })
                } else content.push(part)
            }
            content.push(...added)
            if (content.length || message.content.length === 0)
                output.push({ ...message, content } as Message)
        }
        synthetic()
        return output
    }

    return { messages, commit }
}
