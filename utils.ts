import {
  ensureFile,
  readJson,
  writeJson,
} from "https://deno.land/std@0.63.0/fs/mod.ts";

import {
  dim,
  bold,
  strikethrough,
  underline,
} from "https://deno.land/std@0.63.0/fmt/colors.ts";

import { Select, Input } from "https://deno.land/x/cliffy/prompt.ts";

const home = Deno.env.get("HOME");
/**
 * The Path to the stored sentinel data
 */
export const SENTINEL_PATH = home + "/.sentinel";
export const SESSIONS_PATH = SENTINEL_PATH + "/sessions";
export const TASKS_PATH = SENTINEL_PATH + "/tasks";
const CONFIG_PATH = SENTINEL_PATH + "/config.json";

// Helpers
type Config = {};
const INITIAL_CONFIG: Config = {};

/**
 * Helper function to load storage files that may or may not exist
 *
 * As an example [@link loadConfig] is implemented as:
 *
 * ```typescript
 * const loadConfig = async (): Promise<Config> => {
 * 	return loadWithDefault(CONFIG_PATH, INITIAL_CONFIG)
 * };
 * ```
 *
 * @param path The Path where the file lives (or will live)
 * @param defaultValue The initial value the file shoult take if it doesn't exist
 * @returns {Promise<T>} A promise that will resolve to the currently stored, or the default value if it didn't exist
 */
export const loadWithDefault = async <T>(
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

/**
 * Loads the stored sentinel config data, or creates it if one doesn't exist
 *
 * @returns {Config} The stored config data
 */
export const loadConfig = async (): Promise<Config> => {
  return loadWithDefault(CONFIG_PATH, INITIAL_CONFIG);
};

export type Project = {
  name: string;
  workingDir: string;
  tasks: string[];

  onStart?: string;
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

/**
 * Loads the stored sentinel main store data, or creates it if one doesn't exist
 *
 * @returns {Promis<Config>} A promise that will resolve to the main store data
 */
export const loadStore = async (): Promise<Store> => {
  return loadWithDefault(STORE_PATH, INITIAL_STORE);
};

const saveStore = async (store: Store): Promise<void> => {
  return await writeJson(STORE_PATH, store, { spaces: 2 });
};

/**
 * Apply changes to the current main store data, and saves it back to storage.
 * If the changes depend on the current store state, use [@link updateStore] instead
 *
 * Example:
 *
 * ```typescript
 * await setStore({ ongoingSession: undefined })
 * ```
 *
 * @param modification A partial store object of fields to change. Other fields will remain unaffected
 * @returns {Promise<void>} A promise that will resolve once the data has been saved
 */
export const setStore = async (modification: Partial<Store>): Promise<void> => {
  const store = await loadStore();

  Object.assign(store, modification);

  await saveStore(store);
};

/**
 * Apply changes to the current main store data, and saves it back to storage.
 * If the changes don't depend on the current store state, use [@link setStore] instead
 *
 * Example:
 * ```typescript
 * await updateStore((store) => {
 * 	if (store.ongoingSession != null) {
 * 		return { ongoingSession: undefined };
 * 	}
 *
 * 	return null;
 * })
 * ```
 *
 * @param modification A function that takes the current store state and returns
 * 			a partial store object that will be used to update the store,
 * 			or null if no update is to be performed
 * @returns {Promise<void>} A promise that will resolve once the data has been saved
 */
export const updateStore = async (
  modifier: (store: Store) => Partial<Store> | null
): Promise<void> => {
  const store = await loadStore();

  const modification = modifier(store);
  if (modification == null) {
    return;
  }

  Object.assign(store, modification);

  await saveStore(store);
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

/**
 * Gets the project data referring to the name `projectName`.
 * If no name is passed in, or the project doesn't exist,
 * walks the use through the process of selecting or creating a new project
 * and returns the selected/created project instead
 *
 * @param projectName An optional project name that will be used to fetch the project data
 * @returns {Promise<Project>} A promise that will resolve once a project with `projectName` has been found,
 * 				a project has been selected, or the user has created a new project
 */
export const getProject = async (projectName?: string): Promise<Project> => {
  const store = await loadStore();

  if (projectName == null) {
    return selectProject();
  } else if (store.projects[projectName] == null) {
    return createProject(projectName);
  } else {
    return store.projects[projectName];
  }
};

export type Session = {
  id: string;
  projectName: string;
  focus: string;
  sessionStart: number;
  sessionEnd?: number;
};

export const getOngoingSession = async (): Promise<Session | null> => {
  const sessionId = (await loadStore()).ongoingSession;
  if (sessionId == null) {
    return null;
  }

  return (await readJson(getSessionPath(sessionId))) as Session;
};

export const getSessionPath = (sessionId: string): string => {
  return `${SESSIONS_PATH}/${sessionId}.json`;
};

export type Task = {
  id: string;
  description: string;
  isDone: boolean;
  created: number;
  projectName?: string;
  completed?: number;
};
export const getTask = async (taskId: string): Promise<Task> => {
  return (await readJson(getTasksPath(taskId))) as Task;
};

export const getTasksPath = (taskId: string): string => {
  return `${TASKS_PATH}/${taskId}.json`;
};

export type TaskIndex = {
  all: string[];
  inbox: string[];
  incomplete: string[];
  byProject: { [projectName: string]: string[] };
  byCreationDate: { [date: string]: string[] };
  byCompletionDate: { [date: string]: string[] };
};

const TASKS_INDEX_PATH = TASKS_PATH + "/index.json";
const INITIAL_TASK_INDEX: TaskIndex = {
  all: [],
  inbox: [],
  incomplete: [],
  byProject: {},
  byCreationDate: {},
  byCompletionDate: {},
};

export const loadTaskIndex = async (): Promise<TaskIndex> => {
  return loadWithDefault(TASKS_INDEX_PATH, INITIAL_TASK_INDEX);
};

export const modifyTaskIndex = async (
  modifier: (index: TaskIndex) => void
): Promise<void> => {
  const index = await loadTaskIndex();

  modifier(index);

  await writeJson(TASKS_INDEX_PATH, index, { spaces: 2 });
};

export const getProjectTasks = async (
  projectName: string,
  shouldIncludeDone: boolean = false
): Promise<Task[]> => {
  const {
    byProject: { [projectName]: projectTasks = [] },
    incomplete,
  } = await loadTaskIndex();
  return await hydrateTasks(
    shouldIncludeDone
      ? projectTasks
      : projectTasks.filter((id) => incomplete.indexOf(id) != -1)
  );
};

export const hydrateTasks = async (taskIds: string[]): Promise<Task[]> => {
  return Promise.all(
    taskIds.map((taskId) => {
      return getTask(taskId);
    })
  );
};

export type TaskGroup = { [name: string]: Task[] };

export const groupTasks = (tasks: Task[]): TaskGroup => {
  return tasks.reduce((acc, task) => {
    const projectName = task.projectName ?? "inbox";

    return {
      ...acc,
      [projectName]: [...(acc[projectName] ?? []), task],
    };
  }, {} as TaskGroup);
};

export const formatDateTime = (date: number): string => {
  const dateObject = new Date(date);

  return `${dateObject.toDateString()} ${dateObject.toTimeString()}`;
};

export const printTaskGroups = (
  grouped: TaskGroup,
  prepend: string = ""
): void => {
  for (let key in grouped) {
    console.log(`${prepend}${bold(key + ":")}`);
    grouped[key].forEach((task) => printTask(task, prepend + "\t"));
  }
};

export const printTask = (
  { isDone, description, created, completed }: Task,
  prepend: string = ""
) => {
  const style = isDone ? strikethrough : underline;
  const formattedCompleted = completed
    ? `\n${prepend}${dim(`Completed on: ${formatDateTime(completed)}`)}`
    : "";
  console.log(
    `${prepend}${style(description)}\n${prepend}${dim(
      `Created on: ${formatDateTime(created)}`
    )}${formattedCompleted}`
  );
};

export const flattenTasks = (tasks: TaskGroup | Task[]): Task[] => {
  if (tasks instanceof Array) {
    return tasks;
  }

  let options: Task[] = [];
  for (let key in tasks) {
    options = [...options, ...tasks[key]];
  }
  return options;
};

export type SessionIndex = {
  byProject: { [name: string]: string[] };
  byDate: { [date: string]: string[] };
  ordered: string[];
};

export const SESSION_INDEX_PATH = SESSIONS_PATH + "/index.json";
const INITIAL_SESSION_INDEX: SessionIndex = {
  byProject: {},
  byDate: {},
  ordered: [],
};

export const loadSessionIndex = async (): Promise<SessionIndex> => {
  return loadWithDefault(SESSION_INDEX_PATH, INITIAL_SESSION_INDEX);
};

export const getSession = async (sessionId: string): Promise<Session> => {
  return (await readJson(getSessionPath(sessionId))) as Session;
};

export const hydrateSessions = async (
  sessionIds: string[]
): Promise<Session[]> => {
  return Promise.all(
    sessionIds.map((sessionId) => {
      return getSession(sessionId);
    })
  );
};

const SECOND_MULTIPLIER = 1000;
const MINUTE_MULTIPLIER = 60 * SECOND_MULTIPLIER;
const HOUR_MULTIPLIER = 60 * MINUTE_MULTIPLIER;

export const formatDuration = (duration: number): string => {
  return `${Math.floor(duration / HOUR_MULTIPLIER)}h ${Math.floor(
    (duration % HOUR_MULTIPLIER) / MINUTE_MULTIPLIER
  )}m ${Math.floor((duration % MINUTE_MULTIPLIER) / SECOND_MULTIPLIER)}s`;
};

export const printSessionGroup = (
  grouped: SessionGroup,
  prepend: string = ""
): void => {
  for (let key in grouped) {
    console.log(`${prepend}${bold(key + ":")}`);
    grouped[key].forEach((session) => printSession(session, prepend + "\t"));
    console.log(
      `${prepend}\t${dim("Project Total Duration: ")}${formatDuration(
        sumDuration(grouped[key])
      )}`
    );
  }
};

export const printSession = (
  { focus, sessionStart, sessionEnd }: Session,
  prepend: string = ""
) => {
  console.log(
    `${prepend}${underline(focus)}\n${prepend}${dim(
      "Started on: "
    )}${formatDateTime(sessionStart)}\n${prepend}${dim(
      "Duration: "
    )}${formatDuration((sessionEnd ?? Date.now()) - sessionStart)}`
  );
};

export type SessionGroup = { [name: string]: Session[] };

export const groupSessions = (sessions: Session[]): SessionGroup => {
  return sessions.reduce((acc, session) => {
    return {
      ...acc,
      [session.projectName]: [...(acc[session.projectName] ?? []), session],
    };
  }, {} as SessionGroup);
};

export const sumDuration = (sessions: Session[]): number => {
  return sessions.reduce(
    (acc, { sessionEnd, sessionStart }) =>
      acc + (sessionEnd ?? Date.now()) - sessionStart,
    0
  );
};

export const flattenSessions = (
  sessions: SessionGroup | Session[]
): Session[] => {
  if (sessions instanceof Array) {
    return sessions;
  }

  let flat: Session[] = [];
  for (let key in sessions) {
    flat = [...flat, ...sessions[key]];
  }
  return flat;
};
