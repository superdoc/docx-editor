import { SuperDocEditor, type SuperDocEditorProps } from '@superdoc/react';
import '@superdoc/react/style.css';
import { handleHyperlinkActivation } from './hyperlink-activation';

const editorConfig = {
  hyperlinks: {
    onActivate: handleHyperlinkActivation,
  },
  ui: {
    toolbar: { items: { center: ['link'] } },
  },
} satisfies Pick<SuperDocEditorProps, 'hyperlinks' | 'ui'>;

export default function App() {
  return (
    <SuperDocEditor document='/hyperlinks-sample.docx' hyperlinks={editorConfig.hyperlinks} ui={editorConfig.ui} />
  );
}
