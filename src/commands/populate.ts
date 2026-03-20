import type { Database } from "bun:sqlite";
import type { LatticeConfig } from "../types/config.ts";

/**
 * Generates a structured workflow that instructs a coding agent to tag the codebase.
 * Includes tag spec, few-shot examples, project context, and a step-by-step process
 * with explicit validation checkpoints.
 *
 * @param db - An open Database handle with a built graph
 * @param _config - Lattice configuration (reserved for future use)
 * @returns A complete instruction string for the coding agent
 */
// @lattice:flow populate
function executePopulate(db: Database, _config: LatticeConfig): string {
	const sections: string[] = [];

	sections.push(tagSpecSection());
	sections.push(examplesSection());
	sections.push(projectSummarySection(db));
	sections.push(workflowSection());

	return sections.join("\n\n");
}

/** Outputs the tag spec — what each tag means and the syntax rules. */
function tagSpecSection(): string {
	return `## Lattice Tag Specification

Four tags, placed in comments directly above function definitions:

- \`@lattice:flow <name>\` — Flow entry point. Where execution begins for a business operation. Route handlers, CLI commands, cron jobs, queue consumers.
- \`@lattice:boundary <system>\` — External boundary. Where code leaves the codebase. API calls, database queries, cache operations, third-party SDKs.
- \`@lattice:emits <event>\` — Event emission. Publishes to a queue, event bus, or notification system.
- \`@lattice:handles <event>\` — Event consumption. Subscribes to or processes events. Must match a corresponding emits tag.

Rules:
- Place the tag comment directly above the function definition, no blank lines between
- Names are kebab-case: \`checkout\`, \`user-registration\`, \`order.created\`, \`aws-s3\`
- Multiple values: \`# @lattice:flow checkout, payment\`
- Do NOT tag intermediate functions — only entry points and boundaries. Everything in between is derived from the call graph automatically.`;
}

/** Few-shot examples showing correct tagging across different scenarios. */
function examplesSection(): string {
	return `## Examples

### Python — FastAPI route with boundary and events

\`\`\`python
# @lattice:flow checkout
@app.post("/api/checkout")
def handle_checkout(req):
    order = create_order(req)       # no tag — derived from call graph
    return order

def create_order(req):              # no tag — derived from call graph
    charge(req.amount, req.token)
    save_order(req)
    emit_order_created(req.order_id)

# @lattice:boundary stripe
def charge(amount, token):
    return stripe.charges.create(amount=amount, source=token)

# @lattice:boundary postgres
def save_order(req):
    db.execute("INSERT INTO orders ...")

# @lattice:emits order.created
def emit_order_created(order_id):
    queue.publish("order.created", {"order_id": order_id})

# @lattice:handles order.created
def send_confirmation(event):
    sendgrid.send(event.order_id)
\`\`\`

### TypeScript — Express route with database boundary

\`\`\`typescript
// @lattice:flow user-registration
router.post("/api/users", async (req, res) => {
  const user = await createUser(req.body);
  res.json(user);
});

// @lattice:boundary postgres
async function createUser(data: CreateUserInput): Promise<User> {
  return db.query("INSERT INTO users ...").run(data);
}
\`\`\`

### Python — Celery task as entry point

\`\`\`python
# @lattice:flow invoice-generation
@shared_task
def generate_invoice(order_id):
    order = fetch_order(order_id)
    pdf = render_invoice(order)
    send_invoice_email(order, pdf)

# @lattice:boundary s3
def render_invoice(order):
    pdf = create_pdf(order)
    s3.upload(f"invoices/{order.id}.pdf", pdf)
    return pdf
\`\`\``;
}

/** Brief project summary from the graph — just enough context, not a file listing. */
function projectSummarySection(db: Database): string {
	const lines: string[] = ["## This Project", ""];

	const fileCount = (db.query("SELECT COUNT(DISTINCT file) as c FROM nodes").get() as { c: number })
		.c;
	const nodeCount = (db.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
	const edgeCount = (db.query("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

	lines.push(`${fileCount} files, ${nodeCount} symbols, ${edgeCount} call edges in the graph.`);

	const existingTags = db
		.query("SELECT kind, value, node_id FROM tags ORDER BY kind, value")
		.all() as { kind: string; value: string; node_id: string }[];

	if (existingTags.length > 0) {
		lines.push("");
		lines.push("### Already Tagged");
		lines.push("");
		for (const tag of existingTags) {
			lines.push(`- \`@lattice:${tag.kind} ${tag.value}\` on \`${tag.node_id}\``);
		}
		lines.push("");
		lines.push("Review these existing tags and add any that are missing.");
	} else {
		lines.push("");
		lines.push("No tags exist yet. Read the source files and add tags where appropriate.");
	}

	return lines.join("\n");
}

/** The complete step-by-step workflow with validation checkpoints. */
function workflowSection(): string {
	return `## Workflow

Follow these steps in order. Do not skip validation steps.

### Step 1: Tag entry points

Read the source files and identify all entry points — route handlers, CLI commands, cron jobs, queue consumers, event listeners. Add \`@lattice:flow <name>\` above each one.

Use domain names for flows: "checkout", "user-registration", "invoice-generation" — not function names.

### Step 2: Tag boundaries

Identify all functions that call external systems — APIs, databases, caches, file storage, third-party SDKs. Add \`@lattice:boundary <system>\` above each one.

Use the external system name: "stripe", "postgres", "redis", "s3" — not the function or library name.

### Step 3: Tag async dispatch (queues, Lambda, Celery)

If the codebase submits work to a queue (SQS, RabbitMQ), invokes Lambda functions, or dispatches Celery tasks, these create invisible connections between the submitter and the handler. Tag both sides:

- Add \`@lattice:emits job.<name>\` on the function that submits/invokes the async work
- Add \`@lattice:handles job.<name>\` on the function that processes the work on the other side

Important: Worker handlers and Lambda consumers are NOT separate flows — they are the receiving side of an async dispatch. Tag them with \`@lattice:handles\`, not \`@lattice:flow\`.

Place \`emits\` tags on the function the flow actually passes through, not on a concrete implementation behind a protocol or interface.

### Step 4: Tag events

If the codebase uses event-driven patterns (pub/sub, event bus, signals), identify publishers and consumers. Add \`@lattice:emits <event>\` and \`@lattice:handles <event>\` where applicable. Event names must match between emitters and handlers.

### Step 5: Rebuild and lint

\`\`\`bash
lattice build && lattice lint
\`\`\`

Fix any errors reported by lint:
- Missing tags on detected entry points or boundary calls
- Invalid tags (wrong placement, bad syntax)
- Typos in tag names
- Orphaned events (emits without handles, or vice versa)
- Stale tags (boundary tag on a function that no longer calls that system)

Repeat this step until lint reports zero errors.

### Step 5: Verify flows

Run \`lattice overview\` and check:
- Are all business flows listed?
- Are all external systems represented in boundaries?
- Are all event connections shown?

If anything is missing, go back to steps 1-3 and add the missing tags.

### Step 6: Verify call trees

For each flow listed in \`lattice overview\`, run:

\`\`\`bash
lattice flow <name>
\`\`\`

Check each call tree:
- Does it start at the correct entry point?
- Does it reach the expected boundaries?
- Are there functions in the tree that should be boundaries but aren't tagged?
- Does event propagation cross into the expected handlers?

If a call tree is missing expected functions, those functions may not be reachable from the entry point through the call graph. Check if there are missing call edges (dynamic dispatch, dependency injection) and consider whether additional tags are needed.

### Step 7: Verify impact

For each boundary, run:

\`\`\`bash
lattice impact <symbol>
\`\`\`

Check that the affected flows make sense. If a boundary is used by flows you didn't expect, investigate whether the flow tagging is correct.

### Done

The codebase is tagged when:
- \`lattice lint\` reports zero errors
- \`lattice overview\` shows all expected flows, boundaries, and events
- Each \`lattice flow <name>\` shows a complete, sensible call tree
- \`lattice impact\` on key functions shows the expected affected flows`;
}

export { executePopulate };
