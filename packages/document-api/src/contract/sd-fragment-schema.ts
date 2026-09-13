type JsonSchema = Record<string, unknown>;

function objectSchema(properties: Record<string, JsonSchema>, required: readonly string[] = []): JsonSchema {
  const schema: JsonSchema = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) schema.required = [...required];
  return schema;
}

function arraySchema(items: JsonSchema, minItems?: number): JsonSchema {
  return { type: 'array', items, ...(minItems === undefined ? {} : { minItems }) };
}

function ref(name: string): JsonSchema {
  return { $ref: `#/$defs/${name}` };
}

const idProperty = { id: { type: 'string' } } satisfies Record<string, JsonSchema>;
const rgbColorSchema = objectSchema(
  {
    model: { const: 'rgb' },
    value: { type: 'string', pattern: '^[0-9A-Fa-f]{6}$' },
  },
  ['model', 'value'],
);

const inboundTableCellSchema = objectSchema(
  {
    ...idProperty,
    props: ref('SDInboundCellProps'),
    colSpan: { type: 'integer', minimum: 1 },
    rowSpan: { type: 'integer', minimum: 1 },
    header: { type: 'boolean' },
    content: arraySchema(ref('SDInboundContentNode'), 1),
  },
  ['content'],
);
const inboundTableRowSchema = objectSchema(
  {
    ...idProperty,
    cells: arraySchema(inboundTableCellSchema, 1),
  },
  ['cells'],
);
const inboundTableSchema = objectSchema(
  {
    ...idProperty,
    kind: { const: 'table' },
    table: objectSchema(
      {
        rows: arraySchema(inboundTableRowSchema, 1),
      },
      ['rows'],
    ),
  },
  ['kind', 'table'],
);

export const SD_CONVERSION_FRAGMENT_SCHEMA_DEFS: Record<string, JsonSchema> = {
  SDInboundColor: rgbColorSchema,
  SDInboundUnderline: objectSchema({ style: { const: 'single' } }),
  SDInboundShading: objectSchema({
    pattern: { type: 'string' },
    fill: ref('SDInboundColor'),
    color: ref('SDInboundColor'),
  }),
  SDInboundRunProps: objectSchema({
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: ref('SDInboundUnderline'),
    strikethrough: { type: 'boolean' },
    color: ref('SDInboundColor'),
    highlight: { const: 'yellow' },
    shading: ref('SDInboundShading'),
    fontSize: { type: 'number', exclusiveMinimum: 0 },
    fontFamily: { type: 'string', minLength: 1 },
    verticalAlign: { enum: ['baseline', 'superscript', 'subscript'] },
  }),
  SDInboundParagraphIndent: objectSchema({
    start: { type: 'number' },
    end: { type: 'number' },
    left: { type: 'number' },
    right: { type: 'number' },
    firstLine: { type: 'number' },
    hanging: { type: 'number' },
  }),
  SDInboundParagraphSpacing: objectSchema({
    before: { type: 'number' },
    after: { type: 'number' },
    line: { type: 'number' },
    lineRule: { enum: ['auto', 'exact', 'atLeast'] },
  }),
  SDInboundParagraphProps: objectSchema({
    alignment: { enum: ['left', 'center', 'right', 'justify'] },
    indent: ref('SDInboundParagraphIndent'),
    spacing: ref('SDInboundParagraphSpacing'),
  }),
  SDInboundCellPadding: objectSchema({
    top: { type: 'number', minimum: 0 },
    right: { type: 'number', minimum: 0 },
    bottom: { type: 'number', minimum: 0 },
    left: { type: 'number', minimum: 0 },
  }),
  SDInboundCellProps: objectSchema({
    verticalAlign: { enum: ['top', 'center', 'bottom'] },
    shading: ref('SDInboundColor'),
    padding: ref('SDInboundCellPadding'),
  }),
  SDInboundRun: objectSchema(
    {
      ...idProperty,
      kind: { const: 'run' },
      run: objectSchema(
        {
          text: { type: 'string' },
          styleRef: { type: 'string' },
          props: ref('SDInboundRunProps'),
        },
        ['text'],
      ),
    },
    ['kind', 'run'],
  ),
  SDInboundLineBreak: objectSchema(
    {
      ...idProperty,
      kind: { const: 'lineBreak' },
      lineBreak: objectSchema({}),
    },
    ['kind', 'lineBreak'],
  ),
  SDInboundHyperlinkLeaf: {
    oneOf: [ref('SDInboundRun'), ref('SDInboundLineBreak')],
  },
  SDInboundHyperlink: objectSchema(
    {
      ...idProperty,
      kind: { const: 'hyperlink' },
      hyperlink: objectSchema(
        {
          href: { type: 'string', pattern: '^(?:[Hh][Tt][Tt][Pp][Ss]?:|[Mm][Aa][Ii][Ll][Tt][Oo]:)' },
          tooltip: { type: 'string' },
          targetFrame: { type: 'string' },
          history: { type: 'boolean' },
          inlines: arraySchema(ref('SDInboundHyperlinkLeaf')),
        },
        ['href', 'inlines'],
      ),
    },
    ['kind', 'hyperlink'],
  ),
  SDInboundInlineNode: {
    oneOf: [ref('SDInboundRun'), ref('SDInboundHyperlink'), ref('SDInboundLineBreak')],
  },
  SDInboundParagraph: objectSchema(
    {
      ...idProperty,
      kind: { const: 'paragraph' },
      paragraph: objectSchema(
        {
          inlines: arraySchema(ref('SDInboundInlineNode')),
          styleRef: { type: 'string' },
          props: ref('SDInboundParagraphProps'),
        },
        ['inlines'],
      ),
    },
    ['kind', 'paragraph'],
  ),
  SDInboundHeading: objectSchema(
    {
      ...idProperty,
      kind: { const: 'heading' },
      heading: objectSchema(
        {
          level: { type: 'integer', minimum: 1, maximum: 9 },
          inlines: arraySchema(ref('SDInboundInlineNode')),
          styleRef: { type: 'string' },
          props: ref('SDInboundParagraphProps'),
        },
        ['level', 'inlines'],
      ),
    },
    ['kind', 'heading'],
  ),
  SDInboundListLevel: objectSchema(
    {
      level: { type: 'integer', minimum: 0, maximum: 8 },
      kind: { enum: ['ordered', 'bullet'] },
      format: { enum: ['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman'] },
      text: { type: 'string', pattern: '^%[1-9][.)]$' },
      start: { type: 'integer', minimum: 1 },
    },
    ['level', 'kind'],
  ),
  SDInboundListItem: objectSchema(
    {
      ...idProperty,
      level: { type: 'integer', minimum: 0, maximum: 8 },
      path: arraySchema({ type: 'integer', minimum: 0 }),
      marker: { type: 'string' },
      content: arraySchema(ref('SDInboundContentNode'), 1),
    },
    ['level', 'content'],
  ),
  SDInboundList: objectSchema(
    {
      ...idProperty,
      kind: { const: 'list' },
      list: objectSchema(
        {
          levels: arraySchema(ref('SDInboundListLevel')),
          items: arraySchema(ref('SDInboundListItem'), 1),
        },
        ['items'],
      ),
    },
    ['kind', 'list'],
  ),
  SDInboundTableCell: inboundTableCellSchema,
  SDInboundTableRow: inboundTableRowSchema,
  SDInboundTable: inboundTableSchema,
  SDInboundHorizontalRule: objectSchema(
    {
      ...idProperty,
      kind: { const: 'horizontalRule' },
      horizontalRule: objectSchema({}),
    },
    ['kind', 'horizontalRule'],
  ),
  SDInboundContentNode: {
    oneOf: [
      ref('SDInboundParagraph'),
      ref('SDInboundHeading'),
      ref('SDInboundList'),
      ref('SDInboundTable'),
      ref('SDInboundHorizontalRule'),
    ],
  },
};

const conversionContentNodeSchema: JsonSchema = {
  oneOf: [
    SD_CONVERSION_FRAGMENT_SCHEMA_DEFS.SDInboundParagraph,
    SD_CONVERSION_FRAGMENT_SCHEMA_DEFS.SDInboundHeading,
    SD_CONVERSION_FRAGMENT_SCHEMA_DEFS.SDInboundList,
    SD_CONVERSION_FRAGMENT_SCHEMA_DEFS.SDInboundTable,
    SD_CONVERSION_FRAGMENT_SCHEMA_DEFS.SDInboundHorizontalRule,
  ],
};

export const SD_CONVERSION_FRAGMENT_SCHEMA: JsonSchema = {
  oneOf: [conversionContentNodeSchema, arraySchema(conversionContentNodeSchema, 1)],
};
