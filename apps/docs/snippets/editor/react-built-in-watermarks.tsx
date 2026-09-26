import { SuperDocEditor, type ToolbarConfig } from '@superdoc/react';
import '@superdoc/react/style.css';

const ui = { toolbar: { includeItems: ['watermark'] } satisfies ToolbarConfig };

export default function App() {
  return <SuperDocEditor document='/sample.docx' ui={ui} />;
}
