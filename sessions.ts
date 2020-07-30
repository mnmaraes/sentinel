import { v4 } from "https://deno.land/std/uuid/mod.ts";
import {
  ensureFile,
  readJson,
  writeJson,
} from "https://deno.land/std@master/fs/mod.ts";

import { Input } from "https://deno.land/x/cliffy/prompt.ts";

import { Command } from "https://deno.land/x/cliffy/command.ts";

import {
  SENTINEL_PATH,
  loadWithDefault,
  loadStore,
  getProject,
  updateStore,
} from "./utils.ts";

const SESSIONS_PATH = SENTINEL_PATH + "/sessions";

type SessionIndex = {
  byProject: { [name: string]: string[] };
  byDate: { [date: string]: string[] };
  ordered: string[];
};

const SESSION_INDEX_PATH = SESSIONS_PATH + "/index.json";
const INITIAL_INDEX: SessionIndex = {
  byProject: {},
  byDate: {},
  ordered: [],
};

const loadSessionIndex = async (): Promise<SessionIndex> => {
  return loadWithDefault(SESSION_INDEX_PATH, INITIAL_INDEX);
};

const getSessionPath = (sessionId: string): string => {
  return `${SESSIONS_PATH}/${sessionId}.json`;
};

type Session = {
  id: string;
  projectName: string;
  focus: string;
  sessionStart: number;
  sessionEnd?: number;
};
const getOngoingSession = async (): Promise<Session | null> => {
  const sessionId = (await loadStore()).ongoingSession;
  if (sessionId == null) {
    return null;
  }

  return (await readJson(getSessionPath(sessionId))) as Session;
};

const setOngoingSession = async (session: Session): Promise<void> => {
  return updateStore({
    ongoingSession: session.id,
  });
};

const clearOngoingSession = async (): Promise<void> => {
  return updateStore({
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

const SECOND_MULTIPLIER = 1000;
const MINUTE_MULTIPLIER = 60 * SECOND_MULTIPLIER;
const HOUR_MULTIPLIER = 60 * MINUTE_MULTIPLIER;

const formatSessionDuration = (session: Session): string => {
  let duration = (session.sessionEnd ?? Date.now()) - session.sessionStart;

  return `${Math.floor(duration / HOUR_MULTIPLIER)}h ${Math.floor(
    (duration % HOUR_MULTIPLIER) / MINUTE_MULTIPLIER
  )}m ${Math.floor((duration % MINUTE_MULTIPLIER) / SECOND_MULTIPLIER)}s`;
};

const createSession = async (projectName?: string): Promise<Session> => {
  const project = await getProject(projectName);
  // TODO: Can list the project's tasks
  const focus: string = await Input.prompt(
    "What will be the focus of this session?"
  );

  const session = {
    id: v4.generate(),
    projectName: project.name,
    focus,
    sessionStart: Date.now(),
  };

  await saveSession(session);

  return session;
};

type SessionOptions = { project?: string };
const sessionStart = new Command()
  .version("0.0.1")
  .description("Start a working session")
  .option(
    "-p, --project [project:string]",
    "The name of the project to work on"
  )
  .action(async ({ project: projectName }: SessionOptions) => {
    const session = await getOngoingSession();
    if (session != null) {
      console.log("There is an ongoing session. Did you forget to end it?");
      return;
    }

    await createSession(projectName);
    console.log("Session Started! Get to work!");
  });

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
      }\nDuration: ${formatSessionDuration(session)}`
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
      `Current Session\nFocus: ${
        session.focus
      }\nDuration: ${formatSessionDuration(session)}`
    );
  });

export const session = new Command()
  .version("0.0.1")
  .description("Sentinel Session Management")
  .command("start", sessionStart)
  .command("end", sessionEnd)
  .command("recap", sessionRecap);
