/** msw node server for the Vitest `ui` project; wired in `test-setup.ts`. */
import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

export const server = setupServer(...handlers);
