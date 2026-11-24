import { afterEach, describe, it, expect, vi } from 'vite-plus/test';

const FLAG_ENV_VARS = [
  'SD_NUMBERING_SECTION_AWARE',
  'SD_BODY_PAGE_TOKENS',
  'SD_HEADER_FOOTER_PAGE_TOKENS',
  'SD_HF_DIGIT_BUCKETING',
  'SD_DEBUG_PAGE_TOKENS',
  'SD_DEBUG_HF_CACHE',
  'SD_DEBUG_LAYOUT_VERSION',
] as const;

const loadFlags = async (env: Partial<Record<(typeof FLAG_ENV_VARS)[number], string>> = {}) => {
  for (const name of FLAG_ENV_VARS) vi.stubEnv(name, env[name]);
  vi.resetModules();
  return import('../src/featureFlags');
};

describe('Feature Flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enables production flags and disables debug flags when no variable is set', async () => {
    const { getAllFeatureFlags } = await loadFlags();

    expect(getAllFeatureFlags()).toEqual({
      NUMBERING_SECTION_AWARE: true,
      BODY_PAGE_TOKENS: true,
      HEADER_FOOTER_PAGE_TOKENS: true,
      HF_DIGIT_BUCKETING: true,
      DEBUG_PAGE_TOKENS: false,
      DEBUG_HF_CACHE: false,
      DEBUG_LAYOUT_VERSION: false,
    });
  });

  it.each(['true', '1'])('turns a debug flag on when its variable is %s', async (value) => {
    const { isFeatureEnabled } = await loadFlags({ SD_DEBUG_PAGE_TOKENS: value, SD_DEBUG_HF_CACHE: value });

    expect(isFeatureEnabled('DEBUG_PAGE_TOKENS')).toBe(true);
    expect(isFeatureEnabled('DEBUG_HF_CACHE')).toBe(true);
  });

  it.each(['false', '0'])('turns a production flag off when its variable is %s', async (value) => {
    const { isFeatureEnabled } = await loadFlags({ SD_BODY_PAGE_TOKENS: value });

    expect(isFeatureEnabled('BODY_PAGE_TOKENS')).toBe(false);
    expect(isFeatureEnabled('HEADER_FOOTER_PAGE_TOKENS')).toBe(true);
  });

  it('keeps the default when a variable holds anything else', async () => {
    const { isFeatureEnabled } = await loadFlags({ SD_BODY_PAGE_TOKENS: 'no', SD_DEBUG_HF_CACHE: 'yes' });

    expect(isFeatureEnabled('BODY_PAGE_TOKENS')).toBe(true);
    expect(isFeatureEnabled('DEBUG_HF_CACHE')).toBe(false);
  });

  it('returns a copy of flags (not reference)', async () => {
    const { getAllFeatureFlags } = await loadFlags();
    const flags1 = getAllFeatureFlags();
    const flags2 = getAllFeatureFlags();

    expect(flags1).toEqual(flags2);
    expect(flags1).not.toBe(flags2);
  });
});
