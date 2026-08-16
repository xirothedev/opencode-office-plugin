# Testing the Plugin Locally

## Option 1: Link locally (recommended for development)

1. **Build plugin**
   ```bash
   bun run build
   ```

2. **Create global link**
   ```bash
   bun link --global
   ```

3. **Configure opencode 2** (V2 API — `plugins` field)
   
   Create the global config `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugins": ["./plugins/local.ts"]
   }
   ```
   or reference the linked package directly:
   ```json
   {
     "plugins": ["@xirothedev/openoffice-plugin-opencode"]
   }
   ```

4. **Link in the config directory** so opencode 2 can resolve the package
   ```bash
   cd ~/.config/opencode
   bun link @xirothedev/openoffice-plugin-opencode --global
   ```

5. **Start opencode 2**
   ```bash
   opencode2
   ```

6. **Test commands**
   
   In opencode chat:
   ```
   Create a document at /tmp/test.docx with content "# Hello World"
   ```
   
   Agent should call `officecli(action="create", ...)`.

## Option 2: Test with example project

1. **Create test directory**
   ```bash
   mkdir ~/test-opencode-office
   cd ~/test-opencode-office
   ```

2. **Create opencode config**
   ```bash
   opencode2 init
   ```

3. **Add plugin to config**
   
   Edit `opencode.json`:
   ```json
   {
     "plugins": ["@xirothedev/openoffice-plugin-opencode"]
   }
   ```

4. **Link plugin**
   ```bash
   cd ~/.opencode
   bun link @xirothedev/openoffice-plugin-opencode --global
   ```

5. **Start opencode 2**
   ```bash
   opencode2
   ```

6. **Try these prompts**
   - "Create a markdown document at /tmp/doc.md"
   - "Read the PDF at /path/to/sample.pdf"
   - "Create a Word doc at /tmp/report.docx with a table"
   - "Show me the history of /tmp/report.docx"

7. **Verify the plugin loaded**
   ```bash
   opencode2 api get /api/plugin   # "openoffice" should be listed
   ```

## Option 3: Direct programmatic test

Run the example:
```bash
bun examples/basic-usage.js
```

This tests all actions without opencode.

## Debugging

**Plugin not loading?**
- Run `opencode2 api get /api/plugin` — `openoffice` must be listed
- Check `~/.local/share/opencode/log/opencode.log` for plugin load errors
- Verify `bun run build` succeeded and `dist/` exists
- Confirm the config field is `plugins` (V2), not `plugin` (V1)

**Tools not visible to the model?**
- Tools are registered with `codemode: false` for direct provider exposure
- Restart opencode 2 after changing config; the plugin package version must match the opencode 2 release (ADR-0010 pins `@opencode-ai/plugin@0.0.0-next-17444`)

**pandoc errors?**
- Install pandoc: `brew install pandoc` (macOS) or `sudo apt-get install pandoc` (Linux)
- Verify: `pandoc --version`

**Permission errors?**
- Check data directory: `ls ~/.local/share/opencode/plugins/openoffice/` (or your configured `dataDir`)
- Plugin needs write access

## Manual tool invocation

Test the tool directly in Bun. The V2 tool's `execute` returns an `Effect`; run it with `Effect.runPromise` and decode input through the tool schema (as the host would):

```javascript
import { Effect, Schema } from "effect"
import { officecliTool } from "./dist/plugin/tools/officecli"

const input = Schema.decodeUnknownSync(officecliTool.input)({ action: "read", filePath: "/tmp/test.docx" })
const result = await Effect.runPromise(
  officecliTool.execute(input, { sessionID: "test", agent: "test", messageID: "m", id: "c", progress: () => Effect.void })
)

console.log(result.output)
```

## Test files

Run test suite:
```bash
bun run test
```

Watch mode:
```bash
bun run test:watch
```

Specific test:
```bash
bun run test officecli-read-pdf
```

Tool tests use the shared harness `test/plugin/tools/harness.ts`: `runTool` decodes args through the input schema and runs the Effect; `setupHermeticDirs()` points the plugin data dir at a temp directory so tests never touch real user data.
