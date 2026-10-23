#!/usr/bin/env node

import { main } from "../src/cli.js";

main(process.argv.slice(2)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error(`Unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  },
);
