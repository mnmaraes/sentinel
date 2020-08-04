import { v4 } from "https://deno.land/std/uuid/mod.ts";
import { Command } from "https://deno.land/x/cliffy/command.ts";
import { writeJson, ensureFile } from "https://deno.land/std@0.63.0/fs/mod.ts";

import { reset, bold } from "https://deno.land/std@0.63.0/fmt/colors.ts";
import {
  Input,
  Checkbox,
  CheckboxOption,
} from "https://deno.land/x/cliffy/prompt.ts";
import {
  getProjectTasks,
  loadTaskIndex,
  modifyTaskIndex,
  TaskIndex,
  getOngoingSession,
  getProject,
  Project,
  Task,
  getTasksPath,
  hydrateTasks,
  printTaskGroups,
  printTask,
  TaskGroup,
  groupTasks,
  flattenTasks,
} from "./utils.ts";

const promptForTaskDescription = (): Promise<string> => {
  return Input.prompt("Task Description (leave empty to stop): ");
};

const getAllTasks = async (shouldIncludeDone: boolean): Promise<TaskGroup> => {
  const { all, incomplete } = await loadTaskIndex();
  const tasks = await hydrateTasks(shouldIncludeDone ? all : incomplete);
  return groupTasks(tasks);
};

const getInboxTasks = async (shouldIncludeDone: boolean): Promise<Task[]> => {
  const { inbox, incomplete } = await loadTaskIndex();
  return await hydrateTasks(
    shouldIncludeDone
      ? inbox
      : inbox.filter((id) => incomplete.indexOf(id) != -1)
  );
};

const listAllTasks = async (shouldIncludeDone: boolean): Promise<void> => {
  console.log("Listing All Tasks");
  printTaskGroups(await getAllTasks(shouldIncludeDone));
};

const listInboxTasks = async (shouldIncludeDone: boolean): Promise<void> => {
  console.log("Listing Inbox Tasks");
  (await getInboxTasks(shouldIncludeDone)).forEach((task) => printTask(task));
};

const listProjectTasks = async (
  projectName: string,
  shouldIncludeDone: boolean
): Promise<void> => {
  console.log(`Listing ${projectName} Tasks`);

  (await getProjectTasks(projectName, shouldIncludeDone)).forEach((task) =>
    printTask(task)
  );
};

const getToggleOptions = (tasks: TaskGroup | Task[]): CheckboxOption[] => {
  if (tasks instanceof Array) {
    return tasks.map(({ description, id, isDone }) => ({
      name: description,
      value: id,
      checked: isDone,
    }));
  }

  const options: CheckboxOption[] = [];
  for (let key in tasks) {
    options.push({
      name: `${reset(bold(key))}`,
      value: key,
      disabled: true,
      icon: false,
    });
    tasks[key].forEach(({ description, id, isDone }) =>
      options.push({
        name: description,
        value: id,
        checked: isDone,
      })
    );
  }
  return options;
};

const toggleTasks = async (tasks: TaskGroup | Task[]): Promise<void> => {
  const options = getToggleOptions(tasks);
  const flatTasks = flattenTasks(tasks);

  const checked: string[] = await Checkbox.prompt({
    message: "Toggle Tasks todo/done",
    options,
  });

  const toggledTasks = flatTasks.filter((task) => {
    return checked.includes(task.id) !== task.isDone;
  });

  for (let task of toggledTasks) {
    task.isDone = !task.isDone;
    task.completed = task.isDone ? Date.now() : undefined;
    await writeTask(task);
  }

  modifyTaskIndex((index) => {
    toggledTasks.map(reindexTask).forEach((modifier) => modifier(index));
  });
};

const without = <T>(list: T[], item: T): T[] => {
  return list.filter((candidate) => candidate != item);
};

const reindexTask = (task: Task) => (index: TaskIndex): void => {
  deindexTask(task)(index);
  indexTask(task)(index);
};

const deindexTask = ({ id }: Task) => (index: TaskIndex): void => {
  index.all = without(index.all, id);
  index.inbox = without(index.inbox, id);
  index.incomplete = without(index.incomplete, id);

  for (let key in index.byProject) {
    index.byProject[key] = without(index.byProject[key], id);
  }

  for (let key in index.byCompletionDate) {
    index.byCompletionDate[key] = without(index.byCompletionDate[key], id);
  }

  for (let key in index.byCreationDate) {
    index.byCreationDate[key] = without(index.byCreationDate[key], id);
  }
};

const indexTask = ({ id, projectName, isDone, created, completed }: Task) => (
  index: TaskIndex
): void => {
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

  if (completed != null) {
    let formattedCompletionDate = new Date(completed).toDateString();
    index.byCompletionDate[formattedCompletionDate] = [
      id,
      ...(index.byCompletionDate[formattedCompletionDate] ?? []),
    ];
  }
};

const writeTask = async (task: Task) => {
  const path = getTasksPath(task.id);
  await ensureFile(path);
  await writeJson(path, task, { spaces: 2 });
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

  await modifyTaskIndex(indexTask(task));

  await writeTask(task);
};

// Sub-Commands
type CreateTaskOptions = {
  dump: boolean;
  current: boolean;
  project?: string;
};
const taskCreate = new Command()
  .version("0.0.1")
  .description("Create sentinel tasks")
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
    "-p, --project [project:string]",
    "The name of the project to add taks to"
  )
  .action(
    async ({
      project: projectName,
      current: shouldShowCurrent,
      dump: shouldDump,
    }: CreateTaskOptions) => {
      if (shouldShowCurrent) {
        projectName = (await getOngoingSession())?.projectName;
      }

      if (shouldShowCurrent && projectName == null) {
        console.log(
          "--current option used without an ongoing session. The option will be ignored"
        );
      }

      if (projectName && projectName.length > 0) {
        console.log(`Adding tasks to ${projectName}`);
      } else if (shouldDump) {
        console.log("Adding tasks to inbox");
      }

      for (
        let taskDescription: string = await promptForTaskDescription();
        taskDescription.trim().length > 0;
        taskDescription = await promptForTaskDescription()
      ) {
        let project: Project | undefined;
        if (!shouldDump) {
          project = await getProject(projectName);
        }

        await saveTask(taskDescription, project);
      }
    }
  );

type TaskListOptions = {
  all: boolean;
  inbox: boolean;
  done: boolean;
  project?: string;
};
const taskList = new Command()
  .version("0.0.1")
  .description("Start a working session")
  .option(
    "-a, --all [all:boolean]",
    "List all tasks. If not present will list the tasks of the project of the ongoing session. If there isn't an ongoing session, will list the tasks in the inbox",
    { conflicts: ["project", "inbox"] }
  )
  .option(
    "-i, --inbox [inbox:boolean]",
    "List the tasks in the inbox, even if there is an ongoing session.",
    { conflicts: ["project"] }
  )
  .option("-d, --done [done:boolean]", "Include done tasks", {})
  .option("-p, --project [project:string]", "Lists the tasks for the project")
  .action(
    async ({
      all: shouldShowAll,
      inbox: shouldShowInbox,
      done: shouldShowDone,
      project: projectName,
    }: TaskListOptions) => {
      if (shouldShowAll) {
        await listAllTasks(shouldShowDone);
        return;
      }

      if (projectName == null && !shouldShowInbox) {
        projectName = (await getOngoingSession())?.projectName;
      }

      if (shouldShowInbox || projectName == null) {
        await listInboxTasks(shouldShowDone);
        return;
      }

      await listProjectTasks(projectName, shouldShowDone);
    }
  );

const taskComplete = new Command()
  .version("0.0.1")
  .description("Start a working session")
  .option(
    "-a, --all [all:boolean]",
    "List all tasks. If not present will list the tasks of the project of the ongoing session. If there isn't an ongoing session, will list the tasks in the inbox",
    { conflicts: ["project", "inbox"] }
  )
  .option(
    "-i, --inbox [inbox:boolean]",
    "List the tasks in the inbox, even if there is an ongoing session.",
    { conflicts: ["project"] }
  )
  .option("-d, --done [done:boolean]", "Include done tasks", {})
  .option("-p, --project [project:string]", "Lists the tasks for the project")
  .action(
    async ({
      all: shouldShowAll,
      inbox: shouldShowInbox,
      done: shouldShowDone,
      project: projectName,
    }: TaskListOptions) => {
      if (shouldShowAll) {
        await toggleTasks(await getAllTasks(shouldShowDone));
        return;
      }

      if (projectName == null && !shouldShowInbox) {
        projectName = (await getOngoingSession())?.projectName;
      }

      if (shouldShowInbox || projectName == null) {
        await toggleTasks(await getInboxTasks(shouldShowDone));
        return;
      }

      await toggleTasks(await getProjectTasks(projectName, shouldShowDone));
    }
  );

export const tasks = new Command()
  .version("0.0.1")
  .description("Sentinel Task Management")
  .command("create", taskCreate)
  .command("complete", taskComplete)
  .command("list", taskList);
//.command("organize", organizeTasks);
