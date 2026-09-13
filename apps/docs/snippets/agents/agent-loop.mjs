import { resolve } from 'node:path';
import { createSuperDocClient, createAgentToolkit } from '@superdoc/sdk';

const MAX_TURNS = 16;

// The tools this loop will dispatch. The core preset's dispatcher also accepts
// names it never advertises (`superdoc_execute_code`, `agent_apply`,
// `agent_verify`, `agent_operation`), which skip the tracked-mode guard below
// and return shapes this loop does not understand. A model that hallucinates
// one, or that is talked into it by content inside the document, must not reach
// them — so dispatch only what was advertised.
const ADVERTISED_TOOLS = new Set(['superdoc_inspect', 'superdoc_perform_action']);

// Tools that change the document. `superdoc_inspect` is read-only, so it is
// deliberately absent: it neither needs a change mode nor counts as a mutation.
const MUTATING_TOOLS = new Set(['superdoc_perform_action']);

// `superdoc_perform_action` advertises `changeMode` once for every action,
// but only some of them honor it — the rest ignore the argument and edit
// directly. Passing `changeMode: 'tracked'` to one of those looks compliant and
// silently produces an untracked edit, so this workflow allows only the actions
// that actually record a suggestion.
//
// `move_range` declares `changeMode` but is direct-only today: its own action
// hint says tracked mode fails without mutating, because a block-range deletion
// cannot be tracked. Allowing it would guarantee a failed run, so it is out.
const TRACKED_CAPABLE_ACTIONS = new Set([
  'add_list_items',
  'append_list',
  'apply_letter_spacing',
  'attach_numbering',
  'convert_list',
  'create_table',
  'delete_blocks',
  'delete_table',
  'delete_table_column',
  'delete_table_row',
  'delete_text',
  'fill_placeholders',
  'format_paragraph',
  'format_text',
  'insert_heading',
  'insert_paragraphs',
  'insert_table_column',
  'insert_table_row',
  'insert_toc',
  'move_text',
  'normalize_body_font_size',
  'replace_text',
  'rewrite_block',
  'set_font_family',
  'split_table',
]);

/**
 * One model turn, in OpenAI's Chat Completions shape.
 *
 * Return the assistant message unchanged from
 * `openai.chat.completions.create({ model, messages, tools })`. The loop reads
 * and writes that same shape, so nothing has to be translated in either
 * direction. For a provider with a different wire format, adapt it here and
 * where tool results are appended below.
 *
 * @typedef {{ id: string, type: 'function', function: { name: string, arguments: string } }} ToolCall
 * @typedef {{ role?: string, content?: string | null, tool_calls?: ToolCall[] }} AssistantMessage
 * @typedef {(input: { messages: unknown[], tools: unknown[] }) => Promise<AssistantMessage>} CallModel
 */

/**
 * Receipts carry action-specific evidence, so narrow the fields this loop reads.
 *
 * @param {unknown} value
 * @returns {{
 *   status?: string,
 *   verificationPassed?: boolean,
 *   preSnapshot?: { revision?: string },
 *   postSnapshot?: { revision?: string },
 * }}
 */
function asReceipt(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

/**
 * Whether a receipt is evidence that the document actually changed.
 *
 * Some actions accept `dryRun: true` and report success while explicitly
 * applying nothing, so a successful receipt is not proof of a mutation. When
 * the action reports both revisions, require them to differ; fall back to the
 * argument only when the receipt does not say.
 *
 * @param {ReturnType<typeof asReceipt>} receipt
 * @param {Record<string, unknown>} args
 */
function changedTheDocument(receipt, args) {
  const before = receipt.preSnapshot?.revision;
  const after = receipt.postSnapshot?.revision;
  if (before != null && after != null) return before !== after;
  return args.dryRun !== true;
}

/**
 * Edit a DOCX from a natural-language instruction, then save to a new file.
 *
 * Produces a tracked, reviewable draft. It does not prove the model completed
 * every part of the instruction — see the guide for why that needs an explicit
 * plan rather than receipt inspection.
 *
 * @param {{
 *   input: string,
 *   output: string,
 *   instruction: string,
 *   callModel: CallModel,
 *   author: { name: string, email?: string },
 * }} options `author` names this integration in tracked changes. Give each
 *   deployment its own, so a reviewer can tell them apart.
 */
export async function runAgent({ input, output, instruction, callModel, author }) {
  // Without a user, tracked changes are attributed to a generic "CLI" author
  // shared by every unattributed workflow. Naming the agent is what makes its
  // suggestions distinguishable, so the identity is a parameter rather than a
  // constant: copying this file should not copy someone else's author.
  const client = createSuperDocClient({ user: author });
  /** @type {Awaited<ReturnType<typeof client.open>> | undefined} */
  let doc;

  try {
    await client.connect();
    doc = await client.open({ doc: input });

    // One call keeps tools, prompt, and dispatch on the same preset. Assembling
    // them separately is how a tool surface and a system prompt drift apart.
    const { tools, systemPrompt, dispatch } = await createAgentToolkit({
      provider: 'openai',
      preset: 'core',
    });

    /** @type {unknown[]} */
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${instruction}\n\nMake every edit a tracked change so a reviewer can accept or reject it.`,
      },
    ];

    // A dispatched failure is terminal for the save: an edit that half-applied
    // leaves the document in a state no later receipt can prove was repaired.
    /** @type {string[]} */
    const failures = [];
    let completed = false;
    let mutations = 0;

    // Bounded: a model that keeps calling tools must still terminate.
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const reply = await callModel({ messages, tools });
      messages.push(reply);

      // No tool calls means the model considers the work finished.
      if (!reply.tool_calls?.length) {
        console.log(reply.content ?? '(no final message)');
        completed = true;
        break;
      }

      for (const call of reply.tool_calls) {
        /** @type {unknown} */
        let receipt;
        let label = call.function.name;
        let dispatched = false;

        try {
          const args = JSON.parse(call.function.arguments);
          if (typeof args.action === 'string') label = args.action;

          // Dispatch only what the toolkit advertised. The dispatcher itself is
          // more permissive, so this is the boundary that keeps a hallucinated
          // or injected tool name from reaching the document.
          if (!ADVERTISED_TOOLS.has(call.function.name)) {
            receipt = {
              status: 'failed',
              error: {
                code: 'TOOL_NOT_ADVERTISED',
                message: `"${call.function.name}" is not an available tool. Use one of: ${[...ADVERTISED_TOOLS].join(', ')}.`,
              },
            };
            console.error(`${call.function.name}: rejected, not an advertised tool`);
            // Unlike a correctable argument error, this is a request for
            // something that does not exist. Treat it as unfinished work so a
            // run cannot end on it and still save.
            failures.push(`${call.function.name} is not an available tool`);
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(receipt) });
            continue;
          }

          // The instruction asks for tracked changes, but `changeMode` is
          // optional and defaults to a direct edit, so a model that omits it
          // silently rewrites the document. Refuse the call instead of letting
          // the run produce an untracked edit it promised would be reviewable.
          if (MUTATING_TOOLS.has(call.function.name)) {
            const refusal =
              args.changeMode !== 'tracked'
                ? 'Every edit must set changeMode: "tracked". Retry this action with that argument.'
                : !TRACKED_CAPABLE_ACTIONS.has(args.action)
                  ? `The action "${args.action}" ignores changeMode and always edits directly. Use a tracked-capable action instead.`
                  : undefined;

            if (refusal) {
              // The call never reached the document, so this is a correction
              // the model can act on rather than a failed edit.
              receipt = { status: 'failed', error: { code: 'CHANGE_MODE_REQUIRED', message: refusal } };
              console.error(`${label}: rejected, ${refusal}`);
              messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(receipt) });
              continue;
            }
          }

          dispatched = true;
          receipt = await dispatch(doc, call.function.name, args);
          const parsed = asReceipt(receipt);
          const { status, verificationPassed } = parsed;
          console.log(`${label}: ${status ?? 'ok'}`);

          // A returned receipt is not a successful one. `partial` means some
          // edits applied and some did not, which must never read as success.
          if (status != null && status !== 'ok') {
            failures.push(`${label} reported ${status}`);
          } else if (verificationPassed === false) {
            console.warn('  verification did not pass');
            failures.push(`${label} failed verification`);
          } else if (call.function.name !== 'superdoc_inspect' && changedTheDocument(parsed, args)) {
            // superdoc_inspect reads without changing anything, and a dry run
            // reports success while applying nothing, so neither is evidence
            // that the edit happened.
            mutations += 1;
          }
        } catch (error) {
          // Hand the failure back to the model rather than throwing: a bad
          // argument is something it can correct on the next turn.
          const { code, message } = /** @type {{ code?: string, message: string }} */ (error);
          receipt = { status: 'failed', error: { code, message } };
          console.error(`${label}: ${code ?? message}`);

          // A throw from dispatch may have applied part of the edit before
          // failing. A throw before it (malformed arguments) never reached the
          // document, so the model can still correct that one.
          if (dispatched) failures.push(`${label} threw ${code ?? message}`);
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(receipt) });
      }
    }

    // Only save work that finished cleanly. Running out of turns means the
    // model never signalled completion, a dispatched failure means the document
    // is in a state nobody asked for, and zero mutations means there is nothing
    // to write — saving any of them produces a plausible-looking file that no
    // receipt ever justified.
    if (!completed) {
      throw new Error(`Agent stopped after ${MAX_TURNS} turns without completing. Nothing was saved.`);
    }
    if (failures.length > 0) {
      throw new Error(`Agent finished with unresolved failures: ${failures.join('; ')}. Nothing was saved.`);
    }
    if (mutations === 0) {
      throw new Error('Agent completed without applying any change. Nothing was saved.');
    }

    // Write to a separate path so the source survives a bad run. No `force`:
    // save refuses an existing output rather than overwriting it, which turns a
    // path typo into an error instead of destroying whatever was already there.
    if (resolve(output) === resolve(input)) {
      throw new Error(`Output path is the same file as the input (${input}). Nothing was saved.`);
    }
    await doc.save({ out: output });
    console.log(`Saved: ${output}`);
  } finally {
    // Cleanup is best-effort so a close failure cannot mask the real outcome.
    if (doc) await doc.close({ discard: true }).catch((error) => console.warn(`close failed: ${error.message}`));
    await client.dispose().catch((error) => console.warn(`dispose failed: ${error.message}`));
  }
}
