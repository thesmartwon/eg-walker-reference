import { test, expect } from "bun:test";
import { Branch, Doc, printTree } from "./doc";

test("insert, merge, delete, insert, merge", () => {
	const doc1 = new Doc("user1");
	doc1.insert(0, "share");

	const doc2 = new Doc("user2");
	doc2.insert(0, "word");

	doc1.merge(doc2);
	doc2.merge(doc1);

	const expected = "shareword";

	expect(new Branch(doc1).toString()).toBe(expected);
	expect(new Branch(doc2).toString()).toBe(expected);

	doc1.delete(0, 5);
	doc1.insert(0, "the");

	doc2.insert(expected.length, "s");

	doc1.merge(doc2);
	doc2.merge(doc1);

	const expected2 = "thewords";

	expect(new Branch(doc1).toString()).toBe(expected2);
	expect(new Branch(doc2).toString()).toBe(expected2);

	console.dir(doc1, { depth: null });
	printTree(new Branch(doc1).ctx);
});
