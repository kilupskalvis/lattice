import { describe, expect, it } from "bun:test";
import { err, isErr, isOk, mapResult, ok, type Result, unwrap } from "../../src/types/result.ts";

describe("Result", () => {
	it("creates an ok result", () => {
		const result = ok(42);
		expect(result.ok).toBe(true);
		expect(isOk(result)).toBe(true);
		expect(isErr(result)).toBe(false);
	});

	it("creates an err result", () => {
		const result = err("something failed");
		expect(result.ok).toBe(false);
		expect(isOk(result)).toBe(false);
		expect(isErr(result)).toBe(true);
	});

	it("unwraps an ok result", () => {
		expect(unwrap(ok(42))).toBe(42);
	});

	it("throws when unwrapping an err result", () => {
		expect(() => unwrap(err("fail"))).toThrow();
	});

	it("maps an ok result", () => {
		const result = mapResult(ok(2), (n) => n * 3);
		expect(unwrap(result)).toBe(6);
	});

	it("passes through err on map", () => {
		const e: Result<number, string> = err("fail");
		const result = mapResult(e, (n: number) => n * 3);
		expect(isErr(result)).toBe(true);
	});
});
