import { Command } from "https://deno.land/x/cliffy/command.ts";

import { session } from "./sessions.ts";

// Command
let central = new Command()
  .description("An ever watching guardian of your productivity")
  .command("session", session);

if (import.meta.main) {
  await central.parse(Deno.args);
}
