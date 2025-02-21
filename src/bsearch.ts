/**
 * Find `needle` in a `haystack` presorted by `comparator`.
 *
 * May specify `fromIdx` and `toIdx` to narrow search range. HOWEVER:
 * - fromIdx must be >= 0 and < haystack.length
 *  - toIdx must be >= fromIdx and < haystack.length
 *
 * Returns the index of `needle`  if found.
 *  Otherwise returns `-index - 1`, where `index` is where `needle` would be
 *  found.
 */
export default function binarySearch<A, B>(
	haystack: ArrayLike<A>,
	needle: B,
	comparator: (a: A, b: B, index: number, haystack: ArrayLike<A>) => number,
	fromIdx = 0,
	toIdx = haystack.length - 1,
): number {
	// Constrain to 32 bits because max array length is 2^32 - 1.
	fromIdx = fromIdx | 0;
	toIdx = toIdx | 0;

	// Sanity check.
	//if (fromIdx < 0 || fromIdx >= haystack.length)
	//	throw new RangeError("invalid fromIdx");
	//if (toIdx < fromIdx || toIdx >= haystack.length)
	//	throw new RangeError("invalid toIdx");

	let mid: number;
	let cmp: number;
	while (fromIdx <= toIdx) {
		// `low + high >>> 1` fails for array lengths > 2^31
		// because `>>>` converts to int32. This works on the
		// whole range for the cost of an extra subtraction.
		mid = fromIdx + ((toIdx - fromIdx) >>> 1);
		cmp = comparator(haystack[mid], needle, mid, haystack);

		if (cmp < 0) {
			fromIdx = mid + 1;
		} else if (cmp > 0) {
			toIdx = mid - 1;
		} else {
			return mid;
		}
	}

	// Return one less than where the key would go.
	// We could return -fromIdx, but then the caller would be forced to check
	// for `-0` vs `0` and that's complicated.
	return ~fromIdx;
}
