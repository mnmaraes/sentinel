import { v4 } from "https://deno.land/std/uuid/mod.ts";
import { ensureFile, writeJson } from "https://deno.land/std@0.63.0/fs/mod.ts";
import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";

import { Input, Select } from "https://deno.land/x/cliffy/prompt.ts";

import { Command } from "https://deno.land/x/cliffy/command.ts";

import {
  loadSessionIndex,
  SESSION_INDEX_PATH,
  getProject,
  setStore,
  getOngoingSession,
  getSessionPath,
  Session,
  formatDuration,
  getProjectTasks,
} from "./utils.ts";

const setOngoingSession = async (session: Session): Promise<void> => {
  return setStore({
    ongoingSession: session.id,
  });
};

const clearOngoingSession = async (): Promise<void> => {
  return setStore({
    ongoingSession: undefined,
  });
};

const addToIndex = async (session: Session): Promise<void> => {
  const index = await loadSessionIndex();

  index.byProject[session.projectName] = [
    ...(index.byProject[session.projectName] ?? []),
    session.id,
  ];

  let formattedStartDate = new Date(session.sessionStart).toDateString();
  index.byDate[formattedStartDate] = [
    ...(index.byDate[formattedStartDate] ?? []),
    session.id,
  ];

  index.ordered = [...index.ordered, session.id];

  await writeJson(SESSION_INDEX_PATH, index, { spaces: 2 });
};

const saveSession = async (session: Session): Promise<void> => {
  await addToIndex(session);

  const sessionPath = getSessionPath(session.id);

  await ensureFile(sessionPath);
  await writeJson(sessionPath, session, { spaces: 2 });
  await setOngoingSession(session);
};

const endSession = async (session: Session): Promise<Session> => {
  session.sessionEnd = Date.now();

  await writeJson(getSessionPath(session.id), session, {
    spaces: 2,
  });
  await clearOngoingSession();

  return session;
};

const createSession = async (
  runHook: boolean,
  projectName?: string
): Promise<Session> => {
  const project = await getProject(projectName);
  const tasks = await getProjectTasks(project.name);
  let focus = await Select.prompt({
    message: "Select a task to focus on",
    options: [
      ...tasks.map(({ description }) => description),
      "Create a new task",
    ],
  });

  if (focus === "Create a new task")
    focus = await Input.prompt("What will be the focus of this session?");

  const session = {
    id: v4.generate(),
    projectName: project.name,
    focus,
    sessionStart: Date.now(),
  };

  await saveSession(session);

  if (project.onStart && runHook) {
    await exec(project.onStart, { output: OutputMode.None });
  }

  return session;
};

// Sub-Commands
const sessionStart = new Command()
  .version("0.0.1")
  .description("Start a working session")
  .option(
    "-l, --hookless [hookless:boolean]",
    "Start a session without running the project `onStart` hook"
  )
  .option(
    "-p, --project [project:string]",
    "The name of the project to work on"
  )
  .action(
    async ({
      project: projectName,
      hookless,
    }: {
      project?: string;
      hookless: boolean;
    }) => {
      const session = await getOngoingSession();
      if (session != null) {
        console.log("There is an ongoing session. Did you forget to end it?");
        return;
      }

      await createSession(!hookless, projectName);
      console.log("Session Started! Get to work!");
    }
  );

const sessionEnd = new Command()
  .version("0.0.1")
  .description("End a working session")
  .action(async () => {
    let session = await getOngoingSession();
    if (session == null) {
      console.log("There is no ongoing session. Did you forget to start it?");
      return;
    }

    session = await endSession(session);
    console.log(
      `Good job! Your session has been logged.\nFocus: ${
        session.focus
      }\nDuration: ${formatDuration(
        (session.sessionEnd ?? Date.now()) - session.sessionStart
      )}`
    );
  });

const sessionRecap = new Command()
  .version("0.0.1")
  .description("Shows stats for current working session")
  .action(async () => {
    const session = await getOngoingSession();
    if (session == null) {
      console.log("There is no ongoing session. Did you forget to start it?");
      return;
    }

    console.log(
      `Current Session\nFocus: ${session.focus}\nDuration: ${formatDuration(
        (session.sessionEnd ?? Date.now()) - session.sessionStart
      )}`
    );
  });

// Main Command
export const session = new Command()
  .version("0.0.1")
  .description("Sentinel Session Management")
  .command("start", sessionStart)
  .command("end", sessionEnd)
  .command("recap", sessionRecap);
