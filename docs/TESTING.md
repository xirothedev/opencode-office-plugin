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

3. **Configure opencode**
   
   Create `~/.config/opencode/config.json`:
   ```json
   {
     "plugin": ["@openoffice/plugin"]
   }
   ```

4. **Link in opencode's directory**
   ```bash
   cd ~/.opencode
   bun link @openoffice/plugin --global
   ```

5. **Start opencode**
   ```bash
   opencode
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

2. **Initialize opencode**
   ```bash
   opencode init
   ```

3. **Add plugin to config**
   
   Edit `opencode.json`:
   ```json
   {
     "plugin": ["@openoffice/plugin"]
   }
   ```

4. **Link plugin**
   ```bash
   bun link @openoffice/plugin --global
   ```

5. **Start opencode**
   ```bash
   opencode
   ```

6. **Try these prompts**
   - "Create a markdown document at /tmp/doc.md"
   - "Read the PDF at /path/to/sample.pdf"
   - "Create a Word doc at /tmp/report.docx with a table"
   - "Show me the history of /tmp/report.docx"

## Option 3: Direct programmatic test

Run the example:
```bash
bun examples/basic-usage.js
```

This test all actions without opencode.

## Debugging

**Plugin not loading?**
- Check `opencode` output for plugin errors
- Verify `bun run build` succeeded
- Check `dist/` directory exist

**pandoc errors?**
- Install pandoc: `brew install pandoc` (macOS) or `sudo apt-get install pandoc` (Linux)
- Verify: `pandoc --version`

**Permission errors?**
- Check data directory: `ls ~/.local/share/opencode/plugins/openoffice/`
- Plugin need write access

## Manual tool invocation

Test tool directly in Bun:

```javascript
import { officecliTool } from "./dist/plugin/tools/officecli"

const result = await officecliTool.execute(
  { action: "read", filePath: "/tmp/test.docx" },
  { sessionID: "test", /* ... other context */ }
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
