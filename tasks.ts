import { v4 } from "https://deno.land/std/uuid/mod.ts";
import { Command } from "https://deno.land/x/cliffy/command.ts";
import { writeJson, ensureFile } from "https://deno.land/std@master/fs/mod.ts";

import { Input } from "https://deno.land/x/cliffy/prompt.ts";
import {
  loadWithDefault,
  getOngoingSession,
  getProject,
  Project,
  Task,
  TASKS_PATH,
  getTasksPath,
} from "./utils.ts";

type TaskIndex = {
  all: string[];
  inbox: string[];
  incomplete: string[];
  byProject: { [projectName: string]: string[] };
  byCreationDate: { [date: string]: string[] };
  byCompletionDate: { [date: string]: string[] };
};

const TASKS_INDEX_PATH = TASKS_PATH + "/index.json";
const INITIAL_INDEX: TaskIndex = {
  all: [],
  inbox: [],
  incomplete: [],
  byProject: {},
  byCreationDate: {},
  byCompletionDate: {},
};

const loadTaskIndex = async (): Promise<TaskIndex> => {
  return loadWithDefault(TASKS_INDEX_PATH, INITIAL_INDEX);
};

const promptForTaskDescription = (): Promise<string> => {
  return Input.prompt("Task Description (leave empty to stop): ");
};

const indexTask = async ({
  id,
  projectName,
  isDone,
  created,
}: Task): Promise<void> => {
  const index = await loadTaskIndex();

  index.all = [id, ...index.all];

  if (projectName != null) {
    index.byProject[projectName] = [
      id,
      ...(index.byProject[projectName] ?? []),
    ];
  } else {
    index.inbox = [id, ...index.inbox];
  }

  if (!isDone) {
    index.incomplete = [id, ...index.incomplete];
  }

  let formattedCreationDate = new Date(created).toDateString();
  index.byCreationDate[formattedCreationDate] = [
    id,
    ...(index.byCreationDate[formattedCreationDate] ?? []),
  ];

  await writeJson(TASKS_INDEX_PATH, index, { spaces: 2 });
};

const saveTask = async (
  description: string,
  project?: Project
): Promise<void> => {
  const task: Task = {
    id: v4.generate(),
    description,
    isDone: false,
    created: Date.now(),
    projectName: project?.name,
  };

  await indexTask(task);

  const path = getTasksPath(task.id);

  await ensureFile(path);
  await writeJson(path, task, { spaces: 2 });
};

// Sub-Commands
type CreateTaskOptions = {
  dump: boolean;
  current: boolean;
  projectName?: string;
};
const taskCreate = new Command()
  .version("0.0.1")
  .description("Start a working session")
  .option(
    "-d, --dump [dump:boolean]",
    "Don't be prompted to organize tasks, instead will just add them to main inbox (or project inbox if used with -p)"
  )
  .option(
    "-c, --current [current:boolean]",
    "Adds task to the project of the ongoing session",
    { conflicts: ["project"] }
  )
  .option(
    "-p, --project [projectName:string]",
    "The name of the project to add taks to"
  )
  .action(async ({ projectName, current, dump }: CreateTaskOptions) => {
    if (current) {
      projectName = (await getOngoingSession())?.projectName;
    }

    if (current && projectName == null) {
      console.log(
        "--current option used without an ongoing session. The option will be ignored"
      );
    }

    for (
      let taskDescription: string = await promptForTaskDescription();
      taskDescription.trim().length > 0;
      taskDescription = await promptForTaskDescription()
    ) {
      let project: Project | undefined;
      if (!dump) {
        project = await getProject(projectName);
      }

      await saveTask(taskDescription, project);
    }
  });

export const session = new Command()
  .version("0.0.1")
  .description("Sentinel Task Management")
  .command("create", taskCreate);
//.command("complete", completeTask)
//.command("list", listTasks)
//.command("organize", organizeTasks);
