import { directorAgent } from "./director";
import { qaAgent } from "./qa";
import { researchAgent } from "./research";
import { scriptAgent } from "./script";
import { seoAgent } from "./seo";

export const AGENTS = {
  research: researchAgent,
  script: scriptAgent,
  director: directorAgent,
  seo: seoAgent,
  qa: qaAgent,
};

export type AgentId = keyof typeof AGENTS;
