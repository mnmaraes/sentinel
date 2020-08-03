import { Command } from "https://deno.land/x/cliffy/command.ts";

import { session } from "./sessions.ts";
import { tasks } from "./tasks.ts";
import { review } from "./review.ts";

// Command
let central = new Command()
  .description("An ever watching guardian of your productivity")
  .command("session", session)
  .command("task", tasks)
  .command("review", review);

if (import.meta.main) {
  await central.parse(Deno.args);
}
