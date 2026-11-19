/**
 * Minimal mock of the OpenCode 2.3.x Plugin.Context for characterizing the
 * plugin wiring without a running host.
 */
export interface MockOptions {
    directory: string
    entries?: any[]
    session?: any
    agent?: any
    models?: any[]
    config?: Record<string, unknown>
}

export function createMockContext(options: MockOptions) {
    const session = options.session ?? {
        id: "ses_1",
        agent: "build",
        model: { providerID: "anthropic", id: "claude-sonnet-4", variant: undefined },
        parentID: null,
        permissions: [],
    }
    const entries = options.entries ?? [
        {
            id: "msg_1",
            type: "user",
            time: { created: 1000 },
            text: "Please inspect the repo",
        },
        {
            id: "msg_2",
            type: "assistant",
            time: { created: 2000 },
            agent: "build",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [],
        },
    ]
    const agent = options.agent ?? { id: "build", permissions: [] }
    const models = options.models ?? [
        { providerID: "anthropic", id: "claude-sonnet-4", limit: { context: 200000 } },
    ]

    const hooks: Record<string, (event: any) => Promise<void>> = {}
    const tools: any[] = []
    const commands: any[] = []
    const prompts: any[] = []
    const permissionHooks: Record<string, (event: any) => Promise<void> | void> = {}
    const permissionAsserts: any[] = []
    const registrations: Array<{ dispose(): Promise<void> | void }> = []
    let rpcDefinition: any
    let rpcHandlers: any
    const rpcEvents: Array<{ name: string; data: any }> = []

    const ctx: any = {
        location: { directory: options.directory },
        model: {
            transform: async (callback: (editor: any) => void) => {
                callback({ list: () => models })
                const registration = { dispose: async () => {} }
                registrations.push(registration)
                return registration
            },
        },
        session: {
            get: async () => session,
            context: async () => entries,
            prompt: async (input: any) => {
                prompts.push(input)
                return {}
            },
            hook: async (kind: string, callback: (event: any) => Promise<void>) => {
                hooks[kind] = callback
                registrations.push({
                    dispose: async () => {
                        delete hooks[kind]
                    },
                })
                return {
                    dispose: async () => {
                        delete hooks[kind]
                    },
                }
            },
        },
        agent: {
            get: async () => ({ data: agent }),
        },
        permission: {
            hook: async (name: string, callback: (event: any) => void) => {
                permissionHooks[name] = callback
                registrations.push({
                    dispose: async () => {
                        delete permissionHooks[name]
                    },
                })
                return {
                    dispose: async () => {
                        delete permissionHooks[name]
                    },
                }
            },
            assert: async (input: any) => {
                permissionAsserts.push(input)
            },
        },
        tool: {
            transform: async (callback: (editor: any) => void) => {
                callback({ add: (tool: any) => tools.push(tool) })
                registrations.push({
                    dispose: async () => {
                        tools.length = 0
                    },
                })
                return {
                    dispose: async () => {
                        tools.length = 0
                    },
                }
            },
        },
        command: {
            transform: async (callback: (editor: any) => void) => {
                callback({ add: (command: any) => commands.push(command) })
                registrations.push({
                    dispose: async () => {
                        commands.length = 0
                    },
                })
                return {
                    dispose: async () => {
                        commands.length = 0
                    },
                }
            },
        },
        rpc: {
            register: async (definition: any, handlers: any) => {
                rpcDefinition = definition
                rpcHandlers = handlers
                const registration = {
                    events: {
                        emit: async (name: string, data: any) => {
                            rpcEvents.push({ name, data })
                        },
                    },
                    dispose: async () => {},
                }
                registrations.push({
                    dispose: async () => {
                        rpcDefinition = undefined
                        rpcHandlers = undefined
                    },
                })
                return registration
            },
        },
        ui: {
            toast: { show: () => {} },
            dialog: { show: () => {}, set: () => {}, clear: () => {} },
            router: { current: () => ({ type: "session", sessionID: session.id }) },
            slot: () => ({ dispose: () => {} }),
        },
        attention: { notify: async () => ({ ok: true, notification: false, sound: false }) },
        keymap: { layer: (cb: () => any) => cb() },
        renderer: { height: 40, on: () => {}, off: () => {} },
        theme: {},
        client: {},
    }

    return {
        ctx,
        session,
        entries,
        agent,
        hooks,
        tools,
        commands,
        prompts,
        permissionHooks,
        permissionAsserts,
        registrations,
        getRpcDefinition: () => rpcDefinition,
        getRpcHandlers: () => rpcHandlers,
        rpcEvents,
        invoke: async (kind: "context" | "compaction", event: any) => hooks[kind]?.(event),
    }
}

export function sessionEvent(overrides: Partial<any> = {}) {
    const message = (id: string, role: string, text: string) => ({
        id,
        role,
        content: [{ type: "text", text }],
    })
    return {
        sessionID: "ses_1",
        agent: "build",
        model: { providerID: "anthropic", id: "claude-sonnet-4" },
        system: [{ type: "text", text: "You are a helpful assistant." }],
        messages: [
            message("msg_1", "user", "Please inspect the repo"),
            message("msg_2", "assistant", "I will take a look"),
        ],
        options: {},
        tools: {},
        ...overrides,
    }
}
