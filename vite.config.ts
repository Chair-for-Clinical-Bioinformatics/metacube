import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

const singleFile = !!process.env.SF_BUILD;
const matomoSiteId = process.env.MATOMO_SITE_ID;

// add mamoto only to github pages, not python/R packages
function matomo(): Plugin {
  return {
    name: "matomo-tracking",
    transformIndexHtml() {
      if (!matomoSiteId) return [];
      return [
        {
          tag: "script",
          injectTo: "head",
          children: `
  var _paq = window._paq = window._paq || [];
  _paq.push(['disableCookies']);
  _paq.push(['trackPageView']);
  _paq.push(['enableLinkTracking']);
  (function() {
    var u = "https://web.ccb.uni-saarland.de/matomo/";
    _paq.push(['setTrackerUrl', u + 'matomo.php']);
    _paq.push(['setSiteId', '${matomoSiteId}']);
    var d = document, g = d.createElement('script'), s = d.getElementsByTagName('script')[0];
    g.async = true; g.src = u + 'matomo.js'; s.parentNode.insertBefore(g, s);
  })();`,
        },
      ];
    },
  };
}

// The root index.html is the local dev page (with injected example data) and the
// source of the single-file package template; it is not deployed. The deployed site is the
// playground, and the site root only redirects there.
function rootRedirect(): Plugin {
  return {
    name: "root-redirect",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "index.html",
        source: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>MetaCube</title>
    <meta http-equiv="refresh" content="0; url=playground/" />
    <link rel="canonical" href="playground/" />
  </head>
  <body>
    <a href="playground/">MetaCube playground</a>
  </body>
</html>
`,
      });
    },
  };
}

// The single-file package template must ship without data: the packages and the playground
// download inject the user's data before <div id="root">. Strip the dev data that sits in
// the root index.html so it is not carried along in every exported file.
function stripDevData(): Plugin {
  return {
    name: "strip-dev-data",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/<script>\s*window\.__CUBE_DATA__ = [\s\S]*?<\/script>\s*/, "");
    },
  };
}

export default defineConfig({
  base: singleFile ? "./" : "/metacube/",
  plugins: singleFile ? [react(), stripDevData(), viteSingleFile()] : [react(), matomo(), rootRedirect()],
  publicDir: singleFile ? false : "public",
  build: singleFile
    ? { emptyOutDir: false }
    : {
        rollupOptions: {
          input: {
            playground: resolve(__dirname, "playground/index.html"),
          },
        },
      },
});