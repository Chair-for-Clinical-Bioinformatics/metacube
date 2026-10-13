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

export default defineConfig({
  base: singleFile ? "./" : "/metacube/",
  plugins: singleFile ? [react(), viteSingleFile()] : [react(), matomo()],
  publicDir: singleFile ? false : "public",
  build: singleFile
    ? { emptyOutDir: false }
    : {
        rollupOptions: {
          input: {
            main:       resolve(__dirname, "index.html"),
            playground: resolve(__dirname, "playground/index.html"),
          },
        },
      },
});