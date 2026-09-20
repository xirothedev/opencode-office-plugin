// opencode loads a configured local plugin from a directory's `index.ts`, so this
// shim lets `"package": "/abs/path/to/this/repo"` work with no build step. It is
// excluded from `dist` (include is ./src only) and from npm (see the `files` field).
export { default } from "./src/index.ts"
