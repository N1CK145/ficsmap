import { isEditableTarget, shouldIgnoreGlobalKey } from '../../src/web/app/keyboard.js';

const input = (type: string) => Object.assign(document.createElement('input'), { type });
const key = (target: EventTarget, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  return e;
};

describe('isEditableTarget', () => {
  it.each(['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date'])('is true for a %s input', type => {
    expect(isEditableTarget(input(type))).toBe(true);
  });

  it.each(['checkbox', 'radio', 'button', 'submit', 'range'])('is false for a %s input', type => {
    expect(isEditableTarget(input(type))).toBe(false);
  });

  it('is true for textarea, select and contenteditable, false for a button', () => {
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    host.append(child);
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('shouldIgnoreGlobalKey', () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('lets a plain key on the page through', () => {
    expect(shouldIgnoreGlobalKey(key(document.body))).toBe(false);
  });

  it('ignores keys in text fields, handled keys, and keys while a modal dialog is open', () => {
    expect(shouldIgnoreGlobalKey(key(input('text')))).toBe(true);
    const handled = key(document.body);
    handled.preventDefault();
    expect(shouldIgnoreGlobalKey(handled)).toBe(true);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    expect(shouldIgnoreGlobalKey(key(document.body))).toBe(true);
  });
});
