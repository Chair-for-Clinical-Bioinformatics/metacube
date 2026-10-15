import { createRoot } from "react-dom/client";
import App from "./App";
import FigureMode from "./FigureMode";
import { loadData } from "./data/loadData";
import { ThemeProvider } from "./data/themeContext";
import { DEFAULT_SCHEME } from "./data/theme";
import { readViewParams } from "./viewParams";

const figureId = new URLSearchParams(window.location.search).get("figure");
const data = loadData();
const view = readViewParams();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider scheme={data.config.colour_scheme ?? DEFAULT_SCHEME} forcedMode={view.theme}>
    {figureId ? <FigureMode figureId={figureId} data={data} view={view} /> : <App data={data} view={view} />}
  </ThemeProvider>,
);
