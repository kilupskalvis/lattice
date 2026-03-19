<table align="center"><tr><td>
<pre>

██╗      █████╗ ████████╗████████╗██╗ ██████╗███████╗
██║     ██╔══██╗╚══██╔══╝╚══██╔══╝██║██╔════╝██╔════╝
██║     ███████║   ██║      ██║   ██║██║     █████╗
██║     ██╔══██║   ██║      ██║   ██║██║     ██╔══╝
███████╗██║  ██║   ██║      ██║   ██║╚██████╗███████╗
╚══════╝╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚═╝ ╚═════╝╚══════╝

</pre>
</td></tr></table>

<p align="center">
  <strong>Knowledge graph CLI for coding agents</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lattice-graph"><img src="https://img.shields.io/npm/v/lattice-graph" alt="npm"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6" alt="Bun"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>

Lattice builds a knowledge graph of your codebase that coding agents query instead of grep and file reading. Agents get precise, scoped context — a flow's call tree, a function's callers, the impact of a change — in minimal tokens. No more reading entire files to understand three functions.

## The Problem

Coding agents today dump raw source code into their context windows. They grep for keywords, read whole files, and hope the relevant code is somewhere in the noise. This causes:

- **Context rot** — stale file contents from earlier exploration steps degrade attention
- **Token waste** — reading 500-line files to understand 20-line functions
- **Terminology mismatch** — searching "checkout timeout" fails when the code calls it `chargeCard`
- **Cold start** — every conversation starts from zero with no understanding of the codebase

## The Solution

Embed lightweight annotations (`@lattice:` tags) in your source code, then let Lattice build a graph that agents traverse instead of searching.

```python
# @lattice:flow checkout
@app.post("/api/checkout")
def handle_checkout(req):
    order = create_order(req)       # ← no tag needed, derived from call graph
    return order

# @lattice:boundary stripe
def charge(amount, token):
    return stripe.charges.create(amount=amount, source=token)

# @lattice:emits order.created
def emit_order_created(order_id):
    queue.publish("order.created", {"order_id": order_id})
```

Four tags, placed only at entry points and boundaries. Everything in between is derived from the AST.

## Installation

### bun (recommended)

```bash
bun add -g lattice-graph
```

### npx (no install)

```bash
bunx lattice-graph init
bunx lattice-graph build
```

### From source

```bash
git clone https://github.com/kilupskalvis/lattice.git
cd lattice
bun install
bun run build          # compiles to ./lattice binary
```

## Quick Start

```bash
# Initialize Lattice in your project
cd your-project
lattice init                        # creates .lattice/ and lattice.toml

# Build the knowledge graph
lattice build                       # parses all files, builds SQLite graph

# Query the graph
lattice overview                    # project landscape: flows, boundaries, events
lattice flow checkout               # full call tree from entry point to boundaries
lattice context charge              # callers, callees, flows, boundary info
lattice impact charge               # what breaks if you change this function
```

## Tags

Lattice uses four tags placed in comments directly above function definitions. Tags capture what the AST cannot — business flow entry points, external system boundaries, and invisible runtime connections.

| Tag | Purpose | Example |
|-----|---------|---------|
| `@lattice:flow <name>` | Marks a flow entry point | `# @lattice:flow checkout` |
| `@lattice:boundary <system>` | Marks where code exits the codebase | `# @lattice:boundary stripe` |
| `@lattice:emits <event>` | Marks event/message emission | `# @lattice:emits order.created` |
| `@lattice:handles <event>` | Marks event/message consumption | `# @lattice:handles order.created` |

**What you tag:** Route handlers, CLI commands, cron jobs, external API calls, database operations, event publishers, event consumers.

**What you don't tag:** Everything else. Intermediate functions, callers, callees, types — all derived automatically from the call graph.

### Syntax rules

- Tags go in the comment block directly above a function definition
- No blank lines between the tag comment and the function
- Names are kebab-case: `user-registration`, `order.created`, `aws-s3`
- Multiple values: `# @lattice:flow checkout, payment`
- Works with any comment style: `#`, `//`, `/* */`, `--`

### How flow propagation works

Only flow entry points are tagged. Lattice traces the call graph from the entry point and automatically includes every function in the chain:

```
FLOW: checkout
  handle_checkout → create_order → charge [BOUNDARY: stripe]
                                 → save_order [BOUNDARY: postgres]
                                 → emits order.created
                                        ↓ (event edge)
                                   send_confirmation
```

`create_order`, `charge`, `save_order` — none of these need tags. Their flow membership is derived.

## Commands

### Build Commands

| Command | Description |
|---------|-------------|
| `lattice init` | Initialize `.lattice/` in a project, detect languages |
| `lattice build` | Full index: parse all files, build knowledge graph |
| `lattice update` | Incremental: re-index only files changed since last build |
| `lattice lint` | Validate tags: syntax, typos, orphans, missing tags |
| `lattice populate` | Output agent instructions for tagging the codebase |

### Query Commands

| Command | Description |
|---------|-------------|
| `lattice overview` | Project landscape: flows, boundaries, event connections |
| `lattice flows` | List all flows with their entry points |
| `lattice flow <name>` | Full call tree from a flow's entry point to its boundaries |
| `lattice context <symbol>` | Symbol neighborhood: callers, callees, flows, boundary |
| `lattice callers <symbol>` | What calls this symbol |
| `lattice callees <symbol>` | What this symbol calls |
| `lattice trace <flow> --to <boundary>` | Call chain from flow entry to a specific boundary |
| `lattice impact <symbol>` | Everything affected if this symbol changes |
| `lattice boundaries` | All external system boundaries |
| `lattice events` | All event connections (emits → handles) |
| `lattice code <symbol>` | Source code of a specific function |

All query commands support `--json` for programmatic consumption.

## Example Output

### `lattice overview`

```
Flows:
  checkout             → POST /api/checkout (src/routes/checkout.py:4)

Boundaries:
  stripe               → 1 function across 1 file
  postgres             → 1 function across 1 file

Events:
  order.created        → emitted by emit_order_created, handled by send_confirmation
```

### `lattice flow checkout`

```
handle_checkout (src/routes/checkout.py:4)
  → create_order (src/services/order.py:4)
    → save_order (src/db/orders.py:4) [postgres]
    → charge (src/gateways/payment.py:4) [stripe]
      → build_stripe_payload (src/gateways/payment.py:8)
    → emit_order_created (src/services/order.py:10) emits order.created
      → send_confirmation (src/workers/email.py:2)
```

### `lattice context charge`

```
charge (src/gateways/payment.py:4)
  signature: charge(amount: float, token: str) -> dict
  flows: checkout (derived)

  callers:
    ← create_order (src/services/order.py:4)

  callees:
    → build_stripe_payload (src/gateways/payment.py:8)

  boundary: stripe
```

### `lattice impact charge`

```
Direct callers:
  ← create_order (src/services/order.py:4)

Transitive callers:
  ← handle_checkout (src/routes/checkout.py:4)

Affected flows: checkout
```

## Agent Workflow

Instead of grepping and reading files, an agent using Lattice follows this flow:

1. **Orient** — `lattice overview` to understand the project landscape
2. **Locate** — `lattice flow <name>` to see the relevant call tree
3. **Understand** — `lattice context <symbol>` for a specific function's neighborhood
4. **Scope** — `lattice impact <symbol>` to know what's affected by a change
5. **Edit** — `lattice code <symbol>` to read only the function being modified

Total context consumed: ~200-500 tokens instead of 5,000-50,000 from reading files.

## Tagging Your Codebase

### Automated

```bash
lattice build                       # build graph without tags first
lattice populate                    # outputs instructions for a coding agent
```

`lattice populate` generates a structured prompt that tells a coding agent exactly what to tag, where, and with what values. The agent reads the instructions, adds the tags, then validates:

```bash
lattice build && lattice lint       # rebuild graph and validate tags
```

### Linting

```bash
lattice lint                        # check for missing, invalid, stale tags
lattice lint --strict               # treat warnings as errors (for CI)
lattice lint --unresolved           # show unresolved reference details
```

The linter detects:
- **Missing tags** — route handlers without `@lattice:flow`, external calls without `@lattice:boundary`
- **Invalid tags** — tags on classes instead of functions, missing values
- **Typos** — `@lattice:flow chekout` when `checkout` exists elsewhere
- **Orphaned events** — emits without handlers, handlers without emitters
- **Stale tags** — boundary tags on functions that no longer call the package

## How It Works

1. **Tree-sitter** parses source files into ASTs (Python and TypeScript supported)
2. **Extractors** walk the AST to extract symbols (functions, classes, methods), call edges, imports, and framework patterns
3. **Tag parser** reads `@lattice:` comments and associates them with the function below
4. **Graph builder** inserts everything into a SQLite database with nodes, edges, and tags
5. **Event synthesis** creates invisible edges from `@lattice:emits` to `@lattice:handles` nodes
6. **Cross-file resolution** matches callee names to known symbols across the codebase
7. **CLI queries** traverse the graph and return compact, scoped results

The graph is stored at `.lattice/graph.db` — a single SQLite file.

## Configuration

`lattice.toml` in your project root:

```toml
[project]
languages = ["python", "typescript"]
root = "src"
exclude = ["node_modules", "venv", ".git", "dist", "__pycache__"]

[python]
source_roots = ["src"]
test_paths = ["tests"]
frameworks = ["fastapi"]

[typescript]
source_roots = ["src"]
test_paths = ["__tests__"]
frameworks = ["express"]

[lint]
strict = false
ignore = ["scripts/**"]

[lint.boundaries]
packages = ["stripe", "boto3", "psycopg2", "requests", "sendgrid"]
```

## Supported Languages

| Language | Status | Frameworks |
|----------|--------|------------|
| Python | Supported | FastAPI, Flask, Django, Celery |
| TypeScript | Supported | Express, NestJS, Next.js |

Adding a new language requires implementing one extractor. The graph schema, CLI commands, linter, and output formatting are all language-agnostic.

## Agent Integration (Claude Code)

To make coding agents use Lattice instead of grep/read for codebase navigation, add these files to your project.

### `.claude/CLAUDE.md`

```markdown
# Codebase Navigation

This project uses Lattice for codebase navigation. Before using Grep, Glob, or
reading files to understand code, use Lattice commands via Bash.

## Workflow for any task

1. Orient:    lattice overview
2. Locate:    lattice flow <name>
3. Understand: lattice context <symbol>
4. Scope:     lattice impact <symbol>
5. Read:      lattice code <symbol>
6. Edit:      Read/Edit tools on the specific file and line range

## When to use Lattice vs traditional tools

- Understand a function     -> lattice context <symbol>   (not Grep)
- Find callers              -> lattice callers <symbol>    (not Grep)
- See a business flow       -> lattice flow <name>         (not reading files)
- Check change impact       -> lattice impact <symbol>     (not Grep for usages)
- Read code to edit         -> lattice code <symbol>       (not Read on whole file)
- Search for string literal -> Grep (this is fine)
- Find config files         -> Glob (this is fine)

## After code changes

lattice update              # incremental re-index
lattice build && lattice lint   # after adding/changing tags
```

### `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep",
        "command": "echo \"STOP: Before using Grep, check if Lattice can answer your question faster:\n  lattice context <symbol>  - function neighborhood\n  lattice callers <symbol>  - what calls this\n  lattice flow <name>       - full call tree\n  lattice impact <symbol>   - change impact\nGrep is appropriate for: string literals, config values, error messages.\nGrep is NOT appropriate for: finding function definitions, understanding call chains, tracing flows.\""
      },
      {
        "matcher": "Glob",
        "command": "echo \"STOP: Before using Glob, check if Lattice can answer your question faster:\n  lattice overview          - all flows, boundaries, events\n  lattice flows             - all entry points\n  lattice boundaries        - all external systems\n  lattice context <symbol>  - where a symbol lives\nGlob is appropriate for: config files, assets, non-code files.\nGlob is NOT appropriate for: finding source files or function locations.\""
      }
    ]
  }
}
```

The hooks remind the agent to try Lattice before falling back to traditional tools. They don't block — they guide.

## Requirements

- [Bun](https://bun.sh) >= 1.0 (for development and compilation)
- No runtime dependencies for the compiled binary (except WASM grammars in `node_modules/`)

## Development

```bash
bun install                         # install dependencies + git hooks
bun run dev                         # run CLI in development mode
bun run test                        # run 187 tests
bun run lint                        # biome check
bun run typecheck                   # tsc --noEmit
bun run check                       # lint + typecheck + tests
bun run build                       # compile to single binary
```

Pre-commit hooks enforce Biome formatting and TypeScript type checking. Pre-push hooks run the full test suite.

## License

MIT
