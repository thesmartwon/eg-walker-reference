import { test, expect } from "bun:test";
import PriorityQueue from "./pq";

const nComp = (a: number, b: number) => a - b;

test("push and pop", () => {
	const pq = new PriorityQueue<number>(nComp);

	pq.push(30);
	pq.push(20);
	pq.push(10);
	expect(pq.length).toBe(3);

	expect(pq.pop()).toBe(10);
	expect(pq.pop()).toBe(20);
	expect(pq.pop()).toBe(30);
	expect(pq.length).toBe(0);
});

test("siftUp with odd indices", () => {
	const pq = new PriorityQueue<number>(nComp);

	const items = [15, 7, 21, 14, 13, 22, 12, 6, 7, 25, 5, 24, 11, 16, 15, 24, 2, 1];
	pq.append(items);

	const sorted = items.toSorted(nComp);
	sorted.forEach(n => expect(pq.pop()).toBe(n));
});

test("siftUp in remove", () => {
	const pq = new PriorityQueue<number>((a, b) => a - b);
	const items = [0, 1, 100, 2, 3, 101, 102, 4, 5, 6, 7, 103, 104, 105, 106, 8];
	pq.append(items);

	const idx = pq.items.findIndex(v => v === 102);
	pq.removeIdx(idx);

    const sorted = items.filter(v => v !== 102).toSorted(nComp);
	sorted.forEach(n => expect(pq.pop()).toBe(n));
});
