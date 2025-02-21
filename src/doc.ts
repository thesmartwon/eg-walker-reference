/**
 * Implementation of [Collaborative Text Editing with Eg-walker: Better,
 * Faster, Smaller](https://arxiv.org/abs/2409.14252) by Joseph Gentle and
 * Martin Kleppmann.
 *
 * This code began simple and slow and was optimized over time for:
 * 1. Document size
 * 2. JS code size
 * 3. Replay speed (some JS code size sacrifices were made)
 */
import { CausalGraph, type Version, type VersionRange } from "./graph";

type InsertOp = { pos: number, insert: string };
type DeleteOp = number;
type Op = InsertOp | DeleteOp;

export class Doc {
	cg = new CausalGraph();
	ops: Op[] = [];
	agent: string;

	constructor(agent: string) {
		this.agent = agent;
	}

	insert(pos: number, content: string): void {
		const seq = this.cg.agentFrontier(this.agent);
		this.cg.add(this.agent, { start: seq, end: seq + content.length });
		for (const val of content) {
			this.ops.push({ pos, insert: val });
			pos++;
		}
	}

	delete(pos: number, len = 1) {
		if (len === 0) throw Error("Invalid delete length");

		const seq = this.cg.agentFrontier(this.agent);
		this.cg.add(this.agent, { start: seq, end: seq + len });
		for (let i = 0; i < len; i++) {
			this.ops.push(pos);
		}
	}

	merge(src: Doc) {
		const vs = this.cg.agentVersionRanges();
		const commonVersion = src.cg.intersect(vs);
		const ranges = src.cg.diff(commonVersion, src.cg.heads).b;

		const cgDiff = src.cg.serializeDiff(ranges);
		this.cg.mergePartialVersions(cgDiff);

		for (const { start, end } of ranges) {
			for (let i = start; i < end; i++) {
				this.ops.push(src.ops[i]);
			}
		}
	}
}

enum ItemState {
	Missing = -1,
	Inserted = 0,
	Deleted = 1,
	// DeletedTwice = 2,
	// ...
}

interface Item {
	opId: number;
	curState: ItemState;
	endState: ItemState;
	/** -1 means start/end of doc */
	originLeft: Version;
	/** -1 means end of the document */
	rightParent: Version;
}

function itemWidth(state: ItemState): number {
	return state === ItemState.Inserted ? 1 : 0;
}

interface DocCursor {
	idx: number;
	endPos: number;
}

class DocWalker extends Doc {
	items: Item[] = [];
	delTargets: number[] = [];
	itemsByLV: Item[] = [];
	curVersion: number[] = [];

	private advance(opId: number) {
		const op = this.ops[opId];

		const isDelete = typeof op === "number";
		const targetLV = isDelete ? this.delTargets[opId] : opId;
		const item = this.itemsByLV[targetLV];

		if (isDelete) {
			item.curState++;
		} else {
			item.curState = ItemState.Inserted;
		}
	}

	private retreat(opId: number) {
		const op = this.ops[opId];
		const targetLV = typeof op === "number" ? this.delTargets[opId] : opId;
		const item = this.itemsByLV[targetLV];
		item.curState--;
	}

	private findByCurPos(targetPos: number): DocCursor {
		let curPos = 0;
		let endPos = 0;
		let idx = 0;

		while (curPos < targetPos) {
			if (idx >= this.items.length)
				throw Error("Document is not long enough to find targetPos");

			const item = this.items[idx];
			curPos += itemWidth(item.curState);
			endPos += itemWidth(item.endState);

			idx++;
		}

		return { idx, endPos };
	}

	private findItemIdx(needle: number): number {
		const idx = this.items.findIndex((i) => i.opId === needle);
		if (idx === -1) throw Error("Could not find needle in items");
		return idx;
	}

	private integrate(newItem: Item, cursor: DocCursor) {
		if (
			cursor.idx >= this.items.length ||
			this.items[cursor.idx].curState !== ItemState.Missing
		)
			return;

		let scanning = false;
		let scanIdx = cursor.idx;
		let scanEndPos = cursor.endPos;

		const leftIdx = cursor.idx - 1;
		const rightIdx =
			newItem.rightParent === -1
				? this.items.length
				: this.findItemIdx(newItem.rightParent);

		while (scanIdx < this.items.length) {
			const other = this.items[scanIdx];

			if (other.curState !== ItemState.Missing) break;
			if (other.opId === newItem.rightParent) throw Error("invalid state");

			const oleftIdx =
				other.originLeft === -1 ? -1 : this.findItemIdx(other.originLeft);
			if (oleftIdx < leftIdx) break;
			if (oleftIdx === leftIdx) {
				const orightIdx =
					other.rightParent === -1
						? this.items.length
						: this.findItemIdx(other.rightParent);

				if (orightIdx === rightIdx) {
					const { agentId: a1, seq: s1 } = this.cg.agentVersion(newItem.opId);
					const { agentId: a2, seq: s2 } = this.cg.agentVersion(other.opId);
					if ((a1.localeCompare(a2) || s1 - s2) < 0) break;
				}
				scanning = orightIdx < rightIdx;
			}

			scanEndPos += itemWidth(other.endState);
			scanIdx++;

			if (!scanning) {
				cursor.idx = scanIdx;
				cursor.endPos = scanEndPos;
			}
		}
	}

	private apply(opId: number, snapshot?: string[]) {
		const op = this.ops[opId];

		if (typeof op === "number") {
			const cursor = this.findByCurPos(op);
			while (this.items[cursor.idx].curState !== ItemState.Inserted) {
				const item = this.items[cursor.idx];
				cursor.endPos += itemWidth(item.endState);
				cursor.idx++;
			}

			const item = this.items[cursor.idx];

			if (item.endState === ItemState.Inserted) {
				if (snapshot) snapshot.splice(cursor.endPos, 1);
			}
			item.curState = item.endState = ItemState.Deleted;

			this.delTargets[opId] = item.opId;
		} else {
			const cursor = this.findByCurPos(op.pos);
			const originLeft =
				cursor.idx === 0 ? -1 : this.items[cursor.idx - 1].opId;
			let rightParent = -1;

			for (let i = cursor.idx; i < this.items.length; i++) {
				const nextItem = this.items[i];
				if (nextItem.curState !== ItemState.Missing) {
					rightParent = nextItem.originLeft === originLeft ? nextItem.opId : -1;
					break;
				}
			}

			const newItem: Item = {
				curState: ItemState.Inserted,
				endState: ItemState.Inserted,
				opId,
				originLeft,
				rightParent,
			};
			this.itemsByLV[opId] = newItem;

			this.integrate(newItem, cursor);

			this.items.splice(cursor.idx, 0, newItem);

			if (snapshot) snapshot.splice(cursor.endPos, 0, op.insert);
		}
	}

	walk(snapshot?: string[], fromOp = 0, toOp = this.ops.length) {
		this.cg.visitNodes(fromOp, toOp, (entry) => {
			const { a, b } = this.cg.diff(this.curVersion, entry.parents);

			for (let i = a.length - 1; i >= 0; i--) {
				const { start, end } = a[i];
				for (let j = end - 1; j >= start; j--) this.retreat(j);
			}

			for (const { start, end } of b) {
				for (let i = start; i < end; i++) this.advance(i);
			}

			for (let i = entry.start; i < entry.end; i++) {
				this.apply(i, snapshot);
			}

			this.curVersion = [entry.end - 1];
		});
	}
}

export function printTree(doc: DocWalker) {
	const depth: Record<number, number> = {};
	depth[-1] = 0;

	for (const item of doc.items) {
		const isLeftChild = true;
		const parent = isLeftChild ? item.originLeft : item.rightParent;
		const d = parent === -1 ? 0 : depth[parent] + 1;

		depth[item.opId] = d;
		const lvToStr = (lv: number) => {
			if (lv === -1) return "ROOT";
			const rv = doc.cg.agentVersion(lv);
			return `[${rv.agentId},${rv.seq}]`;
		};

		const op = doc.ops[item.opId];
		if (typeof op === "number") throw Error("Invalid state");

		const isDeleted = item.endState === ItemState.Deleted;
		const content = [
			isDeleted ? `~${op.insert}~` : op.insert,
			`(${lvToStr(item.opId)})`,
			lvToStr(item.originLeft),
			lvToStr(item.rightParent),
		].join(" ");
		console.log(`${"| ".repeat(d)}${content}`);
	}
}

export class Branch {
	ctx = new DocWalker("");
	snapshot: string[] = [];
	version: number[] = [];

	constructor(doc: Doc) {
		this.ctx.ops = doc.ops;
		this.ctx.cg = doc.cg;
		this.ctx.delTargets = new Array(doc.ops.length).fill(-1);
		this.ctx.itemsByLV = new Array(doc.ops.length);

		this.ctx.walk(this.snapshot);
		this.version = doc.cg.heads.slice();
	}

	toString(): string {
		return this.snapshot.join("");
	}

	merge(mergeVersion: number[] = this.ctx.cg.heads) {
		const newOps: VersionRange[] = [];
		const conflictOps: VersionRange[] = [];

		const commonAncestor = this.ctx.cg.visitConflicting(
			this.version,
			mergeVersion,
			(span, flag) => {
				const target = flag === "b" ? newOps : conflictOps;

				let last: VersionRange;
				if (
					target.length > 0 &&
					(last = target[target.length - 1]).start === span.end
				) {
					last.start = span.start;
				} else {
					target.push(span);
				}
			},
		);
		newOps.reverse();
		conflictOps.reverse();

		this.ctx.curVersion = commonAncestor;

		const placeholderLength = Math.max(...this.version) + 1;

		for (let i = 0; i < placeholderLength; i++) {
			const opId = i + 1e12;
			const item: Item = {
				opId,
				curState: ItemState.Inserted,
				endState: ItemState.Inserted,
				originLeft: -1,
				rightParent: -1,
			};
			this.ctx.items.push(item);
			this.ctx.itemsByLV[opId] = item;
		}

		for (const { start, end } of conflictOps) {
			this.ctx.walk(undefined, start, end);
		}

		for (const { start, end } of newOps) {
			this.ctx.walk(this.snapshot, start, end);
		}
		this.version = this.ctx.cg.findDominators([
			...this.version,
			...mergeVersion,
		]);
	}
}
