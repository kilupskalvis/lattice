/** Represents a successful result containing data of type T. */
type Ok<T> = { readonly ok: true; readonly data: T };

/** Represents a failed result containing an error of type E. */
type Err<E> = { readonly ok: false; readonly error: E };

/**
 * Discriminated union representing either success or failure.
 * Used throughout the codebase instead of exceptions for error handling.
 */
type Result<T, E> = Ok<T> | Err<E>;

/** Creates a successful Result wrapping the given data. */
function ok<T>(data: T): Ok<T> {
	return { ok: true, data };
}

/** Creates a failed Result wrapping the given error. */
function err<E>(error: E): Err<E> {
	return { ok: false, error };
}

/** Type guard that narrows a Result to Ok. */
function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
	return result.ok;
}

/** Type guard that narrows a Result to Err. */
function isErr<T, E>(result: Result<T, E>): result is Err<E> {
	return !result.ok;
}

/**
 * Extracts the data from an Ok result or throws on Err.
 * Only use at program boundaries — prefer pattern matching elsewhere.
 *
 * @param result - The result to unwrap
 * @returns The data inside the Ok variant
 * @throws Error if the result is Err
 */
function unwrap<T, E>(result: Result<T, E>): T {
	if (result.ok) return result.data;
	throw new Error(`Unwrap called on Err: ${String(result.error)}`);
}

/**
 * Transforms the data inside an Ok result, passes Err through unchanged.
 *
 * @param result - The result to transform
 * @param fn - Transformation function applied to the Ok data
 * @returns A new Result with the transformed data or the original error
 */
function mapResult<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
	if (result.ok) return ok(fn(result.data));
	return result;
}

export { type Err, err, isErr, isOk, mapResult, type Ok, ok, type Result, unwrap };
