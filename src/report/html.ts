/*
 * Design tokens for the HTML report (inline CSS, system fonts, no external assets).
 *
 * Colours (light / dark via `prefers-color-scheme`), six named tokens:
 *   --bg      page background                 #f6f5f2 / #141416
 *   --ink     primary text                    #1c1c1e / #ececec
 *   --muted   secondary text, captions         #6b6b70 / #9a9aa0
 *   --pass    PASSED badge, gauge arc          #1f7a4d / #4cc38a
 *   --fail    FAILED/ERROR badge, errors       #b42318 / #ff6b5e
 *   --accent  links, focus ring, markers       #2456c9 / #7aa2ff
 *   (hairlines are derived: color-mix(var(--ink) 14%, transparent))
 * Type roles: "display" (h1 and the score figure: system sans, tight, tabular numerals) and
 *   "body" (everything else; paths, ids and refs in the system mono stack).
 * Spacing scale: 4 / 8 / 12 / 16 / 24 / 40 px (--s1 … --s6).
 * Boldness is spent once: the score gauge in the header. Everything else stays quiet —
 *   hairline borders, no shadows, no gradients, native <details> for collapsibles.
 */

import type {
	ConsoleEntry,
	CriterionResult,
	DownloadArtifact,
	EvidenceRef,
	Step,
	TranscriptEntry,
} from "../schemas/index.js";
import { overallStatus } from "./summary.js";
import {
	anchorForScreenshot,
	escapeHtml,
	formatBytes,
	percent,
	secondsBetween,
	truncate,
} from "./text.js";
import type { RenderHtmlOptions, ReportInput } from "./types.js";

const CSS = `
:root {
	color-scheme: light dark;
	--bg: #f6f5f2; --ink: #1c1c1e; --muted: #6b6b70;
	--pass: #1f7a4d; --fail: #b42318; --accent: #2456c9;
	--line: color-mix(in srgb, var(--ink) 14%, transparent);
	--soft: color-mix(in srgb, var(--ink) 5%, transparent);
	--s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 40px;
	--font-body: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) {
	:root { --bg: #141416; --ink: #ececec; --muted: #9a9aa0; --pass: #4cc38a; --fail: #ff6b5e; --accent: #7aa2ff; }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--font-body); }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code, pre, .mono { font-family: var(--font-mono); font-size: 0.92em; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; padding: var(--s3); border: 1px solid var(--line); border-radius: 6px; background: var(--soft); max-height: 24rem; overflow: auto; }
h1, h2, h3 { line-height: 1.2; margin: 0; font-weight: 600; }
h1 { font-size: 1.75rem; letter-spacing: -0.01em; }
h2 { font-size: 1.25rem; margin-bottom: var(--s4); padding-bottom: var(--s2); border-bottom: 1px solid var(--line); }
h3 { font-size: 1rem; margin: var(--s4) 0 var(--s2); }
.skip { position: absolute; left: -999px; top: var(--s2); background: var(--bg); padding: var(--s2) var(--s3); border: 1px solid var(--line); }
.skip:focus { left: var(--s2); z-index: 10; }
.wrap { max-width: 1100px; margin: 0 auto; padding: var(--s5) var(--s4) var(--s6); }
.hero { display: grid; grid-template-columns: 1fr auto; gap: var(--s5); align-items: start; padding-bottom: var(--s5); border-bottom: 1px solid var(--line); }
@media (max-width: 720px) { .hero { grid-template-columns: 1fr; } }
.eyebrow { margin: 0 0 var(--s1); color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
.lede { margin: var(--s2) 0 0; color: var(--muted); }
.badge { display: inline-block; vertical-align: middle; margin-left: var(--s2); padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; color: #fff; }
.badge-pass { background: var(--pass); }
.badge-fail, .badge-error { background: var(--fail); }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: var(--s1) var(--s4); margin: var(--s4) 0 0; font-size: 0.9rem; }
.meta dt { color: var(--muted); }
.meta dd { margin: 0; overflow-wrap: anywhere; }
.gauge-card { display: grid; justify-items: center; gap: var(--s2); min-width: 220px; padding: var(--s4); border: 1px solid var(--line); border-radius: 12px; }
.gauge { position: relative; width: 160px; height: 160px; }
.gauge svg { width: 100%; height: 100%; }
.gauge-track { fill: none; stroke: var(--line); stroke-width: 10; }
.gauge-arc { fill: none; stroke-width: 10; stroke-linecap: round; }
.pass .gauge-arc { stroke: var(--pass); }
.fail .gauge-arc, .error .gauge-arc { stroke: var(--fail); }
.gauge-mark { stroke: var(--ink); stroke-width: 2; }
.gauge-value { position: absolute; inset: 0; display: grid; place-content: center; font-size: 2.4rem; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.gauge-facts { margin: 0; display: grid; grid-template-columns: max-content auto; gap: var(--s1) var(--s3); font-size: 0.9rem; }
.gauge-facts dt { color: var(--muted); }
.gauge-facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.toc { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); padding: var(--s3) 0; font-size: 0.9rem; border-bottom: 1px solid var(--line); align-items: center; }
.toc .tools { margin-left: auto; display: flex; gap: var(--s2); }
button { font: inherit; color: var(--ink); background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: var(--s1) var(--s3); cursor: pointer; }
section.block { padding: var(--s5) 0; border-bottom: 1px solid var(--line); }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; vertical-align: top; padding: var(--s2) var(--s2); border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ok { color: var(--pass); font-weight: 600; }
.bad { color: var(--fail); font-weight: 600; }
tr.failed td:first-child { box-shadow: inset 3px 0 0 var(--fail); }
.evidence { margin: 0; padding: 0; list-style: none; }
.evidence li { margin-bottom: var(--s1); }
.evidence q { color: var(--muted); }
.turn { margin-bottom: var(--s5); }
.msg { display: grid; grid-template-columns: 4.5rem 1fr; gap: var(--s3); padding: var(--s3) 0; border-top: 1px solid var(--line); }
.msg:first-of-type { border-top: 0; }
.msg .role { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 2px; }
.msg.bot .role { color: var(--accent); }
.msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg .when { display: block; color: var(--muted); font-size: 0.8rem; margin-top: var(--s1); }
.shots { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s2); }
a.shot { display: inline-block; border: 1px solid var(--line); border-radius: 4px; background: var(--soft); line-height: 0; }
a.shot img { display: block; width: 160px; height: 100px; object-fit: cover; object-position: top; border-radius: 4px; }
.filmstrip { display: flex; gap: var(--s4); overflow-x: auto; padding: var(--s2) 0 var(--s4); margin: 0; list-style: none; scroll-snap-type: x proximity; }
.filmstrip li { flex: 0 0 auto; scroll-snap-align: start; }
.filmstrip figure { margin: 0; width: 340px; padding: var(--s3); border: 1px solid var(--line); border-radius: 8px; }
.filmstrip figure.has-error { border-color: var(--fail); }
.filmstrip figcaption { font-size: 0.85rem; margin-bottom: var(--s2); }
.filmstrip .label { display: block; font-weight: 600; overflow-wrap: anywhere; }
.filmstrip .sub { color: var(--muted); }
.frames { display: flex; gap: var(--s2); flex-wrap: wrap; }
.frame { font-size: 0.75rem; color: var(--muted); text-align: center; }
.frame.primary a.shot img { width: 316px; height: 198px; }
.frame.primary { width: 100%; }
details { margin-top: var(--s2); }
summary { cursor: pointer; color: var(--accent); }
.cards { display: grid; gap: var(--s3); margin: 0; padding: 0; list-style: none; }
.card { padding: var(--s3); border: 1px solid var(--line); border-radius: 8px; }
.card .facts { color: var(--muted); font-size: 0.85rem; }
.empty { color: var(--muted); font-style: italic; }
.err { color: var(--fail); }
footer { padding-top: var(--s4); color: var(--muted); font-size: 0.85rem; }
dialog { max-width: 96vw; max-height: 96vh; padding: var(--s2); border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); }
dialog::backdrop { background: rgba(0,0,0,0.6); }
dialog img { display: block; max-width: 92vw; max-height: 84vh; }
dialog button { margin-bottom: var(--s2); }
`;

const JS = `
(function () {
	var dlg = document.getElementById("lightbox");
	var big = dlg ? dlg.querySelector("img") : null;
	if (dlg && big && typeof dlg.showModal === "function") {
		document.addEventListener("click", function (e) {
			var a = e.target && e.target.closest ? e.target.closest("a.shot") : null;
			if (!a) return;
			e.preventDefault();
			var thumb = a.querySelector("img");
			big.src = a.getAttribute("href");
			big.alt = thumb ? thumb.alt : "Screenshot";
			dlg.showModal();
		});
		dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
		dlg.querySelector("button").addEventListener("click", function () { dlg.close(); });
	}
	function reveal() {
		var id = location.hash.slice(1);
		if (!id) return;
		var el = document.getElementById(id);
		if (!el) return;
		var d = el.closest("details");
		while (d) { d.open = true; d = d.parentElement ? d.parentElement.closest("details") : null; }
		el.scrollIntoView();
	}
	window.addEventListener("hashchange", reveal);
	reveal();
	var toggles = document.querySelectorAll("[data-toggle]");
	for (var i = 0; i < toggles.length; i++) {
		toggles[i].addEventListener("click", function () {
			var open = this.getAttribute("data-toggle") === "open";
			var all = document.querySelectorAll("main details");
			for (var j = 0; j < all.length; j++) all[j].open = open;
		});
	}
})();
`;

type ImageSources = Map<string, string>;

/** Short, human label for a step's action (used in captions and alt text). */
export function actionLabel(step: Step): string {
	const a = step.action;
	switch (a.kind) {
		case "open":
			return `open ${a.url}`;
		case "snapshot":
			return "snapshot";
		case "click":
			return `click ${a.ref}`;
		case "type":
			return `type "${truncate(a.text, 60)}" into ${a.ref}${a.submit ? " and submit" : ""}`;
		case "press":
			return `press ${a.key}`;
		case "scroll":
			return `scroll ${a.direction} ${a.amount}`;
		case "wait":
			return `wait ${a.ms} ms`;
		case "send_message":
			return `send message "${truncate(a.text, 60)}"`;
		case "read_conversation":
			return "read conversation";
		case "download":
			return `download ${a.ref}`;
		case "upload":
			return `upload ${a.file} to ${a.ref}`;
		case "screenshot_view":
			return "view screenshot";
		case "click_at":
			return `click at (${a.x}, ${a.y})`;
		case "type_at":
			return `type "${truncate(a.text, 60)}" at (${a.x}, ${a.y})`;
		case "end_conversation":
			return `end conversation (${a.reason})`;
	}
}

function mimeForPath(path: string): string {
	const ext = path.toLowerCase().split(".").pop() ?? "";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	if (ext === "webp") return "image/webp";
	if (ext === "gif") return "image/gif";
	return "image/png";
}

function screenshotPaths(input: ReportInput): string[] {
	const paths = new Set<string>();
	for (const s of input.steps) {
		if (s.screenshot_before) paths.add(s.screenshot_before);
		for (const p of s.interim_screenshots) paths.add(p);
		if (s.screenshot) paths.add(s.screenshot);
	}
	return [...paths];
}

async function resolveImageSources(
	input: ReportInput,
	options: RenderHtmlOptions,
): Promise<ImageSources> {
	const paths = screenshotPaths(input);
	const sources: ImageSources = new Map(paths.map((p) => [p, p]));
	if (!options.inlineImages || !options.imageLoader) return sources;
	const loader = options.imageLoader;
	await Promise.all(
		paths.map(async (path) => {
			try {
				const bytes = await loader(path);
				if (bytes && bytes.byteLength > 0) {
					const b64 = Buffer.from(bytes).toString("base64");
					sources.set(path, `data:${mimeForPath(path)};base64,${b64}`);
				}
			} catch {
				// keep the relative path: a missing image must not break the report
			}
		}),
	);
	return sources;
}

function thumb(
	path: string,
	alt: string,
	sources: ImageSources,
	extra: { id?: string; caption?: string } = {},
): string {
	const src = escapeHtml(sources.get(path) ?? path);
	const link = `<a class="shot" href="${src}" title="${escapeHtml(path)}"><img src="${src}" alt="${escapeHtml(alt)}" loading="lazy"></a>`;
	const caption = extra.caption ? `<div>${escapeHtml(extra.caption)}</div>` : "";
	const id = extra.id ? ` id="${escapeHtml(extra.id)}"` : "";
	const cls = extra.caption === "after" ? "frame primary" : "frame";
	return `<div class="${cls}"${id}>${link}${caption}</div>`;
}

function badge(status: "PASSED" | "FAILED" | "ERROR"): string {
	const cls =
		status === "PASSED" ? "badge-pass" : status === "FAILED" ? "badge-fail" : "badge-error";
	return `<span class="badge ${cls}">${status}</span>`;
}

function gauge(input: ReportInput, status: "PASSED" | "FAILED" | "ERROR"): string {
	const { verdict } = input;
	const pct = percent(verdict.score);
	const r = 52;
	const circumference = 2 * Math.PI * r;
	const offset = circumference * (1 - Math.min(1, Math.max(0, verdict.score)));
	const tick = verdict.pass_threshold * 360;
	const cls = status === "PASSED" ? "pass" : status === "FAILED" ? "fail" : "error";
	const label = `Score ${pct}% of 100, pass threshold ${percent(verdict.pass_threshold)}%`;
	return `<div class="gauge-card ${cls}">
	<div class="gauge">
		<svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(label)}">
			<circle class="gauge-track" cx="60" cy="60" r="${r}"/>
			<circle class="gauge-arc" cx="60" cy="60" r="${r}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 60 60)"/>
			<line class="gauge-mark" x1="60" y1="4" x2="60" y2="14" transform="rotate(${tick.toFixed(1)} 60 60)"/>
		</svg>
		<div class="gauge-value" aria-hidden="true">${pct}%</div>
	</div>
	<dl class="gauge-facts">
		<dt>Pass threshold</dt><dd>${percent(verdict.pass_threshold)}%</dd>
		<dt>Turns</dt><dd>${verdict.turns_used} / ${verdict.max_turns}</dd>
		<dt>Goal reached</dt><dd class="${verdict.goal_reached ? "ok" : "bad"}">${verdict.goal_reached ? "yes" : "no"}</dd>
	</dl>
</div>`;
}

function header(input: ReportInput, status: "PASSED" | "FAILED" | "ERROR"): string {
	const { run, resolved } = input;
	const rows: Array<[string, string]> = [
		[
			"Persona",
			`<code>${escapeHtml(run.persona)}</code> · ${escapeHtml(resolved.persona.description)}`,
		],
		[
			"Target",
			`<code>${escapeHtml(run.target)}</code> · <a href="${escapeHtml(resolved.target.url)}">${escapeHtml(resolved.target.url)}</a>`,
		],
		["Rubric", `<code>${escapeHtml(run.rubric)}</code>`],
		["Simulator model", `<code>${escapeHtml(run.models.simulator)}</code>`],
		["Judge model", `<code>${escapeHtml(run.models.judge)}</code>`],
		["Run id", `<code>${escapeHtml(run.id)}</code>`],
		["Started", escapeHtml(run.started_at)],
	];
	if (run.finished_at) {
		rows.push(["Duration", `${secondsBetween(run.started_at, run.finished_at)} s`]);
	}
	if (run.repeat_total > 1) rows.push(["Repeat", `${run.repeat_index} of ${run.repeat_total}`]);
	const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("\n\t\t");
	return `<header class="hero">
	<div>
		<p class="eyebrow">agent-evaluator run report</p>
		<h1>${escapeHtml(run.scenario)} ${badge(status)}</h1>
		${resolved.scenario.description ? `<p class="lede">${escapeHtml(resolved.scenario.description)}</p>` : ""}
		<dl class="meta">
		${dl}
		</dl>
	</div>
	${gauge(input, status)}
</header>`;
}

function evidenceLinks(evidence: EvidenceRef[], sources: ImageSources): string {
	if (evidence.length === 0) return '<span class="empty">none</span>';
	const items = evidence.map((e) => {
		let href: string | undefined;
		let label: string;
		if (e.screenshot && sources.has(e.screenshot)) {
			href = `#${anchorForScreenshot(e.screenshot)}`;
			label = e.screenshot;
		} else if (e.step !== undefined) {
			href = `#step-${e.step}`;
			label = `step ${e.step}`;
		} else if (e.turn !== undefined) {
			href = e.turn > 0 ? `#turn-${e.turn}` : "#filmstrip";
			label = e.turn > 0 ? `turn ${e.turn}` : "setup";
		} else {
			label = e.screenshot ?? "evidence";
		}
		const link = href
			? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
			: escapeHtml(label);
		const quote = e.quote ? ` <q>${escapeHtml(truncate(e.quote, 160))}</q>` : "";
		return `<li>${link}${quote}</li>`;
	});
	return `<ul class="evidence">${items.join("")}</ul>`;
}

function criteriaTable(input: ReportInput, sources: ImageSources): string {
	const types = new Map(input.resolved.rubric.criteria.map((c) => [c.id, c.type]));
	const row = (c: CriterionResult) => `<tr class="${c.pass ? "passed" : "failed"}">
	<td><code>${escapeHtml(c.id)}</code></td>
	<td>${escapeHtml(types.get(c.id) ?? "unknown")}</td>
	<td class="num">${c.weight}</td>
	<td>${c.required ? "yes" : "no"}</td>
	<td class="num">${percent(c.score)}%</td>
	<td class="${c.pass ? "ok" : "bad"}">${c.pass ? "pass" : "fail"}</td>
	<td>${escapeHtml(c.reason)}</td>
	<td>${evidenceLinks(c.evidence, sources)}</td>
</tr>`;
	return `<table>
<caption class="eyebrow">Weighted score = Σ weight × score / Σ weight; a failed required criterion fails the run</caption>
<thead><tr>
	<th scope="col">Criterion</th><th scope="col">Type</th><th scope="col">Weight</th><th scope="col">Required</th>
	<th scope="col">Score</th><th scope="col">Result</th><th scope="col">Reason</th><th scope="col">Evidence</th>
</tr></thead>
<tbody>
${input.verdict.criteria.map(row).join("\n")}
</tbody>
</table>`;
}

function verdictSection(input: ReportInput, status: "PASSED" | "FAILED" | "ERROR"): string {
	const { run, verdict, resolved } = input;
	const parts: string[] = [];
	if (status === "ERROR") {
		parts.push(
			`<p class="err"><strong>Run error:</strong> ${escapeHtml(run.error ?? "unknown error")}</p>`,
		);
	}
	parts.push(`<p>${escapeHtml(verdict.summary)}</p>`);
	if (verdict.goal_assessment) {
		parts.push(`<h3>Goal assessment</h3><p>${escapeHtml(verdict.goal_assessment)}</p>`);
	}
	if (run.simulator_outcome) {
		parts.push(
			`<h3>Simulator outcome</h3><p><code>${escapeHtml(run.simulator_outcome.reason)}</code> — ${escapeHtml(run.simulator_outcome.summary)}</p>`,
		);
	}
	const s = resolved.scenario;
	const list = (items: string[]) =>
		items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
	parts.push(`<details>
	<summary>Scenario definition</summary>
	<dl class="meta">
		<dt>Goal</dt><dd>${escapeHtml(s.goal)}</dd>
		<dt>Intent</dt><dd>${escapeHtml(s.intent)}</dd>
		${s.context ? `<dt>Context</dt><dd>${escapeHtml(s.context)}</dd>` : ""}
		<dt>Success criteria</dt><dd>${escapeHtml(s.success_criteria)}</dd>
		<dt>Persona traits</dt><dd>${escapeHtml(resolved.persona.traits.join(", ") || "—")} (${escapeHtml(resolved.persona.language)})</dd>
		<dt>Target hints</dt><dd>${list(resolved.target.hints) || "—"}</dd>
	</dl>
</details>`);
	return parts.join("\n");
}

function transcriptSection(input: ReportInput, sources: ImageSources): string {
	const turns = new Map<number, TranscriptEntry[]>();
	for (const e of input.transcript) {
		const list = turns.get(e.turn) ?? [];
		list.push(e);
		turns.set(e.turn, list);
	}
	if (turns.size === 0) return '<p class="empty">No messages were exchanged.</p>';
	const message = (e: TranscriptEntry) => {
		const facts = [
			e.at,
			e.latency_ms !== undefined ? `${e.latency_ms} ms` : undefined,
			e.step ? `step ${e.step}` : undefined,
		]
			.filter(Boolean)
			.map((f) =>
				String(f).startsWith("step ")
					? `<a href="#step-${e.step}">${escapeHtml(f)}</a>`
					: escapeHtml(f),
			)
			.join(" · ");
		return `<div class="msg ${e.role}">
	<span class="role">${e.role === "bot" ? "Bot" : "User"}</span>
	<div><p>${escapeHtml(e.text)}</p><span class="when">${facts}</span></div>
</div>`;
	};
	const sections = [...turns.keys()]
		.sort((a, b) => a - b)
		.map((turn) => {
			const shots = input.steps
				.filter((s) => s.turn === turn && s.screenshot)
				.map((s) =>
					thumb(s.screenshot as string, `Step ${s.index} after: ${actionLabel(s)}`, sources),
				);
			return `<section class="turn" id="turn-${turn}">
	<h3>Turn ${turn}</h3>
	${(turns.get(turn) ?? []).map(message).join("\n")}
	${shots.length ? `<div class="shots">${shots.join("")}</div>` : ""}
</section>`;
		});
	return sections.join("\n");
}

function filmstripSection(input: ReportInput, sources: ImageSources): string {
	if (input.steps.length === 0) return '<p class="empty">No steps were recorded.</p>';
	const figure = (s: Step) => {
		const label = actionLabel(s);
		const frames: string[] = [];
		if (s.screenshot_before) {
			frames.push(
				thumb(s.screenshot_before, `Step ${s.index} before: ${label}`, sources, {
					id: anchorForScreenshot(s.screenshot_before),
					caption: "before",
				}),
			);
		}
		s.interim_screenshots.forEach((p, i) => {
			frames.push(
				thumb(p, `Step ${s.index} interim ${i + 1}: ${label}`, sources, {
					id: anchorForScreenshot(p),
					caption: `interim ${i + 1}`,
				}),
			);
		});
		if (s.screenshot) {
			frames.push(
				thumb(s.screenshot, `Step ${s.index} after: ${label}`, sources, {
					id: anchorForScreenshot(s.screenshot),
					caption: "after",
				}),
			);
		}
		const sub = [
			s.turn > 0 ? `turn ${s.turn}` : "setup",
			s.duration_ms !== undefined ? `${s.duration_ms} ms` : undefined,
		]
			.filter(Boolean)
			.join(" · ");
		const details: string[] = [];
		if (s.thought) details.push(`<div><strong>Thought:</strong> ${escapeHtml(s.thought)}</div>`);
		if (s.result)
			details.push(`<div><strong>Result:</strong> ${escapeHtml(truncate(s.result, 400))}</div>`);
		return `<li><figure id="step-${s.index}" class="${s.error ? "has-error" : ""}">
	<figcaption>
		<span class="label">#${s.index} ${escapeHtml(label)}</span>
		<span class="sub">${escapeHtml(sub)}</span>
		${s.error ? `<div class="err">${escapeHtml(s.error)}</div>` : ""}
	</figcaption>
	<div class="frames">${frames.join("") || '<span class="empty">no screenshot</span>'}</div>
	${details.length ? `<details><summary>Details</summary>${details.join("")}</details>` : ""}
</figure></li>`;
	};
	return `<ol class="filmstrip">${input.steps.map(figure).join("\n")}</ol>`;
}

function downloadsSection(downloads: DownloadArtifact[]): string {
	if (downloads.length === 0) return '<p class="empty">No files were downloaded.</p>';
	const card = (d: DownloadArtifact) => {
		const facts = [
			d.mime ?? "unknown type",
			formatBytes(d.bytes),
			d.step ? `<a href="#step-${d.step}">step ${d.step}</a>` : undefined,
			d.turn !== undefined ? `turn ${d.turn}` : undefined,
		]
			.filter(Boolean)
			.join(" · ");
		const excerpt = d.text_excerpt
			? `<details><summary>Extracted text</summary><pre>${escapeHtml(d.text_excerpt)}</pre></details>`
			: '<p class="empty">No text extracted.</p>';
		return `<li class="card">
	<a href="${escapeHtml(d.path)}" download>${escapeHtml(d.filename)}</a>
	<div class="facts">${facts}</div>
	${excerpt}
</li>`;
	};
	return `<ul class="cards">${downloads.map(card).join("\n")}</ul>`;
}

function consoleSection(entries: ConsoleEntry[]): string {
	const shown = entries.filter((e) => e.level === "error" || e.level === "warn");
	const hidden = entries.length - shown.length;
	if (shown.length === 0) {
		return `<p class="empty">No console errors or warnings.${hidden ? ` ${hidden} info/log entries not shown.` : ""}</p>`;
	}
	const row = (e: ConsoleEntry) => `<tr>
	<td class="${e.level === "error" ? "bad" : ""}">${e.level}</td>
	<td class="mono">${escapeHtml(e.at)}</td>
	<td>${e.step ? `<a href="#step-${e.step}">${e.step}</a>` : "—"}</td>
	<td><pre>${escapeHtml(e.text)}</pre></td>
</tr>`;
	return `<table>
<thead><tr><th scope="col">Level</th><th scope="col">At</th><th scope="col">Step</th><th scope="col">Message</th></tr></thead>
<tbody>${shown.map(row).join("\n")}</tbody>
</table>
${hidden ? `<p class="empty">${hidden} info/log entries not shown.</p>` : ""}`;
}

function rawJsonSection(input: ReportInput): string {
	const json = JSON.stringify(
		{
			run: input.run,
			verdict: input.verdict,
			steps: input.steps,
			transcript: input.transcript,
			downloads: input.downloads,
			console: input.console,
		},
		null,
		2,
	);
	return `<details class="raw">
	<summary>Raw JSON (run, verdict, steps, transcript, downloads, console)</summary>
	<pre>${escapeHtml(json)}</pre>
</details>`;
}

/**
 * Renders the self-contained HTML report. Screenshots are referenced by their run-relative paths
 * unless `inlineImages` is set, in which case `imageLoader` provides the bytes for `data:` URIs.
 */
export async function renderHtml(
	input: ReportInput,
	options: RenderHtmlOptions = {},
): Promise<string> {
	const status = overallStatus(input);
	const sources = await resolveImageSources(input, options);
	const pct = percent(input.verdict.score);
	const title = `${input.run.scenario} — ${status} ${pct}%`;
	const section = (id: string, heading: string, body: string) =>
		`<section class="block" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${heading}</h2>
${body}
</section>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
${header(input, status)}
<nav class="toc" aria-label="Sections">
	<a href="#verdict">Verdict</a>
	<a href="#criteria">Criteria</a>
	<a href="#transcript">Transcript</a>
	<a href="#filmstrip">Filmstrip</a>
	<a href="#downloads">Downloads</a>
	<a href="#console">Console</a>
	<a href="#raw">Raw JSON</a>
	<span class="tools"><button type="button" data-toggle="open">Expand all</button><button type="button" data-toggle="close">Collapse all</button></span>
</nav>
<main id="main">
${section("verdict", "Verdict", verdictSection(input, status))}
${section("criteria", "Criteria", criteriaTable(input, sources))}
${section("transcript", "Transcript", transcriptSection(input, sources))}
${section("filmstrip", "Filmstrip", filmstripSection(input, sources))}
${section("downloads", "Downloads", downloadsSection(input.downloads))}
${section("console", "Console", consoleSection(input.console))}
${section("raw", "Raw data", rawJsonSection(input))}
</main>
<footer>Judged at ${escapeHtml(input.verdict.judged_at)} by <code>${escapeHtml(input.verdict.judge_model)}</code> · generated by agent-evaluator</footer>
</div>
<dialog id="lightbox" aria-label="Enlarged screenshot"><button type="button">Close</button><img src="" alt="Enlarged screenshot"></dialog>
<script>${JS}</script>
</body>
</html>
`;
}
