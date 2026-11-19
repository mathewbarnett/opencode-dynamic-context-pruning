import type { PermissionAction } from "../host-permissions"
import { matchesGlob } from "../protected-patterns"

export interface NativePermissionRule {
    action?: unknown
    resource?: unknown
    effect?: unknown
}

export interface ResolvedPermission {
    effect: PermissionAction
    source: "config" | "host" | "default"
}

const isAction = (value: unknown): value is PermissionAction =>
    value === "allow" || value === "deny" || value === "ask"

const compressRule = (rule: NativePermissionRule): PermissionAction | undefined => {
    if (
        typeof rule.action !== "string" ||
        typeof rule.resource !== "string" ||
        !isAction(rule.effect)
    )
        return undefined
    return matchesGlob("compress", rule.action) && matchesGlob("*", rule.resource)
        ? rule.effect
        : undefined
}

/**
 * Resolve the compress permission from DCP config plus OC2 host rules.
 * Host rules are ordered agent-first, session-second; the last matching rule wins.
 */
export function resolveCompressPermission(
    configPermission: PermissionAction,
    agentRules: readonly NativePermissionRule[] = [],
    sessionRules: readonly NativePermissionRule[] = [],
): ResolvedPermission {
    if (configPermission === "deny") return { effect: "deny", source: "config" }

    let host: PermissionAction | undefined
    for (const rule of [...agentRules, ...sessionRules]) {
        const effect = compressRule(rule ?? {})
        if (effect) host = effect
    }
    if (host === "deny") return { effect: "deny", source: "host" }
    if (host === "ask" || configPermission === "ask")
        return { effect: "ask", source: host ? "host" : "config" }
    if (host === "allow") return { effect: "allow", source: "host" }
    return { effect: "allow", source: "default" }
}

export interface EvaluateEvent {
    action: string
    effect: PermissionAction
    message?: string
}

/** Apply DCP config to the host's native compress permission evaluation. */
export function applyCompressEvaluation(
    configPermission: PermissionAction,
    evaluation: EvaluateEvent,
): void {
    if (evaluation.action !== "compress") return
    if (configPermission === "deny") {
        evaluation.effect = "deny"
        evaluation.message = "DCP compression is disabled by configuration"
    } else if (configPermission === "ask" && evaluation.effect !== "deny") {
        evaluation.effect = "ask"
        evaluation.message = "DCP compression requires approval"
    }
}
