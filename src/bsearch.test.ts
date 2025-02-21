import { test, expect } from "bun:test";
import binarySearch from "./bsearch";

test("small haystack", () => {
	const a = [1, 1, 3, 5, 5];

	const comparator = (a: number, b: number) => a - b;

	expect(binarySearch(a, 3, comparator)).toBe(2);
	expect(binarySearch(a, 2, comparator)).toBe(-3);
	expect(binarySearch(a, 0, comparator)).toBe(-1);
});
