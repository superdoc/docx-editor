import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
const target = { kind: 'block', nodeType: 'listItem', nodeId: 'item-1' } as const;
const level: Parameters<DocumentApi['lists']['applyStyle']>[0]['style']['levels'][number] = {
  level: 0,
  numFmt: 'custom',
  customFormat: '0001, 0002, 0003, ...',
  lvlText: '[%1]',
};
const applied: ReturnType<DocumentApi['lists']['applyStyle']> = doc.lists.applyStyle({
  target,
  style: { version: 1, levels: [level] },
});
const numbering: Parameters<DocumentApi['lists']['setLevelNumbering']>[0] = {
  target,
  level: 0,
  numFmt: 'custom',
  customFormat: level.customFormat,
  lvlText: '[%1]',
};
const changed: ReturnType<DocumentApi['lists']['setLevelNumbering']> = doc.lists.setLevelNumbering(numbering);
const captured = doc.lists.captureTemplate({ target });
if (captured.success) {
  const format: string | undefined = captured.template.levels[0]?.customFormat;
  doc.lists.applyTemplate({ target, template: captured.template });
  void format;
}
const read = doc.lists.getStyle({ target });
if (read.success) {
  const format: string | undefined = read.style.levels[0]?.customFormat;
  doc.lists.create({
    mode: 'fromParagraphs',
    target: { kind: 'block', nodeType: 'paragraph', nodeId: 'paragraph-1' },
    style: read.style,
  });
  void format;
}
void applied;
void changed;
