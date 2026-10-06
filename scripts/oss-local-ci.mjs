#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const cliAvailable = existsSync(path.join(repoRoot, 'apps/cli/package.json'));
const mcpAvailable = existsSync(path.join(repoRoot, 'apps/mcp/package.json'));
const sdkAvailable = existsSync(path.join(repoRoot, 'packages/sdk/package.json'));
const docsManifestPath = path.join(repoRoot, 'apps/docs/package.json');
const docsScripts = existsSync(docsManifestPath)
  ? new Set(Object.keys(JSON.parse(readFileSync(docsManifestPath, 'utf8')).scripts ?? {}))
  : new Set();
const docsV1RoutesAvailable = ['check:v1-routes', 'test:v1-routes'].every((script) => docsScripts.has(script));
const orbitSuperdocWorkflow = '.github/workflows/ci-superdoc.yml';
const publicV2Workflow = '.github/workflows/validate.yml';
const orbitSuperdocWorkflowAvailable = existsSync(path.join(repoRoot, orbitSuperdocWorkflow));
const superdocWorkflow = orbitSuperdocWorkflowAvailable
  ? orbitSuperdocWorkflow
  : `${publicV2Workflow} (required public aggregate)`;
const superdocLaneTitle = orbitSuperdocWorkflowAvailable ? 'CI SuperDoc' : 'CI V2 Public validation';

function resolveOrbitWorkflow(workflowPaths, laneTitle) {
  const paths = Array.isArray(workflowPaths) ? workflowPaths : [workflowPaths];
  return paths.every((workflowPath) => existsSync(path.join(repoRoot, workflowPath)))
    ? paths.join(' + ')
    : `${publicV2Workflow} (${laneTitle} runs locally and in Orbit)`;
}

const NON_LOCAL_WORKFLOWS = ['label-prs.yml: GitHub PR labels/comments'];

function sh(command, options = {}) {
  return {
    command: ['bash', '-lc', command],
    cwd: options.cwd ?? '.',
    env: options.env ?? {},
    requiredEnv: options.requiredEnv ?? [],
    requiredTools: options.requiredTools ?? [],
    optional: Boolean(options.optional),
    note: options.note ?? '',
  };
}

const LANES = [
  {
    id: 'setup',
    title: 'Shared setup',
    workflow: '(local prelude)',
    stages: [
      // Both gates run before `pnpm install` in the hosted workflow, and every
      // other job is gated on them. Running them after the shared install
      // inverted that: a configuration the ownership gate rejects had already
      // steered resolution and run dependency lifecycle scripts by the time it
      // was reported. They also need no installed dependencies, which is what
      // makes running them here possible at all.
      { id: 'pnpm-config', title: 'pnpm config ownership', ...sh('pnpm run check:pnpm-config') },
      { id: 'vite-plus', title: 'Vite+ toolchain guard', ...sh('pnpm run check:vite-plus') },
      {
        id: 'install',
        title: 'Install dependencies',
        ...sh('pnpm install --frozen-lockfile'),
      },
    ],
  },
  {
    id: 'ci-superdoc',
    title: superdocLaneTitle,
    // Orbit and the standalone repository intentionally own different hosted
    // workflows. Report the one that exists so --list/--plan never directs a
    // public contributor to an exporter-omitted path.
    workflow: superdocWorkflow,
    stages: [
      // Repeated from the shared setup so an explicitly selected core lane
      // remains self-contained. In the standalone projection, setup and docs
      // own the other v2-public-validation steps reported in the metadata.
      { id: 'pnpm-config', title: 'pnpm config ownership', ...sh('pnpm run check:pnpm-config') },
      { id: 'vite-plus', title: 'Vite+ toolchain guard', ...sh('pnpm run check:vite-plus') },
      { id: 'lint', title: 'Lint', ...sh('NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint') },
      { id: 'format', title: 'Format check', ...sh('pnpm run format:check') },
      { id: 'build', title: 'Build', ...sh('pnpm run build') },
      { id: 'typecheck', title: 'Typecheck', ...sh('pnpm run type-check') },
      // Needs the installed tree: the guard walks both dependencies' real
      // importer chains rather than reading the lockfile, so it runs after the
      // build stages like the hosted workflow does.
      {
        id: 'removed-patches',
        title: 'Removed dependency patches stay unnecessary',
        ...sh('pnpm run check:removed-patches'),
      },
      {
        id: 'release-scripts',
        title: 'Release script checks',
        ...sh('pnpm run check:release-scripts'),
      },
      {
        id: 'workflow-paths',
        title: 'Workflow path filter checks',
        ...sh('pnpm run check:workflow-paths:tests && pnpm run check:workflow-paths'),
      },
      {
        id: 'consumer-install',
        title: 'Consumer install checks',
        ...sh('pnpm run check:consumer-install'),
      },
      {
        id: 'public-boundary',
        title: 'Public boundary checks',
        ...sh('pnpm run check:public-boundary:tests && pnpm run check:public-boundary'),
      },
      {
        id: 'public-interface',
        title: 'SuperDoc public interface check',
        ...sh('pnpm check:public:superdoc --skip-build'),
      },
      {
        id: 'font-families',
        title: 'Font curation list drift check',
        ...sh('pnpm --filter @superdoc/fonts --fail-if-no-match run check:families'),
      },
      {
        id: 'other-vitest',
        title: 'Run other package vitest tests',
        ...sh('NODE_OPTIONS=--max-old-space-size=4096 VITEST_MAX_WORKERS=1 VITEST_MIN_WORKERS=1 pnpm exec vp test run'),
      },
      {
        id: 'bun-tests',
        title: 'Run Bun package tests',
        ...sh(
          [
            'pnpm -r --parallel',
            '--filter @superdoc/document-api',
            '--filter @superdoc/layout-engine',
            '--filter @superdoc/style-engine',
            '--filter @superdoc/geometry-utils',
            '--filter @superdoc/word-layout',
            '--filter @superdoc/common',
            '--filter @superdoc/font-utils',
            '--filter @superdoc/url-validation',
            'test',
          ].join(' '),
        ),
      },
      { id: 'slow-tests', title: 'Run slow layout tests', ...sh('pnpm test:slow') },
      ...(sdkAvailable
        ? [
            {
              id: 'sdk-scripts',
              title: 'Run SDK scripts tests',
              ...sh('pnpm --prefix packages/sdk run test:scripts'),
            },
          ]
        : []),
      {
        id: 'cdn-install',
        title: 'Install Playwright Chromium for CDN smoke test',
        ...sh('pnpm --filter @superdoc/cdn-smoke-test exec playwright install chromium'),
      },
      {
        id: 'cdn-smoke',
        title: 'Run CDN smoke test',
        ...sh('pnpm test', { cwd: 'packages/superdoc/tests/cdn-smoke' }),
      },
      ...(cliAvailable
        ? [
            {
              id: 'cli-build-superdoc',
              title: 'Build superdoc for CLI tests',
              ...sh('pnpm run build:superdoc'),
            },
            {
              // test:cli runs the TypeScript sources through Bun, so only this
              // step sees a bundling break; Orbit's hosted lane runs it too.
              id: 'cli-build',
              title: 'Build CLI',
              ...sh('pnpm --prefix apps/cli run build'),
            },
            { id: 'cli-tests', title: 'Run CLI tests', ...sh('pnpm run test:cli') },
          ]
        : []),
      {
        id: 'coverage',
        title: 'Run SuperDoc coverage locally (Codecov upload excluded)',
        ...sh('pnpm --filter superdoc exec vp test run --coverage'),
      },
    ],
  },
  {
    id: 'ci-document-api',
    title: 'CI Document API',
    workflow: resolveOrbitWorkflow('.github/workflows/document-api.yml', 'extended Document API validation'),
    stages: [
      { id: 'docapi-sync', title: 'Generate contract outputs', ...sh('pnpm run docapi:sync') },
      {
        id: 'docapi-check',
        title: 'Check contract parity and generated outputs',
        ...sh('pnpm run docapi:check'),
      },
    ],
  },
  {
    id: 'ci-docs',
    title: 'CI Docs',
    workflow: resolveOrbitWorkflow('.github/workflows/ci-docs.yml', 'extended docs validation'),
    // Mirrors every step of that workflow in Orbit. Availability guards remove
    // only stages owned by private workspaces that the exporter omits; the
    // projected repository runs the required public aggregate instead.
    stages: [
      { id: 'docs-pnpm-config', title: 'Check pnpm config', ...sh('pnpm run check:pnpm-config') },
      { id: 'docs-typecheck', title: 'Typecheck docs', ...sh('pnpm --filter @superdoc/docs typecheck') },
      ...(sdkAvailable
        ? [{ id: 'docs-content', title: 'Test docs content', ...sh('pnpm --filter @superdoc/docs test:content') }]
        : []),
      { id: 'docs-fixtures', title: 'Test docs fixtures', ...sh('pnpm --filter @superdoc/docs test:fixtures') },
      {
        id: 'docs-migration-catalog',
        title: 'Test migration catalog',
        ...sh('pnpm --filter @superdoc/docs test:migration-catalog'),
      },
      {
        id: 'docs-migration-explorer',
        title: 'Test migration explorer',
        ...sh('pnpm --filter @superdoc/docs test:migration-explorer'),
      },
      {
        id: 'docs-migration-explorer-contrast',
        title: 'Test migration explorer contrast',
        ...sh('pnpm --filter @superdoc/docs test:migration-explorer-contrast'),
      },
      {
        id: 'docs-migration-snippets',
        title: 'Test migration snippets (contract)',
        ...sh('pnpm --filter @superdoc/docs test:migration-snippets:contract'),
      },
      { id: 'docs-links-test', title: 'Test docs links', ...sh('pnpm --filter @superdoc/docs test:links') },
      {
        id: 'docs-redirects-test',
        title: 'Test docs redirects',
        ...sh('pnpm --filter @superdoc/docs test:redirects'),
      },
      // Builds the SDK and CLI through its own pretest, so it is slower than the
      // rest of the lane but needs nothing a checkout does not have.
      ...(cliAvailable && sdkAvailable
        ? [{
            id: 'docs-document-api-smoke',
            title: 'Test Document API examples',
            ...sh('pnpm test:document-api-smoke'),
          }]
        : []),
      { id: 'docs-build', title: 'Build docs', ...sh('pnpm --filter @superdoc/docs build') },
      { id: 'docs-links', title: 'Check docs links', ...sh('pnpm --filter @superdoc/docs check:links') },
      // The workflow passes the PR base SHA, and without it `check:redirects`
      // silently skips the append-only route-history check: a page and its
      // routes.json entry removed together pass here and fail in CI. The local
      // stand-in is the merge base with the branch this work targets, which is
      // what the PR base resolves to. `|| true` keeps the stage runnable in a
      // checkout with no such ref rather than failing on the lookup; the check
      // then degrades to what it did before, which is still worth running.
      {
        id: 'docs-redirects',
        title: 'Check docs redirects',
        ...sh(
          'DOCS_REDIRECT_BASE_REF="$(git merge-base HEAD "${DOCS_REDIRECT_BASE_BRANCH:-origin/v2}" 2>/dev/null || true)" ' +
            'pnpm --filter @superdoc/docs check:redirects',
        ),
      },
      ...(cliAvailable && mcpAvailable && docsV1RoutesAvailable
        ? [
            {
              id: 'docs-v1-routes',
              title: 'Check V1 route dispositions',
              ...sh('pnpm --filter @superdoc/docs check:v1-routes'),
            },
            {
              id: 'docs-v1-routes-test',
              title: 'Test V1 route dispositions',
              ...sh('pnpm --filter @superdoc/docs test:v1-routes'),
            },
          ]
        : []),
      { id: 'docs-export', title: 'Test docs static export', ...sh('pnpm --filter @superdoc/docs test:export') },
      {
        id: 'docs-migration-agent-prompt',
        title: 'Test migration agent prompt',
        ...sh('pnpm --filter @superdoc/docs test:migration-agent-prompt'),
      },
      {
        id: 'docs-format',
        title: 'Check docs formatting',
        ...sh('pnpm exec vp fmt --check apps/docs'),
      },
    ],
  },
  {
    id: 'ci-package-wrappers',
    title: 'CI package wrappers',
    workflow: resolveOrbitWorkflow(
      ['.github/workflows/react.yml', '.github/workflows/ci-vue.yml', '.github/workflows/vscode.yml'],
      'wrapper validation',
    ),
    stages: [
      { id: 'react-build-superdoc', title: 'Build superdoc for React', ...sh('pnpm run build:superdoc') },
      { id: 'react-lint', title: 'Lint React package', ...sh('pnpm --filter @superdoc/react lint') },
      {
        id: 'react-typecheck',
        title: 'Typecheck React package',
        ...sh('pnpm --filter @superdoc/react type-check'),
      },
      { id: 'react-build', title: 'Build React package', ...sh('pnpm --filter @superdoc/react build') },
      { id: 'react-test', title: 'Test React package', ...sh('pnpm --filter @superdoc/react test') },
      { id: 'vue-build-superdoc', title: 'Build superdoc for Vue', ...sh('pnpm run build:superdoc') },
      { id: 'vue-lint', title: 'Lint Vue package', ...sh('pnpm --filter @superdoc/vue lint') },
      {
        id: 'vue-typecheck',
        title: 'Typecheck Vue package',
        ...sh('pnpm --filter @superdoc/vue type-check'),
      },
      {
        // Builds the package, then type-checks a real SFC against the built
        // types. This is the stage that catches a public contract that only
        // breaks once a consumer writes a template.
        id: 'vue-typecheck-consumer',
        title: 'Typecheck Vue SFC consumer',
        ...sh('pnpm --filter @superdoc/vue type-check:consumer'),
      },
      { id: 'vue-build', title: 'Build Vue package', ...sh('pnpm --filter @superdoc/vue build') },
      { id: 'vue-test', title: 'Test Vue package', ...sh('pnpm --filter @superdoc/vue test') },
      { id: 'vscode-lint', title: 'Lint VS Code extension', ...sh('pnpm --filter superdoc-vscode-ext lint') },
      {
        id: 'vscode-typecheck',
        title: 'Typecheck VS Code extension',
        ...sh('pnpm --filter superdoc-vscode-ext typecheck'),
      },
      { id: 'vscode-test', title: 'Test VS Code extension', ...sh('pnpm --filter superdoc-vscode-ext test') },
      {
        id: 'vscode-compile',
        title: 'Compile VS Code extension',
        ...sh('pnpm --filter superdoc-vscode-ext compile:ext'),
      },
    ],
  },
  {
    id: 'ci-sdk-mcp',
    title: 'CI SDK and MCP',
    workflow: resolveOrbitWorkflow(
      ['.github/workflows/ci-sdk.yml', '.github/workflows/ci-mcp.yml'],
      'SDK and MCP validation',
    ),
    defaultEnabled: cliAvailable && mcpAvailable && sdkAvailable,
    stages: [
      { id: 'sdk-generate-all', title: 'Generate SDK artifacts', ...sh('pnpm run generate:all') },
      { id: 'sdk-build-node', title: 'Build Node SDK', ...sh('pnpm --prefix packages/sdk/langs/node run build') },
      { id: 'sdk-validate', title: 'Validate SDK', ...sh('node packages/sdk/scripts/sdk-validate.mjs') },
      { id: 'mcp-build-superdoc', title: 'Build superdoc for MCP', ...sh('pnpm run build:superdoc') },
      { id: 'mcp-build-sdk', title: 'Build SDK for MCP', ...sh('pnpm --prefix packages/sdk/langs/node run build') },
      { id: 'mcp-build', title: 'Build MCP app', ...sh('pnpm --prefix apps/mcp run build') },
      { id: 'mcp-test', title: 'Test MCP app', ...sh('pnpm --prefix apps/mcp run test') },
    ],
  },
  {
    id: 'ci-dts-shadows',
    title: 'Check .d.ts shadows',
    workflow: resolveOrbitWorkflow('.github/workflows/declarations.yml', '.d.ts shadow validation'),
    stages: [{ id: 'check', title: 'Check .d.ts shadows', ...sh('node scripts/check-dts-shadows.mjs') }],
  },
  {
    id: 'ci-examples',
    title: 'CI Examples',
    workflow: resolveOrbitWorkflow('.github/workflows/examples.yml', 'extended examples validation'),
    stages: [
      { id: 'go-links', title: 'Check permanent example links', ...sh('pnpm run check:go-links') },
      { id: 'examples-reset', title: 'Verify the examples reset', ...sh('node scripts/check-examples.mjs') },
    ],
  },
];

function parseArgs(argv) {
  const options = {
    help: false,
    lane: '',
    list: false,
    plan: false,
    stage: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--plan' || arg === '--dry-run') {
      options.plan = true;
    } else if (arg === '--lane' || arg.startsWith('--lane=')) {
      options.lane = arg.includes('=') ? arg.split('=', 2)[1] : argv[++index];
    } else if (arg === '--stage' || arg.startsWith('--stage=')) {
      options.stage = arg.includes('=') ? arg.split('=', 2)[1] : argv[++index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`OSS local CI runner

Usage:
  pnpm ci:local                  run all reproducible OSS pull-request CI locally
  pnpm ci:local --plan           print the exact stages without running them
  pnpm ci:local --list           list lanes and stages
  pnpm ci:local --lane <lane>    run one lane
  pnpm ci:local --lane <lane> --stage <stage>

Lanes: ${enabledLanes()
    .map((lane) => lane.id)
    .join(', ')}
`);
}

function enabledLanes() {
  return LANES.filter((lane) => lane.defaultEnabled !== false);
}

function resolveLanes(options) {
  if (options.lane) {
    const lane = LANES.find((candidate) => candidate.id === options.lane);
    if (!lane) {
      throw new Error(`Unknown lane "${options.lane}". Lanes: ${LANES.map((candidate) => candidate.id).join(', ')}`);
    }
    return [lane];
  }
  return enabledLanes();
}

function resolveStages(lane, options) {
  if (!options.stage) {
    return lane.stages;
  }
  const stage = lane.stages.find((candidate) => candidate.id === options.stage);
  if (!stage) {
    throw new Error(`Unknown stage "${options.stage}" for lane "${lane.id}".`);
  }
  return [stage];
}

function printList() {
  for (const lane of LANES) {
    const suffix = lane.defaultEnabled === false ? ' (optional)' : '';
    console.log(`\n${lane.id}${suffix} - ${lane.title}`);
    console.log(`  workflow: ${lane.workflow}`);
    for (const stage of lane.stages) {
      console.log(`  - ${stage.id}: ${stage.title}`);
    }
  }
}

function printPlan(plans) {
  console.log('OSS local CI plan:');
  for (const { lane, stages } of plans) {
    console.log(`\n- lane ${lane.id}: ${lane.title}`);
    console.log(`  workflow: ${lane.workflow}`);
    for (const stage of stages) {
      console.log(`  ${stage.optional ? '~' : '*'} ${stage.id}: ${stage.command.join(' ')}  (cwd: ${stage.cwd})`);
      if (stage.requiredEnv.length > 0) {
        console.log(`    required env: ${stage.requiredEnv.join(', ')}`);
      }
      if (stage.note) {
        console.log(`    note: ${stage.note}`);
      }
    }
  }
  console.log('\nNon-local PR workflows not covered by this command:');
  for (const workflow of NON_LOCAL_WORKFLOWS) {
    console.log(`- ${workflow}`);
  }
  console.log('\n(* = blocking stage, ~ = GitHub non-blocking/continue-on-error equivalent)');
}

function verifyEnv(plans) {
  const missing = [];
  for (const { lane, stages } of plans) {
    for (const stage of stages) {
      for (const envName of stage.requiredEnv ?? []) {
        if (!process.env[envName]) {
          missing.push(`${lane.id}:${stage.id} requires ${envName}`);
        }
      }
    }
  }
  return missing;
}

// Report a missing tool as itself, before any stage runs. `bun` is not part of
// the documented Node and pnpm setup, so without this a contributor following
// CONTRIBUTING gets `bash: bun: command not found` partway through a lane and
// has to work out which stage needed it.
function verifyTools(plans) {
  const missing = [];
  const seen = new Set();
  for (const { lane, stages } of plans) {
    for (const stage of stages) {
      for (const tool of stage.requiredTools ?? []) {
        const key = `${lane.id}:${stage.id}:${tool}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (spawnSync('bash', ['-lc', `command -v ${tool}`], { stdio: 'ignore' }).status !== 0) {
          missing.push(`${lane.id}:${stage.id} requires \`${tool}\` on PATH (see CONTRIBUTING.md prerequisites)`);
        }
      }
    }
  }
  return missing;
}

function printToolchainNotes() {
  const nodeVersion = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  const packageManager = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).packageManager;
  console.log(`Expected local toolchain: node ${nodeVersion}, ${packageManager}, bun 1.3.13 for SuperDoc PR CI.`);
}

function runStage(lane, stage) {
  const cwd = path.resolve(repoRoot, stage.cwd);
  if (!existsSync(cwd)) {
    console.error(`Missing cwd for ${lane.id}:${stage.id}: ${stage.cwd}`);
    return 1;
  }
  console.log(`\n> [${lane.id}:${stage.id}] ${stage.title}`);
  console.log(`  ${stage.command.join(' ')}  (cwd: ${stage.cwd})`);
  const result = spawnSync(stage.command[0], stage.command.slice(1), {
    cwd,
    env: {
      ...process.env,
      ...stage.env,
    },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }
  if (options.list) {
    printList();
    return 0;
  }

  let plans;
  try {
    plans = resolveLanes(options).map((lane) => ({
      lane,
      stages: resolveStages(lane, options),
    }));
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  printToolchainNotes();

  if (options.plan) {
    printPlan(plans);
    return 0;
  }

  const missingEnv = verifyEnv(plans);
  if (missingEnv.length > 0) {
    console.error('Missing required environment for selected stages:');
    for (const issue of missingEnv) {
      console.error(`- ${issue}`);
    }
    return 2;
  }

  const missingTools = verifyTools(plans);
  if (missingTools.length > 0) {
    console.error('Missing required tools for selected stages:');
    for (const issue of missingTools) {
      console.error(`- ${issue}`);
    }
    return 2;
  }

  for (const plan of plans) {
    for (const stage of plan.stages) {
      const status = runStage(plan.lane, stage);
      if (status !== 0) {
        if (stage.optional) {
          console.warn(`Non-blocking stage failed: ${plan.lane.id}:${stage.id}`);
          continue;
        }
        console.error(`\nOSS local CI failed at ${plan.lane.id}:${stage.id} with exit ${status}.`);
        console.error(`Rerun: pnpm ci:local --lane ${plan.lane.id} --stage ${stage.id}`);
        return status;
      }
    }
    console.log(`\nOK lane ${plan.lane.id} passed`);
  }

  console.log('\nOK OSS local CI passed for all reproducible PR workflows.');
  console.log('Non-local GitHub/secrets workflows are listed by `pnpm ci:local --plan`.');
  return 0;
}

process.exit(main());
