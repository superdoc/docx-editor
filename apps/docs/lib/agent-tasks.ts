export type AgentTask = {
  id: string;
  title: string;
  summary: string;
  guideHref: string;
  instruction: string;
};

export const AGENT_TASKS: readonly AgentTask[] = [
  {
    id: 'editor',
    title: 'Add a DOCX editor',
    summary: 'Open, edit, and export a DOCX in your app',
    guideHref: '/editor/quickstart',
    instruction:
      'Then add a SuperDoc editor to this project: load a local .docx, let me edit it, and add a button that exports the result.',
  },
  {
    id: 'redline',
    title: 'Build a DOCX agent',
    summary: 'Give your product an agent that proposes reviewable edits',
    guideHref: '/agents/build/build-an-agent',
    instruction:
      'Then build an agent with the SuperDoc SDK that proposes a tracked edit to a .docx and saves the result to a separate file I can review.',
  },
  {
    id: 'resolve',
    title: 'Resolve changes with Node.js',
    summary: 'Accept or reject existing changes from Node.js',
    guideHref: '/agents/automation/node-sdk',
    instruction:
      'Then write a Node.js script that opens a .docx, accepts every tracked change, and saves the result to a new file.',
  },
  {
    id: 'resolve-python',
    title: 'Resolve changes with Python',
    summary: 'Accept or reject existing changes from Python',
    guideHref: '/agents/automation/python-sdk',
    instruction:
      'Then write a Python script that opens a .docx, accepts every tracked change, and saves the result to a new file.',
  },
  {
    id: 'resolve-rust',
    title: 'Resolve changes with Rust (Beta)',
    summary: 'Accept or reject existing changes from Rust',
    guideHref: '/agents/automation/rust-sdk',
    instruction:
      'Then write a Rust program that opens a .docx, accepts every tracked change, and saves the result to a new file.',
  },
];
