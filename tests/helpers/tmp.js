import os from "node:os";import path from "node:path";import fs from "node:fs";
// A fresh temporary folder per test file (local SQLite files).
export function tmpDir(){return fs.mkdtempSync(path.join(os.tmpdir(),"stayloud-test-"))}
