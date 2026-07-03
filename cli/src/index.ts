#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("syzy-shield")
  .description(
    "Generate Groth16 shield proofs and submit them to the Syzy shielded pool (Stellar testnet)."
  )
  .version("0.1.0");

// Commands are wired up in later tasks (prove, shield, reserves, ...).

program.parse(process.argv);
