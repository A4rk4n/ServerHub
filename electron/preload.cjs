/**
 * Server Hub preload.
 *
 * Exposes a tiny, explicit bridge to the renderer. The panel itself talks to its
 * own local REST API over 127.0.0.1, so no privileged Node APIs are needed in the
 * UI — this is just for desktop niceties.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("serverHub", {
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
