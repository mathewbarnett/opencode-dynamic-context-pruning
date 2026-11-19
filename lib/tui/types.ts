// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Plugin } from "@opencode/plugin/tui"
import type { RGBA } from "@opentui/core"
import type { buildStatsReport } from "../commands/stats"

export type TuiApi = Plugin.Context

export type Theme = {
    primary: RGBA
    accent: RGBA
    text: RGBA
    textMuted: RGBA
    background: RGBA
    backgroundElement: RGBA
    borderSubtle: RGBA
    selectedListItemText: RGBA
    success: RGBA
    warning: RGBA
    error: RGBA
}
export type ThemeColor = keyof Theme
export type ViewApi = {
    centeredDialog?: boolean
    theme: { readonly current: Theme }
    renderer: Pick<TuiApi["renderer"], "height" | "on" | "off">
    ui: { dialog: { clear(): void } }
}
export type StatsReport = Awaited<ReturnType<typeof buildStatsReport>>
