import type { Config } from 'superdoc';

export const reviewOptions = {
  documentMode: 'suggesting',
  user: {
    name: 'Jordan Lee',
    email: 'jordan@example.com',
  },
} satisfies Pick<Config, 'documentMode' | 'user'>;
