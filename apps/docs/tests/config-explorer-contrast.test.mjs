import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const css = await readFile(new URL('../components/docs-components.css', import.meta.url), 'utf8');

function customProperty(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `--${name} is not defined as a hex colour`);
  return match[1];
}

function colourFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `${selector} is not defined`);
  const colour = rule[1].match(/color:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(colour, `${selector} does not set a hex colour`);
  return colour[1];
}

function rgb(hex) {
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(1 + index, 3 + index), 16));
}

function luminance(hex) {
  const [red, green, blue] = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('shared demo comment text stays readable on the pinned light cards', () => {
  const selector = ".sd-editor-demo [data-sd-part='comment-thread']";
  const foreground = colourFor(selector);
  assert.ok(contrast(foreground, '#ffffff') >= 4.5);
  assert.ok(contrast(foreground, '#f0f0f0') >= 4.5);
  assert.match(css, /\[data-sd-part='comment-thread'\]\s*\{[^}]*--sd-ui-text:\s*#202124/);
  for (const name of ['author', 'body', 'option']) {
    assert.equal(customProperty(`sd-ui-comments-${name}-text`), foreground);
  }
});

test('config explorer text clears the WCAG AA contrast floor', () => {
  const surface = customProperty('sd-code-block-surface');
  const bar = customProperty('sd-code-block-bar');
  const colours = [
    ['chrome', customProperty('sd-code-block-muted'), bar],
    ['heading', customProperty('sd-config-detail-heading'), surface],
    ['body', customProperty('sd-config-detail-body'), surface],
    ['label', customProperty('sd-config-detail-label'), surface],
    ['link', customProperty('sd-config-detail-link'), surface],
    [
      'required badge',
      customProperty('sd-config-required'),
      customProperty('sd-config-required-background'),
    ],
    ['warning badge', customProperty('sd-config-warning'), customProperty('sd-config-warning-background')],
    ['property', colourFor('.sd-config-explorer-field-name'), surface],
    ['keyword', colourFor('.sd-config-explorer-token-keyword'), surface],
    ['string', colourFor('.sd-config-explorer-token-string'), surface],
    ['type', colourFor('.sd-config-explorer-token-type'), surface],
    ['comment', colourFor('.sd-config-explorer-token-comment'), surface],
  ];

  for (const [label, foreground, background] of colours) {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= 4.5, `${label} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`);
  }
});
