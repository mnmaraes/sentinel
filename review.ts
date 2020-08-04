import {
  dim,
  bold,
  underline,
} from "https://deno.land/std@0.63.0/fmt/colors.ts";

import { Command } from "https://deno.land/x/cliffy/command.ts";
import { Select } from "https://deno.land/x/cliffy/prompt.ts";

import startOfWeek from "https://deno.land/x/date_fns/startOfWeek/index.js";
import endOfWeek from "https://deno.land/x/date_fns/endOfWeek/index.js";
import startOfMonth from "https://deno.land/x/date_fns/startOfMonth/index.js";
import endOfMonth from "https://deno.land/x/date_fns/endOfMonth/index.js";
import eachDayOfInterval from "https://deno.land/x/date_fns/eachDayOfInterval/index.js";
import format from "https://deno.land/x/date_fns/format/index.js";

import {
  getOngoingSession,
  hydrateTasks,
  loadTaskIndex,
  loadSessionIndex,
  SessionIndex,
  TaskIndex,
  groupTasks,
  groupSessions,
  printSessionGroup,
  printTaskGroups,
  printTask,
  printSession,
  hydrateSessions,
  flattenTasks,
  flattenSessions,
  formatDuration,
  sumDuration,
  SessionGroup,
  TaskGroup,
} from "./utils.ts";

const selectDay = async (
  sessionIndex: SessionIndex,
  taskIndex: TaskIndex
): Promise<string> => {
  const days = [
    ...new Set([
      ...Object.keys(sessionIndex.byDate),
      ...Object.keys(taskIndex.byCreationDate),
      ...Object.keys(taskIndex.byCompletionDate),
    ]),
  ].map((date) => +new Date(date));
  days.sort();
  let dayStrings = days.map((date) => new Date(date).toDateString()).reverse();

  return Select.prompt({
    message: "Select the day",
    options: dayStrings,
  });
};

const selectWeek = async (
  sessionIndex: SessionIndex,
  taskIndex: TaskIndex
): Promise<string> => {
  const days = [
    ...new Set(
      [
        ...Object.keys(sessionIndex.byDate),
        ...Object.keys(taskIndex.byCreationDate),
        ...Object.keys(taskIndex.byCompletionDate),
      ].map((day) => startOfWeek(new Date(day), {}).getTime())
    ),
  ];
  days.sort();
  let dayStrings = days
    .map((day) => {
      const date = new Date(day);

      return {
        name: `Week from ${date.toDateString()} to ${endOfWeek(
          date,
          {}
        ).toDateString()} `,
        value: date.toDateString(),
      };
    })
    .reverse();

  return Select.prompt({
    message: "Select the week",
    options: dayStrings,
  });
};

const selectMonth = async (
  sessionIndex: SessionIndex,
  taskIndex: TaskIndex
): Promise<string> => {
  const days = [
    ...new Set(
      [
        ...Object.keys(sessionIndex.byDate),
        ...Object.keys(taskIndex.byCreationDate),
        ...Object.keys(taskIndex.byCompletionDate),
      ].map((day) => startOfMonth(new Date(day)).getTime())
    ),
  ];
  days.sort();
  let dayStrings = days
    .map((day) => {
      const date = new Date(day);

      return {
        name: `${format(date, "MMMM y", {})}`,
        value: date.toDateString(),
      };
    })
    .reverse();

  return Select.prompt({
    message: "Select the month",
    options: dayStrings,
  });
};

type ReviewData = {
  sessions: SessionGroup;
  createdTasks: TaskGroup;
  completedTasks: TaskGroup;
};

type ReviewInterval = {
  start: Date;
  end: Date;
};

const reviewDataBetween = async (
  interval: ReviewInterval,
  sessionIndex: SessionIndex,
  taskIndex: TaskIndex
): Promise<ReviewData> => {
  const days: string[] = eachDayOfInterval(interval, {}).map((date: Date) =>
    date.toDateString()
  );

  const sessions = groupSessions(
    await hydrateSessions(days.flatMap((day) => sessionIndex.byDate[day] ?? []))
  );
  const createdTasks = groupTasks(
    await hydrateTasks(
      days.flatMap((day) => taskIndex.byCreationDate[day] ?? [])
    )
  );
  const completedTasks = groupTasks(
    await hydrateTasks(
      days.flatMap((day) => taskIndex.byCompletionDate[day] ?? [])
    )
  );

  return { sessions, createdTasks, completedTasks };
};

const printReview = (
  { sessions, createdTasks, completedTasks }: ReviewData,
  projectName?: string
) => {
  const flatSessions = projectName
    ? sessions[projectName] ?? []
    : flattenSessions(sessions);
  console.log(underline(bold(`\n${flatSessions.length} Sessions:`)));

  if (projectName != null) {
    flatSessions.forEach((session) => printSession(session, "\t"));
  } else {
    printSessionGroup(sessions, "\t");
  }

  console.log(
    `\n\t${dim("Total duration:")} ${bold(
      formatDuration(sumDuration(flatSessions))
    )}`
  );

  console.log(
    underline(
      bold(
        `\n${
          (projectName
            ? createdTasks[projectName] ?? []
            : flattenTasks(createdTasks)
          ).length
        } Created Tasks:`
      )
    )
  );

  if (projectName != null) {
    (createdTasks[projectName] ?? []).forEach((task) => printTask(task, "\t"));
  } else {
    printTaskGroups(createdTasks, "\t");
  }

  console.log(
    underline(
      bold(
        `\n${
          (projectName
            ? completedTasks[projectName] ?? []
            : flattenTasks(completedTasks)
          ).length
        } Completed Tasks:`
      )
    )
  );
  if (projectName != null) {
    (completedTasks[projectName] ?? []).forEach((task) =>
      printTask(task, "\t")
    );
  } else {
    printTaskGroups(completedTasks, "\t");
  }
};

const showDailyReview = async (
  shouldBeInteractive: boolean,
  projectName?: string
) => {
  const sessionIndex = await loadSessionIndex();
  const taskIndex = await loadTaskIndex();

  const day = shouldBeInteractive
    ? await selectDay(sessionIndex, taskIndex)
    : new Date().toDateString();

  const sessions = groupSessions(
    await hydrateSessions(sessionIndex.byDate[day] ?? [])
  );
  const createdTasks = groupTasks(
    await hydrateTasks(taskIndex.byCreationDate[day] ?? [])
  );
  const completedTasks = groupTasks(
    await hydrateTasks(taskIndex.byCompletionDate[day] ?? [])
  );

  console.log(underline(bold(`${day}`)));
  printReview({ sessions, createdTasks, completedTasks }, projectName);
};

const weekInterval = (dateString: string): ReviewInterval => {
  const weekStart = new Date(dateString);

  return {
    start: weekStart,
    end: endOfWeek(weekStart, {}),
  };
};

const showWeeklyReview = async (
  shouldBeInteractive: boolean,
  projectName?: string
) => {
  const sessionIndex = await loadSessionIndex();
  const taskIndex = await loadTaskIndex();

  const day = shouldBeInteractive
    ? await selectWeek(sessionIndex, taskIndex)
    : startOfWeek(new Date(), {}).toDateString();

  const review = await reviewDataBetween(
    weekInterval(day),
    sessionIndex,
    taskIndex
  );

  printReview(review, projectName);
};

const monthInterval = (dateString: string): ReviewInterval => {
  const monthStart = new Date(dateString);

  return {
    start: monthStart,
    end: endOfMonth(monthStart),
  };
};

const showMonthlyReview = async (
  shouldBeInteractive: boolean,
  projectName?: string
) => {
  const sessionIndex = await loadSessionIndex();
  const taskIndex = await loadTaskIndex();

  const day = shouldBeInteractive
    ? await selectMonth(sessionIndex, taskIndex)
    : startOfMonth(new Date()).toDateString();

  const review = await reviewDataBetween(
    monthInterval(day),
    sessionIndex,
    taskIndex
  );

  printReview(review, projectName);
};

type ReviewOptions = {
  interactive: boolean;
  week: boolean;
  month: boolean;
  current: boolean;
  project?: string;
};
export const review = new Command()
  .version("0.0.1")
  .description("Review what you've done")
  .option(
    "-i, --interactive [interactive:boolean]",
    "Select the specific date to review"
  )
  .option("-w, --week [week:boolean]", "Review your week so far", {
    conflicts: ["month"],
  })
  .option("-m, --month [month:boolean]", "Review your month so far")
  .option(
    "-c, --current [current:boolean]",
    "Keep the review contained to the project of the current session",
    { conflicts: ["project"] }
  )
  .option(
    "-p, --project [project:string]",
    "Keep the review contained to a specific project"
  )
  .action(
    async ({
      interactive: shouldBeInteractive,
      week: shouldShowWeek,
      month: shouldShowMonth,
      current: shouldShowCurrent,
      project: projectName,
    }: ReviewOptions) => {
      if (shouldShowCurrent) {
        projectName = (await getOngoingSession())?.projectName;
      }

      if (shouldShowMonth) {
        return showMonthlyReview(shouldBeInteractive, projectName);
      } else if (shouldShowWeek) {
        return showWeeklyReview(shouldBeInteractive, projectName);
      } else {
        return showDailyReview(shouldBeInteractive, projectName);
      }
    }
  );
