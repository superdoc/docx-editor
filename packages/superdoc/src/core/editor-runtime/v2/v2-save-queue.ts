// V2 hosts reject overlapping saves. The shell's save and export facades
// share this queue so a save followed immediately by export can finish both.
export function createV2SaveQueue<Options, Result>(save: (options?: Options) => Promise<Result>) {
  let pending: Promise<void> | null = null;
  return (options?: Options): Promise<Result> => {
    const previous = pending;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    pending = current;
    const run = async () => {
      try {
        return await save(options);
      } finally {
        if (pending === current) pending = null;
        release();
      }
    };
    // Starting an idle save inline preserves the host's save-in-progress guard
    // against a replaceFile() call made later in the same turn.
    return previous ? previous.then(run) : run();
  };
}
