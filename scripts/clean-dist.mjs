import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const relative = process.argv[2];
if (
  !relative ||
  relative.includes("..") ||
  relative.startsWith("/") ||
  /^[A-Za-z]:/u.test(relative)
) {
  throw new Error("Expected a repository-relative workspace path");
}
const repositoryRoot = resolve(import.meta.dirname, "..");
const target = resolve(repositoryRoot, relative, "dist");
if (!target.startsWith(`${repositoryRoot}\\`) && !target.startsWith(`${repositoryRoot}/`)) {
  throw new Error("Refusing to clean outside the repository");
}
await rm(target, { recursive: true, force: true });
