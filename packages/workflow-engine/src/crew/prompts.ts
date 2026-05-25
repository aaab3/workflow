/**
 * Crew Prompt Templates — Internationalized prompt templates for all crew modes.
 *
 * Supports "zh" (Chinese) and "en" (English) locales.
 * Templates use {{variable}} placeholders resolved at runtime.
 */

export type PromptLocale = "zh" | "en";

export interface PromptTemplates {
  // Pipeline
  pipeline_first_task: string;
  pipeline_subsequent_task: string;

  // Parallel
  parallel_task: string;
  parallel_dispatch: string;
  parallel_merge: string;

  // Reflect
  reflect_generate_first: string;
  reflect_generate_revise: string;
  reflect_review: string;

  // MoA
  moa_aggregate: string;

  // Debate
  debate_opening: string;
  debate_rebuttal: string;
  debate_judge: string;

  // Hierarchy
  hierarchy_plan: string;
  hierarchy_synthesize: string;

  // Common
  output_only: string;
}

const ZH_PROMPTS: PromptTemplates = {
  // Pipeline
  pipeline_first_task: "{{task}}\n\n要求：只输出结果，不要输出思考过程。",
  pipeline_subsequent_task: "上一步的输出：\n{{prevOutput}}\n\n你的任务：{{agentTask}}\n\n要求：只输出你的处理结果，不要输出思考过程。",

  // Parallel
  parallel_task: "{{task}}\n\n要求：只输出你的结果，不要输出思考过程。",
  parallel_dispatch: "你是任务调度者。将以下任务拆分为 {{workerCount}} 个独立的子任务，分配给团队成员。\n\n总任务：{{task}}\n\n团队成员：{{workers}}\n\n请以 JSON 数组格式输出：[{\"agent\":\"角色名\",\"subtask\":\"子任务描述\"}]\n只输出 JSON，不要其他内容。",
  parallel_merge: "你是结果合并者。以下是团队成员各自完成的子任务结果，请综合整理为一个完整的最终输出。\n\n原始任务：{{task}}\n\n各成员结果：\n{{results}}\n\n要求：整合所有结果，输出一个完整、连贯的最终答案。",

  // Reflect
  reflect_generate_first: "{{task}}\n\n要求：只输出最终结果，不要输出思考过程。",
  reflect_generate_revise: "根据反馈修改你的回答。只输出修改后的最终结果。\n\n原回答: {{lastOutput}}\n\n反馈: {{feedback}}",
  reflect_review: "评审以下输出的质量（1-10分），给出简短反馈。\n\n输出内容:\n{{output}}\n\n请回复格式：分数/10 + 一句话反馈",

  // MoA
  moa_aggregate: "以下是多位专家对同一问题的回答，请综合所有观点给出最佳答案:\n\n{{proposals}}",

  // Debate
  debate_opening: "辩题：{{task}}\n\n你的立场：{{role}}\n\n要求：明确表态支持你的立场，用具体论据论证。不要给出中立分析，你必须坚定站在你这一方。只输出你的论点，不要输出思考过程。",
  debate_rebuttal: "辩题：{{task}}\n\n你的立场：{{role}}\n对方立场：{{opponent}}\n\n最近的发言：\n{{recentHistory}}\n\n要求：针对对方最新论点反驳，强化你的立场。只输出论点，不要思考过程。",
  debate_judge: "辩题：{{task}}\n\n辩论记录：\n\n{{summary}}\n\n请裁决：哪方更有说服力？给出结论。只输出裁决结果。",

  // Hierarchy
  hierarchy_plan: "你是团队负责人。请将以下任务拆解为子任务，分配给你的团队成员。\n\n任务: {{task}}\n\n团队成员: {{workers}}\n\n请以 JSON 格式输出任务分配: [{\"agent\": \"角色名\", \"subtask\": \"子任务描述\"}]",
  hierarchy_synthesize: "团队成员已完成各自的子任务，请综合所有结果给出最终输出:\n\n{{results}}",

  // Common
  output_only: "要求：只输出结果，不要输出思考过程。",
};

const EN_PROMPTS: PromptTemplates = {
  // Pipeline
  pipeline_first_task: "{{task}}\n\nRequirement: Output only the result, no reasoning process.",
  pipeline_subsequent_task: "Previous step output:\n{{prevOutput}}\n\nYour task: {{agentTask}}\n\nRequirement: Output only your result, no reasoning process.",

  // Parallel
  parallel_task: "{{task}}\n\nRequirement: Output only your result, no reasoning process.",
  parallel_dispatch: "You are a task dispatcher. Split the following task into {{workerCount}} independent subtasks for team members.\n\nMain task: {{task}}\n\nTeam members: {{workers}}\n\nOutput as JSON array: [{\"agent\":\"role name\",\"subtask\":\"subtask description\"}]\nOutput only JSON, nothing else.",
  parallel_merge: "You are a result merger. Below are the results from team members. Please synthesize them into a complete final output.\n\nOriginal task: {{task}}\n\nMember results:\n{{results}}\n\nRequirement: Integrate all results into a complete, coherent final answer.",

  // Reflect
  reflect_generate_first: "{{task}}\n\nRequirement: Output only the final result, no reasoning process.",
  reflect_generate_revise: "Revise your answer based on the feedback. Output only the revised final result.\n\nOriginal answer: {{lastOutput}}\n\nFeedback: {{feedback}}",
  reflect_review: "Review the quality of the following output (1-10 score), provide brief feedback.\n\nOutput:\n{{output}}\n\nReply format: score/10 + one sentence feedback",

  // MoA
  moa_aggregate: "Below are answers from multiple experts on the same question. Please synthesize all perspectives into the best answer:\n\n{{proposals}}",

  // Debate
  debate_opening: "Topic: {{task}}\n\nYour position: {{role}}\n\nRequirement: Clearly state your position with specific arguments. Do not give neutral analysis. Output only your arguments, no reasoning process.",
  debate_rebuttal: "Topic: {{task}}\n\nYour position: {{role}}\nOpponent's position: {{opponent}}\n\nRecent statements:\n{{recentHistory}}\n\nRequirement: Rebut the opponent's latest points and strengthen your position. Output only arguments, no reasoning.",
  debate_judge: "Topic: {{task}}\n\nDebate record:\n\n{{summary}}\n\nPlease judge: Which side is more persuasive? Give your verdict. Output only the verdict.",

  // Hierarchy
  hierarchy_plan: "You are the team lead. Please decompose the following task into subtasks and assign them to your team members.\n\nTask: {{task}}\n\nTeam members: {{workers}}\n\nOutput as JSON: [{\"agent\": \"role name\", \"subtask\": \"subtask description\"}]",
  hierarchy_synthesize: "Team members have completed their subtasks. Please synthesize all results into the final output:\n\n{{results}}",

  // Common
  output_only: "Requirement: Output only the result, no reasoning process.",
};

const LOCALE_MAP: Record<PromptLocale, PromptTemplates> = {
  zh: ZH_PROMPTS,
  en: EN_PROMPTS,
};

/**
 * Get a prompt template by key, with locale and override support.
 */
export function getPrompt(
  key: keyof PromptTemplates,
  locale: PromptLocale = "zh",
  overrides?: Record<string, string>
): string {
  // Check overrides first
  if (overrides && overrides[key]) {
    return overrides[key];
  }
  return LOCALE_MAP[locale]?.[key] ?? LOCALE_MAP.zh[key];
}

/**
 * Resolve template variables in a prompt string.
 */
export function resolvePrompt(
  template: string,
  variables: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return variables[key] !== undefined ? String(variables[key]) : `{{${key}}}`;
  });
}
