import { describe, it, expect, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import PasswordPromptSurface from './PasswordPromptSurface.vue';
import type {
  PasswordPromptAttemptResult,
  PasswordPromptHandle,
  ResolvedPasswordPromptTexts,
  SurfaceComponentProps,
} from '../../core/types/index.js';
import { surfaceRequest } from '../../test-support/surface-request.js';

const DEFAULT_TEXTS: ResolvedPasswordPromptTexts = {
  title: 'Password Required',
  invalidTitle: 'Incorrect Password',
  description: 'This document is password protected. Enter the password to open it.',
  placeholder: 'Enter password',
  inputAriaLabel: 'Document password',
  submitLabel: 'Open',
  cancelLabel: 'Cancel',
  busyLabel: 'Decrypting\u2026',
  invalidMessage: 'Incorrect password. Please try again.',
  timeoutMessage: 'Timed out while decrypting. Please try again.',
  genericErrorMessage: 'Unable to decrypt this document.',
};

type PromptOverrides = {
  passwordPrompt?: Partial<PasswordPromptHandle>;
  texts?: Partial<ResolvedPasswordPromptTexts>;
  props?: Partial<SurfaceComponentProps>;
};

const mountPrompt = (overrides: PromptOverrides = {}) => {
  const passwordPrompt: PasswordPromptHandle = {
    documentId: 'doc-1',
    errorCode: 'DOCX_PASSWORD_REQUIRED',
    texts: { ...DEFAULT_TEXTS },
    attemptPassword: vi.fn(async () => ({ success: true })),
    ...overrides.passwordPrompt,
  };

  // Allow overriding individual texts without replacing the whole object
  if (overrides.texts) {
    passwordPrompt.texts = { ...DEFAULT_TEXTS, ...overrides.texts };
  }

  return mount(PasswordPromptSurface, {
    props: {
      surfaceId: 'test-1',
      mode: 'dialog',
      request: surfaceRequest(),
      resolve: vi.fn(),
      close: vi.fn(),
      passwordPrompt,
      ...overrides.props,
    },
  });
};

describe('PasswordPromptSurface', () => {
  it('renders password input, cancel, and submit buttons', () => {
    const wrapper = mountPrompt();

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('.sd-password-prompt__btn--cancel').exists()).toBe(true);
    expect(wrapper.find('.sd-password-prompt__btn--submit').exists()).toBe(true);
  });

  it('heading has a deterministic id based on surfaceId', () => {
    const wrapper = mountPrompt();
    const heading = wrapper.find('.sd-password-prompt__heading');
    expect(heading.attributes('id')).toBe('sd-password-prompt-heading-test-1');
  });

  it('submit button is disabled when password is empty', () => {
    const wrapper = mountPrompt();
    const submit = wrapper.find('.sd-password-prompt__btn--submit');
    expect(submit.attributes('disabled')).toBeDefined();
  });

  it('submit button is enabled after typing a password', async () => {
    const wrapper = mountPrompt();
    await wrapper.find('input[type="password"]').setValue('secret');
    const submit = wrapper.find('.sd-password-prompt__btn--submit');
    expect(submit.attributes('disabled')).toBeUndefined();
  });

  it('calls attemptPassword with the entered password on submit', async () => {
    const attemptPassword = vi.fn(async () => ({ success: true }));
    const resolve = vi.fn();
    const wrapper = mountPrompt({
      passwordPrompt: { attemptPassword },
      props: { resolve },
    });

    await wrapper.find('input[type="password"]').setValue('my-pass');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');

    expect(attemptPassword).toHaveBeenCalledWith('my-pass');
  });

  it('shows busy state while attemptPassword is pending', async () => {
    let resolveAttempt: ((result: PasswordPromptAttemptResult) => void) | undefined;
    const attemptPassword = vi.fn(
      () =>
        new Promise<PasswordPromptAttemptResult>((r) => {
          resolveAttempt = r;
        }),
    );
    const wrapper = mountPrompt({ passwordPrompt: { attemptPassword } });

    await wrapper.find('input[type="password"]').setValue('pass');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();

    expect(wrapper.find('input[type="password"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.sd-password-prompt__btn--submit').text()).toContain('Decrypting');

    resolveAttempt!({ success: true });
    await nextTick();
  });

  it('calls resolve() on successful password attempt', async () => {
    const resolve = vi.fn();
    const attemptPassword = vi.fn(async () => ({ success: true }));
    const wrapper = mountPrompt({
      passwordPrompt: { attemptPassword },
      props: { resolve },
    });

    await wrapper.find('input[type="password"]').setValue('correct');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();
    await nextTick();

    expect(resolve).toHaveBeenCalledWith({ password: 'correct' });
  });

  it('shows error message on failed attempt and re-enables input', async () => {
    const attemptPassword = vi.fn(async () => ({
      success: false,
      errorCode: 'DOCX_PASSWORD_INVALID',
    }));
    const wrapper = mountPrompt({ passwordPrompt: { attemptPassword } });

    await wrapper.find('input[type="password"]').setValue('wrong');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('.sd-password-prompt__error').exists()).toBe(true);
    expect(wrapper.find('.sd-password-prompt__error').text()).toContain('Incorrect password');
    expect(wrapper.find('input[type="password"]').attributes('disabled')).toBeUndefined();
  });

  it('calls close() on cancel', async () => {
    const close = vi.fn();
    const wrapper = mountPrompt({ props: { close } });

    await wrapper.find('.sd-password-prompt__btn--cancel').trigger('click');

    expect(close).toHaveBeenCalledWith('user-cancelled');
  });

  it('shows error immediately when initial errorCode is DOCX_PASSWORD_INVALID', () => {
    const wrapper = mountPrompt({ passwordPrompt: { errorCode: 'DOCX_PASSWORD_INVALID' } });

    expect(wrapper.find('.sd-password-prompt__error').exists()).toBe(true);
    expect(wrapper.find('.sd-password-prompt__error').text()).toContain('Incorrect password');
  });

  it('does not show error initially for DOCX_PASSWORD_REQUIRED', () => {
    const wrapper = mountPrompt({ passwordPrompt: { errorCode: 'DOCX_PASSWORD_REQUIRED' } });

    expect(wrapper.find('.sd-password-prompt__error').exists()).toBe(false);
  });

  it('uses custom button labels from texts', () => {
    const wrapper = mountPrompt({
      texts: { submitLabel: 'Unlock', cancelLabel: 'Nah' },
    });

    expect(wrapper.find('.sd-password-prompt__btn--submit').text()).toBe('Unlock');
    expect(wrapper.find('.sd-password-prompt__btn--cancel').text()).toBe('Nah');
  });

  it('shows default title heading for PASSWORD_REQUIRED', () => {
    const wrapper = mountPrompt({ passwordPrompt: { errorCode: 'DOCX_PASSWORD_REQUIRED' } });
    expect(wrapper.find('.sd-password-prompt__heading').text()).toBe('Password Required');
  });

  it('shows invalidTitle heading for PASSWORD_INVALID', () => {
    const wrapper = mountPrompt({
      passwordPrompt: { errorCode: 'DOCX_PASSWORD_INVALID' },
      texts: { invalidTitle: 'Wrong!' },
    });
    expect(wrapper.find('.sd-password-prompt__heading').text()).toBe('Wrong!');
  });

  it('updates heading to invalidTitle after failed retry', async () => {
    const attemptPassword = vi.fn(async () => ({
      success: false,
      errorCode: 'DOCX_PASSWORD_INVALID',
    }));
    const wrapper = mountPrompt({
      passwordPrompt: { attemptPassword },
      texts: { title: 'Enter password', invalidTitle: 'Try again' },
    });

    expect(wrapper.find('.sd-password-prompt__heading').text()).toBe('Enter password');

    await wrapper.find('input[type="password"]').setValue('wrong');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('.sd-password-prompt__heading').text()).toBe('Try again');
  });

  it('submits on Enter without using a native form', async () => {
    const attemptPassword = vi.fn(async () => ({ success: true }));
    const wrapper = mountPrompt({ passwordPrompt: { attemptPassword } });

    await wrapper.find('input[type="password"]').setValue('secret');
    await wrapper.find('.sd-password-prompt').trigger('keydown.enter');

    expect(attemptPassword).toHaveBeenCalledWith('secret');
  });

  it('uses custom description text', () => {
    const wrapper = mountPrompt({ texts: { description: 'Unlock this file' } });
    expect(wrapper.find('.sd-password-prompt__description').text()).toBe('Unlock this file');
  });

  it('uses custom placeholder text', () => {
    const wrapper = mountPrompt({ texts: { placeholder: 'Type here...' } });
    expect(wrapper.find('input[type="password"]').attributes('placeholder')).toBe('Type here...');
  });

  it('uses custom aria-label on input', () => {
    const wrapper = mountPrompt({ texts: { inputAriaLabel: 'File password' } });
    expect(wrapper.find('input[type="password"]').attributes('aria-label')).toBe('File password');
  });

  it('uses custom busy label', async () => {
    let resolveAttempt: ((result: PasswordPromptAttemptResult) => void) | undefined;
    const attemptPassword = vi.fn(
      () =>
        new Promise<PasswordPromptAttemptResult>((r) => {
          resolveAttempt = r;
        }),
    );
    const wrapper = mountPrompt({
      passwordPrompt: { attemptPassword },
      texts: { busyLabel: 'Working...' },
    });

    await wrapper.find('input[type="password"]').setValue('pass');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();

    expect(wrapper.find('.sd-password-prompt__btn--submit').text()).toBe('Working...');

    resolveAttempt!({ success: true });
    await nextTick();
  });

  it('shows custom timeout message', async () => {
    const attemptPassword = vi.fn(async () => ({
      success: false,
      errorCode: 'timeout',
    }));
    const wrapper = mountPrompt({
      passwordPrompt: { attemptPassword },
      texts: { timeoutMessage: 'Too slow!' },
    });

    await wrapper.find('input[type="password"]').setValue('pass');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('.sd-password-prompt__error').text()).toBe('Too slow!');
  });

  it('shows custom generic error message', async () => {
    const attemptPassword = vi.fn(async () => ({
      success: false,
      errorCode: 'unknown',
    }));
    const wrapper = mountPrompt({
      passwordPrompt: { attemptPassword },
      texts: { genericErrorMessage: 'Something broke' },
    });

    await wrapper.find('input[type="password"]').setValue('pass');
    await wrapper.find('.sd-password-prompt__btn--submit').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('.sd-password-prompt__error').text()).toBe('Something broke');
  });
});
