// Resolve extensionless relative specifiers to .ts so node can load the project's
// own TypeScript sources under --experimental-strip-types.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("file:")) {
      throw err;
    }
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, format: "module-typescript", shortCircuit: true };
        }
      } catch {
        // try the next extension
      }
    }
    throw err;
  }
}