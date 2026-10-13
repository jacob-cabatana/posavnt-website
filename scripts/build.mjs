import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const outputDirectory = resolve(projectRoot, "dist");

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

for (const entry of [
  "index.html",
  "styles.css",
  "script.js",
  "client-login.html",
  "create-account.html",
  "setup-payouts.html",
  "firebase.js",
  "login.js",
  "create-account.js",
  "setup-payouts.js",
  "privacy.html",
  "terms.html",
  "legal.css",
  "assets",
  "dashboard",
]) {
  cpSync(resolve(projectRoot, entry), resolve(outputDirectory, entry), {
    recursive: true,
  });
}
