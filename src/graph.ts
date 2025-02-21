import PriorityQueue from "./pq";
import bsearch from "./bsearch";

/** Monotonically increasing number local to an agent. */
export type Sequence = number;
/** Fully qualified version */
export type AgentVersion = {
	agentId: string;
	seq: Sequence;
};
/** Monotonically increasing number local to us. */
export type Version = number;

export interface VersionRange { start: Version; end: Version };
export interface SequenceRange { start: Sequence; end: Sequence };

interface Node extends VersionRange {
	agentId: string;
	seq: Sequence;
	parents: Version[];
};

interface Agent extends SequenceRange {
	version: Version;
};

type Diff = {
	a: VersionRange[];
	b: VersionRange[];
};

interface AgentVersionRanges {
	[agentId: string]: VersionRange[];
}

type AgentNode = {
	id: string;
	seq: number;
	len: number;
	parents: AgentVersion[];
};

type DiffFlag = "a" | "b" | "both";

function cmpNode(n: Node, needle: Version) {
	if (needle < n.start) return 1;
	if (needle >= n.end) return -1;
	return 0;
}

function cmpAgent(a: Agent, needle: Version) {
	if (needle < a.start) return 1;
	if (needle >= a.end)return  -1
	return 0;
}

export class CausalGraph {
	heads: Version[] = [];
	nodes: Node[] = [];
	agents: { [k: string]: Agent[] } = {};

	private nextSeq(): Version {
		return this.nodes[this.nodes.length - 1]?.end ?? 0;
	}

	private findNode(v: Version): Node {
		const idx = bsearch(this.nodes, v, cmpNode);
		if (idx < 0) throw Error(`Invalid or unknown local version ${v}`);
		return this.nodes[idx];
	}

	agentVersion(v: Version): AgentVersion {
		const e = this.findNode(v);
		return { agentId: e.agentId, seq: e.seq + v - e.start };
	}

	agentFrontier(agentId: string): number {
		const agent = this.agents[agentId];
		return agent?.[agent.length - 1].end ?? 0;
	}

	private agent(agentId: string, start: number): Agent | undefined {
		const agents = this.agents[agentId];
		if (!agents) return;

		const idx = bsearch(agents, start, cmpAgent);
		const agent = agents[idx];
		if (!agent) return;

		const offset = start - agent.start;
		if (offset === 0) return agent;

		return {
			start,
			end: agent.end,
			version: agent.version + offset,
		};
	}

	add(
		agentId: string,
		range: SequenceRange,
		parents: Version[] = this.heads,
	): Node | undefined {
		const version = this.nextSeq();

		while (true) {
			const agent = this.agent(agentId, range.start);
			if (!agent) break;
			if (agent.end >= range.end) return;

			range.start = agent.end;
			parents = [
				agent.version + (agent.end - agent.start) - 1,
			];
		}

		const len = range.end - range.start;
		const end = version + len;
		const newNode: Node = {
			start: version,
			end,
			agentId: agentId,
			seq: range.start,
			parents,
		};

		this.nodes.push(newNode);
		const agent = (this.agents[agentId] ??= []);
		agent.push({ start: range.start, end: range.end, version });

		const f = this.heads.filter((v) => !parents.includes(v));
		f.push(end - 1);
		this.heads = f.sort((a, b) => a - b);
		return newNode;
	}

	visitNodes(vStart: Version, vEnd: Version, cb: (e: Node) => void): void {
		let idx = bsearch(this.nodes, vStart, cmpNode);
		if (idx < 0) throw Error(`Invalid or missing version: ${vStart}`);

		for (; idx < this.nodes.length; idx++) {
			const node = this.nodes[idx];
			if (node.start >= vEnd) break;

			cb(node);
		}
	}

	agentVersionRanges(): AgentVersionRanges {
		const res: AgentVersionRanges = {};
		for (const k in this.agents) {
			const av = this.agents[k];
			if (av.length === 0) continue;

			const versions: VersionRange[] = [];
			for (const ce of av) {
				versions.push({ start: ce.start, end: ce.end });
			}

			res[k] = versions;
		}
		return res;
	}

	diff(a: Version[], b: Version[]): Diff {
		const queue = new PriorityQueue<number>((a, b) => b - a);
		const flags: { [n: number]: DiffFlag } = {};
		let nShared = 0;

		function push(v: Version, flag: DiffFlag) {
			const currentType = flags[v];
			if (!currentType) {
				queue.push(v);
				flags[v] = flag;
				if (flag === "both") nShared++;
			} else if (flag !== currentType && currentType !== "both") {
				flags[v] = "both";
				nShared++;
			}
		}

		for (const v of a) push(v, "a");
		for (const v of b) push(v, "b");

		const aOnly: VersionRange[] = [];
		const bOnly: VersionRange[] = [];

		const markRun = (start: Version, endInclusive: Version, flag: DiffFlag) => {
			if (endInclusive < start) throw Error("end < start");

			if (flag === "both") return;
			const target = flag === "a" ? aOnly : bOnly;
			target.push({ start, end: endInclusive + 1 });
		};

		while (queue.size() > nShared) {
			let v = queue.pop()!;
			let flag = flags[v]!;

			if (flag === "both") nShared--;

			const e = this.findNode(v);
			while (!queue.isEmpty() && queue.peek()! >= e.start) {
				const v2 = queue.pop()!;
				const flag2 = flags[v2]!;
				if (flag2 === "both") nShared--;

				if (flag2 !== flag) {
					markRun(v2 + 1, v, flag);
					v = v2;
					flag = "both";
				}
			}

			markRun(e.start, v, flag);

			for (const p of e.parents) push(p, flag);
		}

		aOnly.reverse();
		bOnly.reverse();
		return { a: aOnly, b: bOnly };
	}

	private visitIntersecting(
		summary: AgentVersionRanges,
		cb: (
			agent: string,
			startSeq: number,
			endSeq: number,
			/* -1 means in b only */
			version: number,
		) => void,
	): void {
		for (const agent in summary) {
			const agents = this.agents[agent];

			for (let { start, end } of summary[agent]) {
				if (agents) {
					let idx = bsearch(agents, start, cmpAgent);
					if (idx < 0) idx = -idx - 1;

					for (; idx < agents.length; idx++) {
						const ce = agents[idx];
						if (ce.start >= end) break;

						if (ce.start > start) {
							cb(agent, start, ce.start, -1);
							start = ce.start;
						}

						const seqOffset = start - ce.start;
						const versionStart = ce.version + seqOffset;

						const localSeqEnd = Math.min(ce.end, end);

						cb(agent, start, localSeqEnd, versionStart);

						start = localSeqEnd;
					}
				}

				if (start < end) cb(agent, start, end, -1);
			}
		}
	}

	intersect(summary: AgentVersionRanges, versions: Version[] = []): Version[] {
		const newVersions = versions.slice();
		this.visitIntersecting(
			summary,
			(_agent, startSeq, endSeq, versionStart) => {
				if (versionStart >= 0) {
					const versionEnd = versionStart + (endSeq - startSeq);

					this.visitNodes(versionStart, versionEnd, (e) => {
						const ve = Math.min(versionEnd, e.end);
						const vLast = ve - 1;
						if (vLast < e.start) throw Error("Invalid state");
						newVersions.push(vLast);
					});
				}
			},
		);

		return this.findDominators(newVersions);
	}

	findDominators(versions: Version[]): Version[] {
		if (versions.length <= 1) return versions;
		const res: Version[] = [];

		const queue = new PriorityQueue<number>((a, b) => b - a);
		for (const v of versions) queue.push(v * 2);

		let inputsRemaining = versions.length;

		while (queue.size() > 0 && inputsRemaining > 0) {
			const vEnc = queue.pop()!;
			const isInput = vEnc % 2 === 0;
			const v = vEnc >> 1;

			if (isInput) {
				res.push(v);
				inputsRemaining -= 1;
			}

			const e = this.findNode(v);

			while ((queue.peek() ?? Number.NEGATIVE_INFINITY) >= e.start * 2) {
				const v2Enc = queue.pop()!;
				const isInput2 = v2Enc % 2 === 0;
				if (isInput2) {
					inputsRemaining -= 1;
				}
			}

			for (const p of e.parents) {
				queue.push(p * 2 + 1);
			}
		}

		return res.reverse();
	}

	visitConflicting(
		a: Version[],
		b: Version[],
		visit: (range: VersionRange, flag: DiffFlag) => void,
	): Version[] {
		type TimePoint = {
			v: Version[];
			flag: DiffFlag;
		};

		const pointFromVersions = (v: Version[], flag: DiffFlag) => ({
			v: v.length <= 1 ? v : v.slice().sort((a, b) => b - a),
			flag,
		});

		const queue = new PriorityQueue<TimePoint>((a: TimePoint, b: TimePoint) => {
			for (let i = 0; i < a.v.length; i++) {
				if (b.v.length <= i) return -1;
				const c = b.v[i] - a.v[i];
				if (c !== 0) return c;
			}
			if (a.v.length < b.v.length) return 1;

			return b.flag.localeCompare(a.flag);
		});

		queue.push(pointFromVersions(a, "a"));
		queue.push(pointFromVersions(b, "b"));

		while (true) {
			let { v, flag } = queue.pop()!;
			if (v.length === 0) return [];

			while (!queue.isEmpty()) {
				const { v: peekV, flag: peekFlag } = queue.peek()!;
				if (
					v.length === peekV.length &&
					v.every((vvl, idx) => peekV[idx] === vvl)
				) {
					if (peekFlag !== flag) flag = "both";
					queue.pop();
				} else break;
			}

			if (queue.isEmpty()) return v.reverse();
			if (v.length > 1) {
				for (let i = 1; i < v.length; i++) {
					queue.push({ v: [v[i]], flag });
				}
			}

			const t = v[0];
			const containingTxn = this.findNode(t);

			const txnStart = containingTxn.start;
			let end = t + 1;

			while (true) {
				if (queue.isEmpty()) return [end - 1];
				const { v: peekV, flag: peekFlag } = queue.peek()!;

				if (peekV.length >= 1 && peekV[0] >= txnStart) {
					queue.pop();
					const peekLast = peekV[0];

					if (peekLast + 1 < end) {
						visit({ start: peekLast + 1, end }, flag);
						end = peekLast + 1;
					}

					if (peekFlag !== flag) flag = "both";

					if (peekV.length > 1) {
						for (let i = 1; i < peekV.length; i++) {
							queue.push({ v: [peekV[i]], flag: peekFlag });
						}
					}
				} else {
					visit({ start: txnStart, end }, flag);

					queue.push(pointFromVersions(containingTxn.parents, flag));
					break;
				}
			}
		}
	}

	serializeDiff(ranges: VersionRange[]): AgentNode[] {
		const agentNodes: AgentNode[] = [];
		for (let { start, end } of ranges) {
			while (start !== end) {
				const e = this.findNode(start);
				const offset = start - e.start;

				const localEnd = Math.min(end, e.end);
				const len = localEnd - start;
				const parents: AgentVersion[] =
					offset === 0
						? e.parents.map((p) => this.agentVersion(p))
						: [{ agentId: e.agentId, seq: e.seq + offset - 1 }];

				agentNodes.push({
					id: e.agentId,
					seq: e.seq + offset,
					len,
					parents,
				});

				start += len;
			}
		}

		return agentNodes;
	}

	mergePartialVersions(data: AgentNode[]): VersionRange {
		const start = this.nextSeq();

		for (const { id: agentId, seq, len, parents } of data) {
			const parents_ =
				parents?.map((p) => {
					const agent = this.agent(p.agentId, p.seq);
					if (!agent) throw Error(`Unknown ID: ${p}`);
					return agent.version;
				}) ?? this.heads;

			this.add(agentId, { start: seq, end: seq + len }, parents_);
		}
		return { start, end: this.nextSeq() };
	}
}
