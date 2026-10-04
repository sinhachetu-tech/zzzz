// Node ESM resolver hook: the project uses bundler-style extensionless imports
// ("./format"), which node cannot resolve on its own. This appends .ts so the REAL
// src/lib/domain.ts can be imported directly under --experimental-strip-types — no
// compile step, no path-alias rewriting, and no copy of the logic under test.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(new URL("./ts-resolve.mjs", import.meta.url).pathname.slice(1)));

// Registering the resolver is not enough — without this import the process exits
// immediately having asserted nothing, which is exactly the "0-byte file that looks
// like a pass" trap this whole harness exists to avoid.
await import("./phasef-scope.ts");