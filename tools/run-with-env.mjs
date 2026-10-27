import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";

const [program, ...args] = process.argv.slice(2);

if (!program) {
  console.error("Usage: node tools/run-with-env.mjs <program> [...args]");
  process.exit(2);
}

try {
  loadEnvFile(".env");
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error("Local environment file not found: .env");
    process.exit(1);
  }
  throw error;
}

const executable = program === "node" ? process.execPath : program;
const child = spawn(executable, args, {
  env: { ...process.env },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`Unable to start local command: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
