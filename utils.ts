import {
  ensureFile,
  readJson,
  writeJson,
} from "https://deno.land/std@master/fs/mod.ts";

import { Select, Input } from "https://deno.land/x/cliffy/prompt.ts";

const home = Deno.env.get("HOME");
export const SENTINEL_PATH = home + "/.sentinel";
const CONFIG_PATH = SENTINEL_PATH + "/config.json";

// Helpers
type Config = {};
const INITIAL_CONFIG: Config = {};

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

export const loadConfig = async (): Promise<Config> => {
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

export const loadStore = async (): Promise<Store> => {
  return loadWithDefault(STORE_PATH, INITIAL_STORE);
};

const saveStore = async (store: Store): Promise<void> => {
  return await writeJson(STORE_PATH, store, { spaces: 2 });
};

export const updateStore = async (
  modification: Partial<Store>
): Promise<void> => {
  const store = await loadStore();

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
