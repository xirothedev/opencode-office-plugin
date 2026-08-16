# Docs and plugin target the opencode V1 plugin API

The plugin is written against the opencode V1 plugin API (`import type { Plugin } from "@opencode-ai/plugin"`, function-style default export, `"plugin"` config array, `opencode` CLI). All installation docs therefore teach V1 syntax. This is deliberate — the code only loads in V1.

opencode 2 changed the plugin API (`Plugin.define`, `"plugins"` field, `opencode2` CLI) and **V1 plugins do not load in V2**. Migrating the plugin to the V2 API is a code task tracked separately; until then, docs must not be "modernized" to `plugins` syntax, or they will describe an install that does not work.

**Consequences**: `@xirothedev/openoffice-plugin-opencode` on npmjs will not load in opencode 2 until migration lands; V2 users must wait for a V2-API release.
