export const CUSTOM_COMMAND_SHORTCUT = 'Ctrl-Shift-Y';

type CommandShortcutEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'>;

export function matchesCustomCommandShortcut(event: CommandShortcutEvent) {
  // Match the advertised character, not a US physical key position: excluding Alt already
  // rules out the AltGr composition that makes `event.key` unreliable for Ctrl-Alt bindings.
  // An IME can emit a matching keydown mid-composition; running the command then interrupts
  // the composition and inserts at its transient caret.
  if (event.isComposing) return false;
  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'y';
}
