import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const token = process.env.JLT_GITHUB_RELEASE_TOKEN;

if (!token) {
  throw new Error("JLT_GITHUB_RELEASE_TOKEN is not configured as a project secret.");
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options,
  }).trim();
}

const branch = runGit(["branch", "--show-current"]);
if (branch !== "main") {
  throw new Error(`Refusing to publish from '${branch}'. Releases must be made from main.`);
}

const remote = runGit(["remote", "get-url", "github-live"]);
if (remote !== "https://github.com/tbrett99/jlt-booking-portal.git") {
  throw new Error("The github-live remote does not point to tbrett99/jlt-booking-portal.");
}

const basicAuth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
const authenticatedGitEnvironment = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
};

execFileSync("git", ["push", "github-live", "main"], {
  cwd: repositoryRoot,
  env: authenticatedGitEnvironment,
  stdio: "inherit",
});

const localHead = runGit(["rev-parse", "HEAD"]);
const remoteHead = execFileSync("git", ["ls-remote", "github-live", "refs/heads/main"], {
  cwd: repositoryRoot,
  env: authenticatedGitEnvironment,
  encoding: "utf8",
}).trim().split(/\s+/)[0];

if (remoteHead !== localHead) {
  throw new Error("GitHub main does not match the local release commit after publishing.");
}

console.log(`Published main at ${localHead}`);
