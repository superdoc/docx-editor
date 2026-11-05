import type { DocumentApi, TablePresetAppearance, TablePresetColor } from '@superdoc/document-api';

declare const doc: DocumentApi;
const page = doc.tables.listPresets({ source: 'word', query: 'shading banded rows', limit: 25 });
const appearance: TablePresetAppearance | null | undefined = page.items[0]?.appearance;
const fill: TablePresetColor | undefined = appearance?.header.fill;
const reference: string | undefined = fill?.themeColor ?? fill?.rgb;
const modifier: string | undefined = fill?.tint ?? fill?.shade;
void reference;
void modifier;
