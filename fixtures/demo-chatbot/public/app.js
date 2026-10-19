// Vanilla-JS chat client for the demo chatbot. No framework, no build step.
// Replies stream over SSE (fetch + ReadableStream, because EventSource cannot POST).
(() => {
	const MODES = ["normal", "slow", "offtopic", "broken", "noattach"];
	const params = new URLSearchParams(window.location.search);
	const requested = params.get("mode");
	const mode = MODES.includes(requested) ? requested : "normal";

	const log = document.querySelector("#messages");
	const status = document.querySelector("#status");
	const form = document.querySelector("#composer");
	const input = document.querySelector("#input");
	const sendButton = document.querySelector("#send");
	const attach = document.querySelector("#attach");
	const modeBadge = document.querySelector("#mode-badge");

	/** @type {{ role: "user" | "bot", text: string }[]} */
	const history = [];
	let busy = false;
	let controller = null;

	if (mode !== "normal") {
		modeBadge.textContent = `mode: ${mode}`;
		modeBadge.hidden = false;
	}

	function escapeHtml(text) {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	/** Markdown-lite: **bold**, [text](url), bare URLs and line breaks. */
	function renderMarkdownLite(text) {
		let html = escapeHtml(text);
		html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		html = html.replace(
			/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
			'<a href="$2" target="_blank" rel="noopener">$1</a>',
		);
		html = html.replace(
			/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
			'$1<a href="$2" target="_blank" rel="noopener">$2</a>',
		);
		return html.replace(/\n/g, "<br />");
	}

	function scrollToBottom() {
		log.scrollTop = log.scrollHeight;
	}

	function addMessage(role, text) {
		const article = document.createElement("article");
		article.className = `msg msg-${role}`;
		article.dataset.role = role;
		const author = document.createElement("span");
		author.className = "author";
		author.textContent = role === "user" ? "You" : "Assistant";
		const body = document.createElement("div");
		body.className = "body";
		if (role === "user") body.textContent = text;
		else body.innerHTML = renderMarkdownLite(text);
		article.append(author, body);
		log.append(article);
		scrollToBottom();
		return { article, body };
	}

	function triggerDownload(attachment) {
		const link = document.createElement("a");
		link.href = attachment.url;
		link.download = attachment.name;
		link.rel = "noopener";
		document.body.append(link);
		link.click();
		link.remove();
	}

	function addAttachment(article, attachment) {
		const box = document.createElement("div");
		box.className = "attachment";
		const name = document.createElement("span");
		name.className = "file-name";
		name.textContent = attachment.name;
		const button = document.createElement("button");
		button.type = "button";
		button.className = "download";
		button.dataset.url = attachment.url;
		button.textContent = "Download";
		button.addEventListener("click", () => triggerDownload(attachment));
		box.append(name, button);
		article.append(box);
		scrollToBottom();
	}

	function setBusy(flag) {
		busy = flag;
		sendButton.disabled = flag;
		status.textContent = flag ? "Assistant is typing…" : "";
	}

	function parseSseBlock(block) {
		let event = "message";
		const data = [];
		for (const line of block.split("\n")) {
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).trim());
		}
		return { event, data: data.join("\n") };
	}

	async function requestReply() {
		if (controller) controller.abort();
		controller = new AbortController();
		const { signal } = controller;
		setBusy(true);
		const { article, body } = addMessage("bot", "");
		article.setAttribute("aria-busy", "true");
		let text = "";
		let finished = false;

		const handle = ({ event, data }) => {
			if (event === "token") {
				text += JSON.parse(data).text;
				body.textContent = text;
				scrollToBottom();
			} else if (event === "done") {
				const payload = JSON.parse(data);
				text = payload.text;
				body.innerHTML = renderMarkdownLite(text);
				if (payload.attachment) addAttachment(article, payload.attachment);
				finished = true;
			} else if (event === "error") {
				const payload = JSON.parse(data);
				console.error(`Demo chatbot stream error: ${payload.message}`);
				article.classList.add("msg-error");
				// Let the user keep typing; the stream itself stays open on purpose (broken mode).
				setBusy(false);
			}
		};

		try {
			const response = await fetch(`/api/chat?mode=${encodeURIComponent(mode)}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ messages: history, mode }),
				signal,
			});
			if (!response.ok || !response.body) {
				throw new Error(`chat request failed with status ${response.status}`);
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let chunk = await reader.read();
			while (!chunk.done) {
				buffer += decoder.decode(chunk.value, { stream: true });
				let separator = buffer.indexOf("\n\n");
				while (separator >= 0) {
					const block = buffer.slice(0, separator);
					buffer = buffer.slice(separator + 2);
					if (block.trim() && !block.startsWith(":")) handle(parseSseBlock(block));
					separator = buffer.indexOf("\n\n");
				}
				chunk = await reader.read();
			}
			if (!finished) throw new Error("the reply stream ended before completion");
		} catch (error) {
			if (signal.aborted) return;
			console.error("Demo chatbot request failed:", error);
			article.classList.add("msg-error");
			if (!text) body.textContent = "Sorry, something went wrong. Please try again.";
		} finally {
			article.removeAttribute("aria-busy");
			if (!signal.aborted) {
				history.push({ role: "bot", text });
				if (finished) setBusy(false);
			}
		}
	}

	function sendMessage() {
		const text = input.value.trim();
		if (!text || busy) return;
		history.push({ role: "user", text });
		addMessage("user", text);
		input.value = "";
		requestReply();
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		sendMessage();
	});

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			sendMessage();
		}
	});

	attach.addEventListener("change", async () => {
		const file = attach.files?.[0];
		if (!file || busy) return;
		const text = `Attached file: ${file.name}`;
		history.push({ role: "user", text });
		addMessage("user", text);
		setBusy(true);
		try {
			const data = new FormData();
			data.append("file", file);
			const response = await fetch("/api/upload", { method: "POST", body: data });
			if (!response.ok) throw new Error(`upload failed with status ${response.status}`);
			const payload = await response.json();
			history.push({ role: "bot", text: payload.message });
			addMessage("bot", payload.message);
		} catch (error) {
			console.error("Demo chatbot upload failed:", error);
			addMessage("bot", "Sorry, I could not receive that file.");
		} finally {
			attach.value = "";
			setBusy(false);
		}
	});

	// Opening greeting.
	requestReply();
	input.focus();
})();
