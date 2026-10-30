import { parseArgs } from 'node:util';
import { signExampleToken } from '../src/auth/example-token.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'read-only': { type: 'boolean', default: false },
    hours: { type: 'string', default: '1' },
  },
});

const [user, documents] = positionals;
const secret = process.env.COLLABORATION_AUTH_SECRET ?? '';
const hours = Number(values.hours);
if (!user || !documents || secret.length < 32 || !(hours > 0)) {
  console.error('Usage: COLLABORATION_AUTH_SECRET=... pnpm token <user> <documentId[,documentId] | *> [--read-only] [--hours 1]');
  process.exit(1);
}

console.log(
  signExampleToken(secret, {
    sub: user,
    documents: documents === '*' ? '*' : documents.split(','),
    readOnly: values['read-only'],
    exp: Math.floor(Date.now() / 1000) + hours * 3600,
  }),
);
