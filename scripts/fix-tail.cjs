const fs = require("fs");
let p = "src/components/views/admin/rate-cards.tsx";
let s = fs.readFileSync(p, "utf8");
const tail = "    } finally {\n      setBusy(false);\n    }\n  };\n\n/**\n * Close or reopen a slot.";
if (!s.includes(tail)) throw new Error("tail moved");
const jsx = [
  "    } finally {",
  "      setBusy(false);",
  "    }",
  "  };",
  "  const chipOn = { cursor: \"pointer\", borderColor: \"var(--mint)\", color: \"var(--ink)\" } as const;",
  "  const chipOff = { cursor: \"pointer\", color: \"var(--ink-faint)\" } as const;",
  "  return (",
  "    <div>AXESFORM</div>",
  "  );",
  "}",
].join("\n");
s = s.replace(tail, jsx + "\n\n/**\n * Close or reopen a slot.");
fs.writeFileSync(p, s);
console.log("CLOSED2");
