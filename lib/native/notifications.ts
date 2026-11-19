import type { NotificationEvent } from "./rpc"

/**
 * All DCP notifications are toasts. The server emits a single RPC event and the
 * TUI turns it into `ctx.ui.toast.show(...)`; nothing is ever injected into the
 * model's message stream to display a notification.
 */

const DEDUPE_MS = 1_000
const BURST_WINDOW_MS = 5_000
const BURST_LIMIT = 4

const VARIANTS = new Set(["info", "success", "warning", "error"])

type Emit = (event: NotificationEvent) => Promise<void>

interface ToastInput {
    sessionID?: string
    body?: {
        title?: string
        message?: string
        variant?: string
        duration?: number
    }
    title?: string
    message?: string
    variant?: string
    duration?: number
}

interface PromptInput {
    path?: { id?: string }
    body?: { parts?: Array<{ text?: string }> }
    sessionID?: string
    text?: string
}

export interface ToastSinkOptions {
    title?: string
    duration?: number
}

/**
 * Adapter for the legacy `client` facade used by the shared engine's notification
 * helpers. It converts toast/prompt calls into RPC notification events, with
 * duplicate suppression and a per-session burst cap.
 */
export function createNotifier(emit: Emit) {
    const last = new Map<string, { message: string; at: number }>()
    const bursts = new Map<string, number[]>()

    async function emitNotification(event: NotificationEvent): Promise<void> {
        if (!event.message) return
        const key = event.sessionID ?? "global"
        const now = Date.now()
        const previous = last.get(key)
        if (previous?.message === event.message && now - previous.at < DEDUPE_MS) return

        const times = (bursts.get(key) ?? []).filter((time) => now - time < BURST_WINDOW_MS)
        if (times.length >= BURST_LIMIT) return
        times.push(now)

        last.set(key, { message: event.message, at: now })
        bursts.set(key, times)
        await emit(event)
    }

    return {
        emitNotification,
        showToast: async (input: ToastInput): Promise<void> => {
            const body = input.body ?? input
            if (!body.message) return
            await emitNotification({
                title: body.title ?? "DCP",
                message: body.message,
                variant: VARIANTS.has(body.variant ?? "")
                    ? (body.variant as NotificationEvent["variant"])
                    : "info",
                duration: body.duration ?? 5_000,
                sessionID: input.sessionID,
            })
        },
        prompt: async (input: PromptInput): Promise<void> => {
            const text = (input.body?.parts ?? [])
                .map((part) => part.text ?? "")
                .filter(Boolean)
                .join("\n")
            if (!text) return
            await emitNotification({
                title: "DCP",
                message: text,
                variant: "info",
                duration: 5_000,
                sessionID: input.path?.id ?? input.sessionID,
            })
        },
    }
}

export interface ToastLike {
    show(options: {
        title?: string
        message: string
        variant?: "info" | "success" | "warning" | "error"
        duration?: number
        sessionID?: string
    }): void
}

/** TUI-side subscriber: turns notification events into toasts, deduplicated. */
export function createToastSubscriber(toast: ToastLike) {
    const seen = new Map<string, number>()
    return (event: { data: NotificationEvent }): void => {
        const data = event.data
        if (!data?.message) return
        const key = `${data.sessionID ?? "global"}|${data.message}`
        const now = Date.now()
        if (now - (seen.get(key) ?? 0) < DEDUPE_MS) return
        seen.set(key, now)
        toast.show({
            title: data.title ?? "DCP",
            message: data.message,
            variant: data.variant ?? "info",
            duration: data.duration ?? 5_000,
            sessionID: data.sessionID,
        })
    }
}
