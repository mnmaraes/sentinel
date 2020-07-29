import { v4 } from "https://deno.land/std/uuid/mod.ts";
import {
  ensureFile,
  readJson,
  writeJson,
} from "https://deno.land/std@master/fs/mod.ts";

import { Select, Input } from "https://deno.land/x/cliffy/prompt.ts";
import { Command } from "https://deno.land/x/cliffy/command.ts";

const home = Deno.env.get("HOME");
const SENTINEL_PATH = home + "/.sentinel";
const SESSIONS_PATH = SENTINEL_PATH + "/sessions";
const CONFIG_PATH = SENTINEL_PATH + "/config.json";

// Helpers
type Config = {};
const INITIAL_CONFIG: Config = {};

const loadWithDefault = async <T>(
  path: string,
  defaultValue: T
): Promise<T> => {
  await ensureFile(path);
  try {
    const value = (await readJson(path)) as T;
    return value;
  } catch (e) {
    if (e.message.endsWith("Unexpected end of JSON input")) {
      await writeJson(path, defaultValue, { spaces: 2 });
      return defaultValue;
    }
    throw e;
  }
};

const loadConfig = async (): Promise<Config> => {
  return loadWithDefault(CONFIG_PATH, INITIAL_CONFIG);
};

type Project = {
  name: string;
  workingDir: string;
  tasks: string[];

  github?: string;
};

type Store = {
  projects: { [name: string]: Project };
  ongoingSession?: string;
};
const INITIAL_STORE: Store = {
  projects: {},
  ongoingSession: undefined,
};

const STORE_PATH = SENTINEL_PATH + "/store.json";

const addProject = async (name: string, project: Project): Promise<void> => {
  const store = await loadStore();
  store.projects[name] = project;

  await writeJson(STORE_PATH, store, { spaces: 2 });
};

const loadStore = async (): Promise<Store> => {
  return loadWithDefault(STORE_PATH, INITIAL_STORE);
};

const createProject = async (projectName?: string): Promise<Project> => {
  if (projectName == null) {
    projectName = await Input.prompt("Project name: ");
  }
  const currentDir = Deno.cwd();
  let workingDir: string = await Input.prompt(
    `Project working dir (empty for ${currentDir}): `
  );
  if (workingDir.length == 0) {
    workingDir = currentDir;
  }
  const github: string = await Input.prompt("Github repo: ");

  // TODO: Save project
  const project = {
    name: projectName,
    workingDir,
    github,
    tasks: [],
  };
  addProject(projectName!, project);

  return project;
};

const selectProject = async (): Promise<Project> => {
  let store = await loadStore();
  const project: string = await Select.prompt({
    message: "Select a project",
    options: [...Object.keys(store.projects), "Create a new project"],
  });

  if (project !== "Create a new project") {
    return store.projects[project];
  }

  return createProject();
};

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
  const store = await loadStore();

  store.ongoingSession = session.id;

  await writeJson(STORE_PATH, store, { spaces: 2 });
};

const clearOngoingSession = async (): Promise<void> => {
  const store = await loadStore();

  store.ongoingSession = undefined;

  await writeJson(STORE_PATH, store, { spaces: 2 });
};

const addToIndex = async (session: Session): Promise<void> => {
  const index = await loadSessionIndex();

  index.byProject[session.projectName] = [
    ...(index.byProject[session.projectName] ?? []),
    session.id,
  ];

  let formattedStartDate = new Date(session.sessionStart).toDateString();
  index.byDate[formattedStartDate] = [
    ...(index.byProject[formattedStartDate] ?? []),
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

const getProject = async (projectName?: string): Promise<Project> => {
  const store = await loadStore();

  if (projectName == null) {
    return selectProject();
  } else if (store.projects[projectName] == null) {
    return createProject(projectName);
  } else {
    return store.projects[projectName];
  }
};

// Sub-commands
type SessionOptions = { project?: string };
let sessionStart = new Command()
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

let sessionEnd = new Command()
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

let sessionRecap = new Command()
  .version("0.0.1")
  .description("Shows stats for current working session")
  .action(async () => {
    let session = await getOngoingSession();
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

let session = new Command()
  .version("0.0.1")
  .description("Sentinel Session Management")
  .command("start", sessionStart)
  .command("end", sessionEnd)
  .command("recap", sessionRecap);

// Command
let central = new Command()
  .description("An ever watching guardian of your productivity")
  .command("session", session);

if (import.meta.main) {
  await central.parse(Deno.args);
}
