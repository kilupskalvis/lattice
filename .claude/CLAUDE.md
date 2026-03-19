# Lattice — Project Instructions

## Codebase Navigation

This project uses **Lattice** for codebase navigation. Before using Grep, Glob, or reading files to understand code, use Lattice commands via Bash.

### Required workflow for any task

1. **Orient** — Understand the project landscape before touching code:
   ```bash
   lattice overview
   ```

2. **Locate** — Find the relevant flow for your task:
   ```bash
   lattice flows                        # list all flows
   lattice flow <name>                  # see full call tree
   ```

3. **Understand** — Get a function's neighborhood before modifying it:
   ```bash
   lattice context <symbol>             # callers, callees, flows, boundary
   lattice callers <symbol>             # what depends on this
   lattice callees <symbol>             # what this depends on
   ```

4. **Scope** — Check impact before making changes:
   ```bash
   lattice impact <symbol>              # what breaks if you change this
   lattice trace <flow> --to <boundary> # path from entry to boundary
   ```

5. **Read** — Only read the specific function you're editing:
   ```bash
   lattice code <symbol>                # extract just this function's source
   ```

6. **Edit** — Now use the Read/Edit tools on the specific file and line range that `lattice context` or `lattice code` told you about.

### When to use Lattice vs traditional tools

| Task | Use | NOT |
|------|-----|----|
| Understand what a function does | `lattice context <symbol>` | Grep for function name |
| Find what calls a function | `lattice callers <symbol>` | Grep for function name |
| Find what a function calls | `lattice callees <symbol>` | Read the whole file |
| See a business flow end-to-end | `lattice flow <name>` | Read multiple files |
| Check change impact | `lattice impact <symbol>` | Grep for usages |
| Find external boundaries | `lattice boundaries` | Grep for import statements |
| Find event connections | `lattice events` | Grep for publish/subscribe |
| Read code to edit it | `lattice code <symbol>`, then Read tool | Read the whole file |
| Search for a string literal | Grep (this is fine) | — |
| Find a config value | Grep (this is fine) | — |

### Keeping the graph current

After making code changes that add/remove/rename functions:
```bash
lattice update                          # incremental re-index
```

After adding or changing `@lattice:` tags:
```bash
lattice build && lattice lint           # rebuild and validate
```

## Tags

This codebase uses `@lattice:` tags. When adding new entry points or boundaries, tag them:

- `// @lattice:flow <name>` — on new CLI command handlers or entry points
- `// @lattice:boundary <system>` — on functions that call external systems
- `// @lattice:emits <event>` — on functions that publish events
- `// @lattice:handles <event>` — on functions that consume events

Do NOT tag intermediate functions — they are derived from the call graph.

Run `lattice lint` after adding tags to validate them.

## Code Standards

- TypeScript strict mode, zero `any` types
- `Result<T, E>` for errors, no exceptions except at CLI boundary
- TSDoc on all exported functions
- No classes, no enums, no default exports, no `null` (except at SQLite boundary)
- Biome for formatting, tsc for type checking
- Pre-commit: biome + tsc. Pre-push: full test suite.

## Testing

```bash
bun test                                # run all 186 tests
bun run check                           # lint + typecheck + tests
```
