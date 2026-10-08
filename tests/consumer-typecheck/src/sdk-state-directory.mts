import {
  createSuperDocClient,
  SuperDocCliError,
  type SuperDocClientOptions,
} from '../../../packages/sdk/langs/node/dist/index.js';

const options: SuperDocClientOptions = {
  stateDir: '/tmp/sdk-state',
  env: { SUPERDOC_CLI_STATE_DIR: '/tmp/other-state' },
};
const client = createSuperDocClient(options);
client.connect() satisfies Promise<void>;
client.dispose() satisfies Promise<void>;
const error = new SuperDocCliError('state failure', {
  code: 'STATE_DIRECTORY_UNWRITABLE',
  details: { path: options.stateDir },
});
error.code satisfies string;
// @ts-expect-error stateDir accepts a path string.
createSuperDocClient({ stateDir: 42 });
