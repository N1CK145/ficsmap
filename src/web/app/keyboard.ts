/** Input types that take typed text: a shortcut key there is text, not a command. */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date', 'datetime-local', 'month', 'time', 'week',
]);

/** Whether a key press belongs to a text field, a select or editable content. Checkboxes and buttons are not. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * Whether a page-wide shortcut (Q, Esc, Ctrl+Z on window) must leave this key alone: it is typed
 * text, something else handled it already, or a modal dialog is open (its keys are its own).
 */
export function shouldIgnoreGlobalKey(e: KeyboardEvent): boolean {
  return e.defaultPrevented || isEditableTarget(e.target) || document.querySelector('dialog[open]') !== null;
}
