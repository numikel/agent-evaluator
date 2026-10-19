import "./theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createAppRouter } from "./app/routes.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
	<StrictMode>
		<RouterProvider router={createAppRouter()} />
	</StrictMode>,
);
