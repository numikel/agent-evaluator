/**
 * Pure, deterministic "brain" of the demo chatbot. No I/O: the server feeds it the conversation
 * history and the requested failure mode and streams whatever comes back.
 */

export const DEMO_MODES = ["normal", "slow", "offtopic", "broken", "noattach"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];

export interface DemoMessage {
	role: "user" | "bot";
	text: string;
}

export interface DemoAttachment {
	name: string;
	url: string;
	mime: string;
}

export interface DemoReply {
	/** Full reply text (the server streams it token by token). */
	text: string;
	/** File offered with a "Download" button in the UI. */
	attachment?: DemoAttachment;
	/** Delay before the first token is sent. */
	delayMs: number;
	/** `true` ⇒ the server must never terminate the stream (the `broken` mode). */
	streamForever: boolean;
}

/** The year every invoice refers to; the PDF title is "Invoice <Month> <INVOICE_YEAR>". */
export const INVOICE_YEAR = 2026;

export const MONTHS = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
] as const;
export type Month = (typeof MONTHS)[number];

export function isDemoMode(value: unknown): value is DemoMode {
	return typeof value === "string" && (DEMO_MODES as readonly string[]).includes(value);
}

export function isMonth(value: unknown): value is Month {
	return typeof value === "string" && (MONTHS as readonly string[]).includes(value);
}

export function capitalize(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

export function invoiceAttachment(month: Month): DemoAttachment {
	return {
		name: `invoice-${month}-${INVOICE_YEAR}.pdf`,
		url: `/api/invoice/${month}.pdf`,
		mime: "application/pdf",
	};
}

const NEWSLETTER_PROMO =
	"Before we start: have you seen our brand-new Acme Insider newsletter? " +
	"Subscribe today for weekly product tips and exclusive offers!";

/** Tolerant month matcher: the first three letters, then each remaining letter optional. */
const MONTH_PATTERNS: ReadonlyArray<readonly [Month, RegExp]> = MONTHS.map((month) => {
	const head = month.slice(0, 3);
	const tail = month
		.slice(3)
		.split("")
		.map((ch) => `${ch}?`)
		.join("");
	return [month, new RegExp(`\\b${head}${tail}\\b`, "i")] as const;
});

const INVOICE_INTENT = /\b(invoice|bill|billing|receipt|statement)s?\b/i;
const FOLLOW_UP_INTENT = /\b(download|file|pdf|attach|attachment|send|again|resend|copy)\b/i;
const GREETING =
	/^\s*(hi|hello|hey|good (morning|afternoon|evening)|yo)\b[\s!.,]*(there)?[\s!.,]*$/i;
const THANKS = /\b(thanks|thank you|thx|cheers)\b/i;
const EXPLICIT_CUSTOMER =
	/\b(?:customer|account|client|cust)\.?\s*(?:number|no\.?|#|id)?\s*[:#-]?\s*(\d{3,10})\b/i;
const BARE_NUMBER = /\b(\d{3,10})\b/g;
const YEAR = /^(19|20)\d{2}$/;

function findMonth(text: string): Month | undefined {
	for (const [month, pattern] of MONTH_PATTERNS) {
		if (pattern.test(text)) return month;
	}
	return undefined;
}

function findCustomerNumber(text: string): string | undefined {
	const explicit = EXPLICIT_CUSTOMER.exec(text);
	if (explicit?.[1]) return explicit[1];
	for (const match of text.matchAll(BARE_NUMBER)) {
		const candidate = match[1];
		if (candidate && !YEAR.test(candidate)) return candidate;
	}
	return undefined;
}

function latest<T>(messages: DemoMessage[], pick: (text: string) => T | undefined): T | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message) continue;
		const found = pick(message.text);
		if (found !== undefined) return found;
	}
	return undefined;
}

interface Answer {
	text: string;
	attachment?: DemoAttachment;
}

function answer(history: DemoMessage[], mode: DemoMode): Answer {
	const users = history.filter((m) => m.role === "user");
	const last = users.at(-1);
	if (!last) {
		return {
			text: "Hello! I'm the Acme support assistant. How can I help you today?",
		};
	}
	const text = last.text.trim();
	if (GREETING.test(text)) {
		return { text: "Hi! How can I help you today? I can send you a copy of your invoices." };
	}

	const wantsInvoice = users.some((m) => INVOICE_INTENT.test(m.text));
	const month = latest(users, findMonth);
	const customer = latest(users, findCustomerNumber);
	const continuesInvoiceFlow =
		wantsInvoice &&
		(INVOICE_INTENT.test(text) ||
			FOLLOW_UP_INTENT.test(text) ||
			findMonth(text) !== undefined ||
			findCustomerNumber(text) !== undefined);

	if (continuesInvoiceFlow) {
		if (!customer) {
			return {
				text: "Sure, I can get that for you. Could you give me your customer number first, please?",
			};
		}
		if (!month) {
			return { text: `Thanks! Which month's invoice do you need, customer ${customer}?` };
		}
		const label = `${capitalize(month)} ${INVOICE_YEAR}`;
		if (mode === "noattach") {
			return {
				text:
					`Your ${label} invoice for customer ${customer} is ready. ` +
					"You can find it in your account under Billing → Invoices.",
			};
		}
		return {
			text:
				`Here is your invoice for ${label} (customer ${customer}). ` +
				"Click Download to save the PDF.",
			attachment: invoiceAttachment(month),
		};
	}

	if (THANKS.test(text)) {
		return { text: "You're welcome! Is there anything else I can help you with?" };
	}

	return {
		text:
			"I'm sorry, I'm afraid I can't help with that. In this demo I can only send you " +
			"a copy of an invoice. Could you tell me which invoice you need?",
	};
}

/** Compute the bot's next reply for the given history and failure mode. */
export function reply(history: DemoMessage[], mode: DemoMode = "normal"): DemoReply {
	const base = answer(history, mode);
	const text = mode === "offtopic" ? `${NEWSLETTER_PROMO}\n\n${base.text}` : base.text;
	const result: DemoReply = {
		text,
		delayMs: mode === "slow" ? 3000 : 0,
		streamForever: mode === "broken",
	};
	if (base.attachment) result.attachment = base.attachment;
	return result;
}
