import { createRoot } from "react-dom/client";
import AppWrapper from "./AppWrapper.tsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
		<BrowserRouter>
		<AppWrapper />
	</BrowserRouter>
);
