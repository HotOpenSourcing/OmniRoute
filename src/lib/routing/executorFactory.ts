import { getCloudExecutor, getHybridExecutor, getLocalExecutor } from "@omniroute/open-sse/executors";

export const executorFactory = {
  getLocalExecutor,
  getCloudExecutor,
  getHybridExecutor,
};
