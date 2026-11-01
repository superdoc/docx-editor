interface ThrottleOptions {
  leading?: boolean;
  trailing?: boolean;
}

type Throttled<Args extends unknown[], Result> = ((...args: Args) => Result | undefined) & { cancel: () => void };

const sanitizeNumber = (value: unknown, defaultNumber: number): number => {
  const parsed = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return isNaN(parsed) ? defaultNumber : parsed;
};

const throttle = <Args extends unknown[], Result>(
  func: (...args: Args) => Result,
  wait: number,
  options: ThrottleOptions = {},
): Throttled<Args, Result> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let args: Args | undefined;
  let result: Result | undefined;
  let previous = 0;

  const later = () => {
    previous = options.leading === false ? 0 : Date.now();
    timeout = undefined;
    if (args) result = func(...args);
    if (!timeout) args = undefined;
  };

  const throttled = (...callArgs: Args) => {
    const _now = Date.now();
    if (!previous && options.leading === false) previous = _now;
    const remaining = wait - (_now - previous);
    args = callArgs;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      previous = _now;
      result = func(...callArgs);
      if (!timeout) args = undefined;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };

  throttled.cancel = function () {
    clearTimeout(timeout);
    previous = 0;
    timeout = args = undefined;
  };
  return throttled;
};

export { sanitizeNumber, throttle };
