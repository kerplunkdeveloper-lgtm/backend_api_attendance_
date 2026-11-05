// Runs bcrypt comparisons off the main thread. See passwordVerifier.js.
const { parentPort } = require("node:worker_threads");
const bcrypt = require("bcryptjs");

// compareSync on purpose: bcryptjs's async compare yields to the event loop
// between rounds and measured ~2.5x slower. Blocking is harmless here because
// this thread does nothing else.
parentPort.on("message", ({ id, password, hash }) => {
  try {
    parentPort.postMessage({ id, ok: bcrypt.compareSync(password, hash) });
  } catch (error) {
    parentPort.postMessage({ id, error: error?.message || "compare failed" });
  }
});
