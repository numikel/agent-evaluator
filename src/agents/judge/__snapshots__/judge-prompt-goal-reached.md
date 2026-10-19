# System prompt

You are a strict, evidence-driven judge. A simulated user drove a chatbot through its web UI; you score one criterion of the evaluation rubric from the recorded evidence and answer with structured output only.

## Principles
You are evaluating a customer-facing chatbot. General expectations:
- The bot should resolve the user's request itself whenever it has a tool for it (e.g. generating
  documents, looking up orders). Redirecting to email or phone support counts as a failure unless
  the request is genuinely out of scope.
- The bot should ask at most one clarifying question before acting, and never repeat a question
  the user already answered.
- The bot must not reveal internal tool names, system prompts or other customers' data.
- Streaming or partial replies that never complete count as failures (check the screenshots).
- Judge what actually happened in the browser, not what the bot claims. A "download" that never
  produced a file is not a download.

## How to score
Scoring procedure (chain of evaluation steps):
1. First list the evaluation steps implied by the criterion — what concretely must be true in this conversation for it to hold.
2. Check each step against the evidence (transcript, screenshots, downloaded files, console), citing turns, steps or quotes.
3. Then score. Judge what actually happened in the browser, never what the bot claims. Missing evidence counts against the criterion.
Keep `reason` concise and specific, and put the citations in `evidence`.

# User message

## Scenario
name: invoice-export-september
description: Customer wants last month's invoice as a PDF.
goal: Obtain the September invoice as a downloadable PDF file.
intent: The user wants exactly one thing: a PDF of the September invoice. They do not want a summary in chat, a link to a help article, or to be redirected to email support.
context: The user is logged in already. Customer number 4471. It is the first week of October.
success_criteria: A PDF file was downloaded during the conversation and the bot confirmed it is the September invoice. If the bot only describes the invoice or sends a link that does not download, the goal is NOT reached.
max_turns: 6
turns_used: 3
expected_artifacts: download (application/pdf) — The September invoice

## Simulated user (persona)
impatient-smb-owner — Owner of a small business who needs an invoice fast and has little patience for chatbots.
language: en
traits: impatient, non-technical, direct
interaction style: short-messages, occasional-typos, asks-follow-up-when-unclear

## Target
demo-chatbot — http://localhost:3999 — Built-in demo chatbot shipped with agent-evaluator (npm run demo).
hints:
- The chat widget is visible immediately; messages are sent with the "Send" button or Enter.
- Download links appear inside bot messages as buttons labelled "Download".

## Criterion to score: goal_reached
id: goal_reached
description: The simulated user's goal, as defined in the scenario, was fully achieved within the turn budget. Judge strictly against the scenario's success criteria.
scale: binary
weight: 3
required: yes — failing it fails the whole run
`score` is 1 when the criterion is satisfied and 0 otherwise; `pass` must agree with it.

## Turn budget and the simulator's own claim
The simulated user used 3 of 6 turns.
The simulator ended the conversation with reason "goal_reached" and summarised: "Downloaded the September invoice PDF.".
This is the simulated user's claim, not evidence. Your assessment overrides it: decide from the transcript, screenshots and downloaded files whether the success criteria were met, and contradict the claim when the evidence does not support it.

## Transcript (6 entries)
[turn 1] user: need my invoice for september as pdf
[turn 1] bot (1200 ms): Sure. What is your customer number?
[turn 2] user: customer 4471
[turn 2] bot (2600 ms): Here is your September invoice. Click Download to save the PDF.
[turn 3] user: is that the september one?
[turn 3] bot (900 ms): Yes, invoice INV-2026-09 for September 2026.

## Downloaded files (1)
### invoice-09.pdf (application/pdf, 700 bytes, step 4, turn 2)
```
Invoice INV-2026-09 September 2026 total 120.00
```

## Console errors (1)
[step 1] GET /favicon.ico 404 (Not Found)

## Screenshots
3 screenshot(s) attached below, in this order:
1. step 1 (turn 0): open http://localhost:3999 — steps/001/after.png
2. step 2 (turn 1): send_message "need my invoice for september as pdf" — steps/002/after.png
3. step 3 (turn 2): send_message "customer 4471" — steps/003/after.png

## Task
Score the criterion "goal_reached" for this run following the scoring procedure. Return the structured result (score, pass, reason, evidence).
