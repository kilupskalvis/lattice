import type { TreeSitterNode, TreeSitterTree } from "../parser.ts";

/** A detected framework pattern on a function. */
type FrameworkDetection = {
	readonly functionName: string;
	readonly route: string | undefined;
	readonly isEntryPoint: boolean;
	readonly line: number;
};

/** HTTP methods recognized in route decorators. */
const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options"]);

/**
 * Detects framework patterns (FastAPI, Flask, Celery) on decorated functions.
 * Used by the linter to flag untagged entry points and by populate to suggest tags.
 *
 * @param tree - Parsed tree-sitter tree
 * @param _filePath - Relative file path (unused, kept for interface consistency)
 * @returns Detected framework patterns with route info and entry point flags
 */
function detectPythonFrameworks(
	tree: TreeSitterTree,
	_filePath: string,
): readonly FrameworkDetection[] {
	const results: FrameworkDetection[] = [];

	for (const child of tree.rootNode.children) {
		if (child.type === "decorated_definition") {
			processDecoratedDefinition(child, results);
		}
	}

	return results;
}

/** Processes a decorated_definition node to check for framework patterns. */
function processDecoratedDefinition(node: TreeSitterNode, results: FrameworkDetection[]): void {
	const funcDef = node.children.find((c) => c.type === "function_definition");
	if (!funcDef) return;

	const funcName = funcDef.childForFieldName("name")?.text;
	if (!funcName) return;

	const decorators = node.children.filter((c) => c.type === "decorator");

	for (const decorator of decorators) {
		const detection = analyzeDecorator(decorator, funcName, node.startPosition.row + 1);
		if (detection) {
			results.push(detection);
		}
	}
}

/**
 * Analyzes a single decorator to determine if it matches a framework pattern.
 * Recognizes: @app.get("/path"), @router.post("/path"), @app.route("/path"),
 * @bp.route("/path"), @app.task, @shared_task
 */
function analyzeDecorator(
	decorator: TreeSitterNode,
	funcName: string,
	line: number,
): FrameworkDetection | undefined {
	// The decorator's child after '@' is either a call or an attribute/identifier
	const content = decorator.children.find(
		(c) => c.type === "call" || c.type === "attribute" || c.type === "identifier",
	);
	if (!content) return undefined;

	// Case 1: @shared_task (bare identifier)
	if (content.type === "identifier" && content.text === "shared_task") {
		return { functionName: funcName, route: undefined, isEntryPoint: true, line };
	}

	// Case 2: @app.task (bare attribute, no call)
	if (content.type === "attribute") {
		const attrName = content.children.at(-1)?.text;
		if (attrName === "task") {
			return { functionName: funcName, route: undefined, isEntryPoint: true, line };
		}
	}

	// Case 3: @app.get("/path") or @router.post("/path") or @app.route("/path") — a call
	if (content.type === "call") {
		return analyzeDecoratorCall(content, funcName, line);
	}

	return undefined;
}

/** Analyzes a decorator that is a function call, e.g., @app.post("/api/checkout"). */
function analyzeDecoratorCall(
	callNode: TreeSitterNode,
	funcName: string,
	line: number,
): FrameworkDetection | undefined {
	const callee = callNode.children[0];
	if (!callee || callee.type !== "attribute") return undefined;

	const methodName = callee.children.at(-1)?.text;
	if (!methodName) return undefined;

	const args = callNode.children.find((c) => c.type === "argument_list");
	const firstArg = args?.children.find((c) => c.type === "string");
	const routePath = firstArg ? extractStringContent(firstArg) : undefined;

	// @app.get("/path"), @router.post("/path"), etc.
	if (HTTP_METHODS.has(methodName) && routePath) {
		return {
			functionName: funcName,
			route: `${methodName.toUpperCase()} ${routePath}`,
			isEntryPoint: true,
			line,
		};
	}

	// @app.route("/path") or @bp.route("/path")
	if (methodName === "route" && routePath) {
		return {
			functionName: funcName,
			route: routePath,
			isEntryPoint: true,
			line,
		};
	}

	// @app.task() with parentheses
	if (methodName === "task") {
		return { functionName: funcName, route: undefined, isEntryPoint: true, line };
	}

	return undefined;
}

/** Extracts the string content from a tree-sitter string node, stripping quotes. */
function extractStringContent(stringNode: TreeSitterNode): string | undefined {
	const contentNode = stringNode.children.find((c) => c.type === "string_content");
	return contentNode?.text;
}

export { detectPythonFrameworks, type FrameworkDetection };
