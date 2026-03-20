#!/usr/bin/env bun
/**
 * Postinstall script — creates a minimal Python venv and installs zuban into it.
 * This gives zuban a proper Python environment with typeshed stubs.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const VENDOR_DIR = join(import.meta.dir, "..", "vendor");
const VENV_DIR = join(VENDOR_DIR, "venv");

function findPython(): string | undefined {
	for (const cmd of ["python3", "python"]) {
		if (Bun.which(cmd)) return cmd;
	}
	return undefined;
}

async function main() {
	const isWindows = process.platform === "win32";
	const zubanBin = join(VENV_DIR, isWindows ? "Scripts" : "bin", isWindows ? "zubanls.exe" : "zubanls");

	if (existsSync(zubanBin)) {
		console.log("zuban already installed");
		return;
	}

	const python = findPython();
	if (!python) {
		console.warn("Warning: Python not found. Python support requires python3 in PATH.");
		return;
	}

	console.log("Installing zuban for Python support...");

	try {
		// Create venv
		const venvResult = Bun.spawnSync([python, "-m", "venv", VENV_DIR], {
			stdout: "ignore",
			stderr: "pipe",
		});
		if (venvResult.exitCode !== 0) {
			throw new Error(`Failed to create venv: ${venvResult.stderr.toString()}`);
		}

		// Install zuban via pip
		const pip = join(VENV_DIR, isWindows ? "Scripts" : "bin", "pip");
		const pipResult = Bun.spawnSync([pip, "install", "zuban", "--quiet"], {
			stdout: "ignore",
			stderr: "pipe",
		});
		if (pipResult.exitCode !== 0) {
			throw new Error(`Failed to install zuban: ${pipResult.stderr.toString()}`);
		}

		if (!existsSync(zubanBin)) {
			throw new Error("zubanls binary not found after installation");
		}

		console.log("zuban installed successfully");
	} catch (error) {
		console.warn(
			`Warning: Failed to install zuban: ${error instanceof Error ? error.message : error}. ` +
				"Python support requires: pip install zuban",
		);
	}
}

main();
