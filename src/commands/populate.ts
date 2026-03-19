import type { Database } from "bun:sqlite";
import type { LatticeConfig } from "../types/config.ts";

/**
 * Generates a structured prompt that instructs a coding agent to tag the codebase.
 * Provides the tag spec with few-shot examples, a brief project summary,
 * and existing tags if any. The agent reads the code and decides what to tag.
 *
 * @param db - An open Database handle with a built graph
 * @param _config - Lattice configuration (reserved for future use)
 * @returns A complete instruction string for the coding agent
 */
// @lattice:flow populate
function executePopulate(db: Database, _config: LatticeConfig): string {
	const sections: string[] = [];

	sections.push(taskSection());
	sections.push(tagSpecSection());
	sections.push(examplesSection());
	sections.push(projectSummarySection(db));
	sections.push(validationSection());

	return sections.join("\n\n");
}

/** Describes the task the agent needs to perform. */
function taskSection(): string {
	return `## Task

Add Lattice tags to this codebase. Lattice builds a knowledge graph from these tags so coding agents can navigate the code through graph queries instead of grep and file reading.

Your job: read the source code, identify entry points, external boundaries, and event connections, then add the appropriate tags as comments above the relevant functions.`;
}

/** Outputs the tag spec — what each tag means and the syntax rules. */
function tagSpecSection(): string {
	return `## Tags

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

	// Summary stats
	const fileCount = (db.query("SELECT COUNT(DISTINCT file) as c FROM nodes").get() as { c: number })
		.c;
	const nodeCount = (db.query("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
	const edgeCount = (db.query("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

	lines.push(`${fileCount} files, ${nodeCount} symbols, ${edgeCount} call edges in the graph.`);

	// Existing tags
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

/** Validation instructions for after tagging. */
function validationSection(): string {
	return `## Validation

After adding tags, rebuild and check:

\`\`\`bash
lattice build && lattice lint
\`\`\`

Then verify with:
- \`lattice overview\` — check that flows, boundaries, and events look correct
- \`lattice flow <name>\` — check that each flow's call tree makes sense`;
}

export { executePopulate };
