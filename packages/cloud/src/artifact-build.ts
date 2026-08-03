import { transform } from "sucrase";

import { ARTIFACT_MERMAID_HEAD, usesMermaid } from "./artifact-mermaid";
import { ARTIFACT_THEME_HEAD } from "./artifact-theme";

/**
 * Curated CDN globals available to generated artifact components. The component
 * runs inside a sandboxed iframe with no network access to our APIs, so these
 * UMD bundles are the entire surface area a "fixed" artifact can use.
 */
const CDN = {
  react: "https://unpkg.com/react@18/umd/react.production.min.js",
  reactDom: "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  // recharts' UMD externalizes prop-types, so it must load first.
  propTypes: "https://unpkg.com/prop-types@15/prop-types.min.js",
  // recharts 2.15.x ships Recharts.js (no minified UMD at this path).
  recharts: "https://unpkg.com/recharts@2/umd/Recharts.js",
  lucide: "https://unpkg.com/lucide-react@0.469.0/dist/umd/lucide-react.js",
  clsx: "https://unpkg.com/clsx@2/dist/clsx.min.js",
  tailwind: "https://cdn.tailwindcss.com",
};

/**
 * Transpile a default-exported React TSX component and wrap it in a single
 * self-contained HTML document. Throws if the TSX fails to parse.
 *
 * With `theme: "app"` (the default) the shell injects the Nimbase design
 * tokens so the component can use Tailwind token classes (bg-primary,
 * bg-card, text-foreground, …) and chart colors (var(--chart-1) …). With
 * `theme: "custom"` only the plain Tailwind CDN is loaded.
 */
export function buildArtifactHtml(
  tsx: string,
  opts: { theme?: "app" | "custom" } = {},
): string {
  const useAppTheme = opts.theme !== "custom";
  // Diagrams are opt-in per artifact: mermaid is multiple megabytes, so it is
  // loaded only by the artifactes that draw one.
  const withMermaid = usesMermaid(tsx);
  // imports → CJS so `export default` becomes `exports.default`, and bare
  // import statements become require() calls our shim resolves below.
  const { code } = transform(tsx, {
    transforms: ["typescript", "jsx", "imports"],
    production: true,
    jsxRuntime: "classic",
  });
  // Prevent a literal </script> in the transpiled source from closing our
  // inline <script> tag early. The backslash is a no-op inside a JS string.
  const safeCode = code.replace(/<\/script>/gi, "<\\/script>");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="${CDN.tailwind}"></script>${useAppTheme ? `\n${ARTIFACT_THEME_HEAD}` : ""}
<script crossorigin src="${CDN.react}"></script>
<script crossorigin src="${CDN.reactDom}"></script>
<script crossorigin src="${CDN.propTypes}"></script>
<!-- lucide-react's UMD reads its React dep from the lowercase global.react,
     but React's UMD only defines window.React — bridge it before lucide loads. -->
<script>window.react = window.React;</script>
<script crossorigin src="${CDN.clsx}"></script>
<script crossorigin src="${CDN.recharts}"></script>
<script crossorigin src="${CDN.lucide}"></script>${withMermaid ? `\n${ARTIFACT_MERMAID_HEAD}` : ""}
</head>
<body class="${useAppTheme ? "bg-background text-foreground font-sans" : "bg-white text-zinc-900"}">
<div id="root"></div>
<script>
(function () {
  var clsxFn = window.clsx || function () { return ""; };
  var modules = {
    "react": window.React,
    "react-dom": window.ReactDOM,
    "react-dom/client": window.ReactDOM,
    "recharts": window.Recharts || {},
    "lucide-react": window.LucideReact || {},
    "clsx": clsxFn,
    "@acme/ui": { cn: function () { return clsxFn.apply(null, arguments); } }
  };
  function require(name) {
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    throw new Error("Module not available in artifact sandbox: " + name);
  }
  var React = window.React;
  function showError(err) {
    document.getElementById("root").innerHTML =
      '<pre style="padding:16px;color:#b91c1c;white-space:pre-wrap">' +
      String(err && err.message ? err.message : err) + '</pre>';
  }
  // React 18's createRoot().render() throws render errors asynchronously, so
  // the synchronous try/catch below cannot see them — an ErrorBoundary does.
  function ErrorBoundary(props) {
    React.Component.call(this, props);
    this.state = { error: null };
  }
  ErrorBoundary.prototype = Object.create(React.Component.prototype);
  ErrorBoundary.getDerivedStateFromError = function (error) {
    return { error: error };
  };
  ErrorBoundary.prototype.render = function () {
    var err = this.state.error;
    if (!err) return this.props.children;
    return React.createElement(
      "pre",
      { style: { padding: "16px", color: "#b91c1c", whiteSpace: "pre-wrap" } },
      String(err && err.message ? err.message : err)
    );
  };
  var module = { exports: {} };
  var exports = module.exports;
  try {
${indent(safeCode, 4)}
    var Component = ("default" in module.exports) ? module.exports.default : module.exports;
    var root = window.ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(ErrorBoundary, null, React.createElement(Component)));
  } catch (err) {
    showError(err);
  }
})();
</script>
</body>
</html>`;
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}
