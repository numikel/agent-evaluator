/**
 * Entry point of `npm run demo`: starts the demo chatbot on `DEMO_PORT` (default 3999). Kept apart
 * from `server.ts` so that bundling the server into the CLI never starts it as a side effect.
 */
import { DEFAULT_DEMO_PORT, startDemo } from "./server.js";

const port = Number(process.env.DEMO_PORT ?? DEFAULT_DEMO_PORT);
const demo = await startDemo(port);
console.log(
	`Demo chatbot listening on ${demo.url} (modes: ?mode=normal|slow|offtopic|broken|noattach)`,
);
