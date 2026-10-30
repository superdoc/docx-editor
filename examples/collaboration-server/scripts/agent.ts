import { signExampleToken } from '../src/auth/example-token.ts';
import { joinAsAgent, REVIEW_AGENT, TextNotFoundError } from '../src/agent/review-agent.ts';

const [documentId, find, replacement] = process.argv.slice(2);
if (!documentId || !find || !replacement) {
  console.error('Usage: pnpm agent <documentId> "<text to find>" "<replacement>"');
  process.exit(1);
}

const secret = process.env.COLLABORATION_AUTH_SECRET;
const token =
  process.env.COLLABORATION_TOKEN ??
  (secret
    ? signExampleToken(secret, { sub: 'review-agent', documents: [documentId], exp: Math.floor(Date.now() / 1000) + 3600 })
    : undefined);
const waitMs = Number(process.env.AGENT_WAIT_MS ?? '600000');

const agent = await joinAsAgent({
  serverUrl: process.env.COLLABORATION_URL ?? 'ws://127.0.0.1:1234',
  documentId,
  token,
  identity: REVIEW_AGENT,
});
console.log(`${agent.identity.name} joined ${documentId}.`);

const stopping = new AbortController();
const stop = () => stopping.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

let exitCode = 0;
try {
  const suggestion = await agent.suggest(find, replacement);
  console.log(JSON.stringify({ event: 'suggested', ...suggestion }));

  const decision = await agent.waitForDecision(suggestion, { timeoutMs: waitMs, signal: stopping.signal });
  console.log(JSON.stringify({ event: 'decision', decision, trackedChangeIds: suggestion.trackedChangeIds }));
} catch (error) {
  exitCode = error instanceof TextNotFoundError ? 2 : 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await agent.leave();
  console.log(`${agent.identity.name} left ${documentId}.`);
}
process.exit(exitCode);
