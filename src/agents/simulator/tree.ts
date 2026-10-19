/**
 * Heuristics over Playwright's `ariaSnapshot({ mode: "ai" })` YAML trees:
 * locating the chat input, rendering the tree as plain text and extracting the bot's reply by
 * diffing the tree before and after a message was sent.
 */

export type TreeLine = {
	depth: number;
	role: string;
	name: string | undefined;
	text: string | undefined;
	ref: string | undefined;
	/** Original line with `[ref=eN]` markers removed, used for diffing. */
	key: string;
};

/** Roles whose accessible name is a control label rather than content. */
const CONTROL_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"combobox",
	"checkbox",
	"radio",
	"switch",
	"slider",
	"spinbutton",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"tab",
	"searchbox",
	"img",
]);

const MESSAGE_INPUT_PATTERN = /message|chat|ask|type|prompt|question|say|write/i;

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			const inner = trimmed.slice(1, -1);
			return first === '"' ? inner.replace(/\\(["\\])/g, "$1") : inner.replace(/''/g, "'");
		}
	}
	return trimmed;
}

const LINE_PATTERN = /^(\s*)-\s+(.*)$/;
const NODE_PATTERN =
	/^([a-zA-Z][\w-]*)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s+\[[^\]]*\])*)\s*(?::\s*(.*))?$/;

export function parseTreeLine(line: string): TreeLine | undefined {
	const match = LINE_PATTERN.exec(line);
	if (!match) return undefined;
	const indent = match[1] ?? "";
	let body = unquote(match[2] ?? "");
	if (body.startsWith("/")) return undefined; // property lines such as `/url: …`
	const key = body.replace(/\s*\[ref=[^\]]+\]/g, "");
	const node = NODE_PATTERN.exec(body);
	if (!node) {
		body = body.trim();
		return { depth: indent.length, role: "text", name: undefined, text: body, ref: undefined, key };
	}
	const role = (node[1] ?? "").toLowerCase();
	const attrs = node[3] ?? "";
	const refMatch = /\[ref=([^\]]+)\]/.exec(attrs);
	const rawText = node[4];
	const text = rawText === undefined || rawText === "" ? undefined : unquote(rawText);
	const name = node[2] === undefined ? undefined : node[2].replace(/\\(["\\])/g, "$1");
	return { depth: indent.length, role, name, text, ref: refMatch?.[1], key };
}

export function parseTree(tree: string): TreeLine[] {
	const lines: TreeLine[] = [];
	for (const raw of tree.split(/\r?\n/)) {
		const parsed = parseTreeLine(raw);
		if (parsed) lines.push(parsed);
	}
	return lines;
}

/** Human-readable rendering of one node, or undefined for pure structure (e.g. `generic:`). */
export function lineToText(line: TreeLine): string | undefined {
	if (CONTROL_ROLES.has(line.role)) {
		const label = line.name ?? line.text;
		return label ? `[${line.role}] ${label}` : undefined;
	}
	if (line.role === "text") return line.text ?? line.name;
	if (line.text) return line.name ? `${line.name}: ${line.text}` : line.text;
	return line.name;
}

/** Flattens the tree into readable lines (headings, paragraphs, control labels). */
export function treeToText(tree: string): string {
	return parseTree(tree)
		.map(lineToText)
		.filter((t): t is string => t !== undefined && t.length > 0)
		.join("\n");
}

/**
 * Finds the ref of the chat input: a `textbox` whose name looks like a message field, otherwise
 * the only textbox on the page. Returns undefined when there is none or the choice is ambiguous.
 */
export function findMessageTextbox(tree: string): string | undefined {
	const boxes = parseTree(tree).filter(
		(l) => (l.role === "textbox" || l.role === "searchbox") && l.ref !== undefined,
	);
	const named = boxes.filter((b) => b.name !== undefined && MESSAGE_INPUT_PATTERN.test(b.name));
	if (named.length >= 1) return named[named.length - 1]?.ref;
	if (boxes.length === 1) return boxes[0]?.ref;
	return undefined;
}

function normalise(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Lines present in `after` that were not present in `before` (multiset diff, order preserved). */
export function newLines(before: string, after: string): TreeLine[] {
	const counts = new Map<string, number>();
	for (const line of parseTree(before)) counts.set(line.key, (counts.get(line.key) ?? 0) + 1);
	const added: TreeLine[] = [];
	for (const line of parseTree(after)) {
		const remaining = counts.get(line.key) ?? 0;
		if (remaining > 0) counts.set(line.key, remaining - 1);
		else added.push(line);
	}
	return added;
}

export type ExtractReplyInput = {
	before: string;
	after: string;
	userText: string;
	maxNodes?: number;
};

/**
 * Extracts the bot reply as text: everything new in the tree after the echo of the user's message;
 * when the user's text is not echoed, the last `maxNodes` (default 40) new text nodes. Ignores the
 * message textbox itself. Returns "" when nothing new appeared.
 */
export function extractBotReply(input: ExtractReplyInput): string {
	const maxNodes = input.maxNodes ?? 40;
	const user = normalise(input.userText);
	const added = newLines(input.before, input.after).filter(
		(l) => l.role !== "textbox" && l.role !== "searchbox",
	);
	const texts = added
		.map((line) => ({ line, text: lineToText(line) }))
		.filter(
			(e): e is { line: TreeLine; text: string } => e.text !== undefined && e.text.length > 0,
		);
	const echoIndex = texts.findLastIndex((e) => normalise(e.text) === user);
	const candidates = echoIndex >= 0 ? texts.slice(echoIndex + 1) : texts;
	const filtered = candidates.filter((e) => normalise(e.text) !== user);
	return filtered
		.slice(-maxNodes)
		.map((e) => e.text)
		.join("\n");
}
