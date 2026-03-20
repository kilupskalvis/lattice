/** Severity levels for lint issues. */
const LINT_SEVERITIES = ["error", "warning", "info"] as const;
type LintSeverity = (typeof LINT_SEVERITIES)[number];

/** A single lint issue found in the codebase. */
type LintIssue = {
	readonly severity: LintSeverity;
	readonly file: string;
	readonly line: number;
	readonly symbol: string;
	readonly message: string;
};

/** Aggregate result of running all lint checks. */
type LintResult = {
	readonly issues: readonly LintIssue[];
	readonly coverage: { readonly tagged: number; readonly total: number };
};

export type { LintIssue, LintResult, LintSeverity };
