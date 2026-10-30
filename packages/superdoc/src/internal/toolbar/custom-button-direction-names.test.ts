import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { BuiltInToolbar } from './built-in-toolbar.js';
import { createSuperDocUI } from '../../public/ui/create-super-doc-ui.js';
import type { SuperDocLike, SuperDocUI } from '../../public/ui/types.js';
import { createHighContrastMode } from '../../composables/use-high-contrast-mode.js';

const controllers: SuperDocUI[] = [];
afterEach(() => {
  for (const ui of controllers.splice(0)) ui.destroy?.();
});

function makeHost() {
  const host: Record<string, unknown> = {
    activeEditor: { id: 'editor-1' },
    config: { documentMode: 'editing', rulers: false, layoutEngineOptions: { showFormattingMarks: false } },
    fonts: { getDocumentFontOptions: () => [] },
    on: () => {},
    off: () => {},
    emit: () => {},
  };
  let ui: SuperDocUI | null = null;
  Object.defineProperty(host, 'ui', {
    get() {
      if (!ui) {
        ui = createSuperDocUI({ superdoc: host as SuperDocLike });
        controllers.push(ui);
      }
      return ui;
    },
  });
  return host;
}

describe('custom toolbar buttons named like direction commands', () => {
  it.each(['directionLtr', 'directionRtl'])('keeps a callback button named %s enabled and inactive', (name) => {
    const toolbar = new BuiltInToolbar({
      highContrastMode: createHighContrastMode(),
      superdoc: makeHost(),
      hideButtons: false,
      customButtons: [{ type: 'button', name, tooltip: name, icon: '<svg />', command: vi.fn() }],
    });
    toolbar.snapshot = {
      commands: {
        'direction-ltr': { enabled: false, disabled: true, active: true, supported: true },
        'direction-rtl': { enabled: false, disabled: true, active: true, supported: true },
      },
    };
    toolbar.updateToolbarState();

    const item = toolbar.getToolbarItemByName(name);
    expect({ disabled: item?.disabled.value, active: item?.active.value }).toEqual({ disabled: false, active: false });
    toolbar.destroy();
  });

  it.each([
    ['direction-ltr', 'directionLtr'],
    ['direction-rtl', 'directionRtl'],
  ])('still follows %s for a custom button that names that command', (command, name) => {
    const toolbar = new BuiltInToolbar({
      highContrastMode: createHighContrastMode(),
      superdoc: makeHost(),
      hideButtons: false,
      customButtons: [{ type: 'button', name, tooltip: name, icon: '<svg />', command }],
    });
    toolbar.snapshot = {
      commands: { [command]: { enabled: false, disabled: true, active: true, supported: true } },
    };
    toolbar.updateToolbarState();

    const item = toolbar.getToolbarItemByName(name);
    expect({ disabled: item?.disabled.value, active: item?.active.value }).toEqual({ disabled: true, active: true });
    toolbar.destroy();
  });
});
