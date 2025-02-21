export default class PriorityQueue<T> {
	items: Array<T>;
	comparator: (a: T, b: T) => number;
	length = 0;

	constructor(comparator: (a: T, b: T) => number, items: Array<T> = []) {
		this.comparator = comparator;
		this.items = items;
	}

	private siftUp(startIdx: number): void {
		const child = this.items[startIdx];
		let childIdx = startIdx;
		while (childIdx > 0) {
			const parentIdx = (childIdx - 1) >> 1;
			const parent = this.items[parentIdx];
			if (this.comparator(child, parent) >= 0) break;
			this.items[childIdx] = parent;
			childIdx = parentIdx;
		}
		this.items[childIdx] = child;
	}

	private siftDown(targetIdx: number): void {
		const targetItem = this.items[targetIdx];
		let index = targetIdx;
		while (true) {
			let lesserChildIdx = (index * 2) | 1;
			if (!(lesserChildIdx < this.length)) break;

			const nextChildIdx = lesserChildIdx + 1;
			if (
				nextChildIdx < this.length &&
				this.comparator(this.items[nextChildIdx], this.items[lesserChildIdx]) <
					0
			) {
				lesserChildIdx = nextChildIdx;
			}

			if (this.comparator(targetItem, this.items[lesserChildIdx]) < 0)
				break;

			this.items[index] = this.items[lesserChildIdx];
			index = lesserChildIdx;
		}
		this.items[index] = targetItem;
	}

	push(item: T): void {
		this.length += 1;
		this.items[this.length - 1] = item;
		this.siftUp(this.length - 1);
	}

	append(items: Iterable<T>): void {
		for (const item of items) this.push(item);
	}

	// assert(self.length > index);
	removeIdx(index: number): T {
		const last = this.items[this.length - 1];
		const item = this.items[index];
		this.items[index] = last;
		this.length -= 1;

		if (index === this.length) {
			// last item removed
		} else if (index === 0) {
			this.siftDown(index);
		} else {
			const parentIdx = (index - 1) >> 1;
			const parent = this.items[parentIdx];
			if (this.comparator(last, parent) > 0) {
				this.siftDown(index);
			} else {
				this.siftUp(index);
			}
		}

		return item;
	}

	pop(): T | undefined {
		if (this.length === 0) return undefined;
		return this.removeIdx(0);
	}

	peek(): T | undefined {
		if (this.length === 0) return undefined;
		return this.items[0];
	}

	size(): number {
		return this.length;
	}

	isEmpty(): boolean {
		return this.length === 0;
	}
}
