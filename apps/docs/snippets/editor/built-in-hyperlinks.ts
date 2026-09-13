import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { handleHyperlinkActivation } from './hyperlink-activation';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/hyperlinks-sample.docx',
  hyperlinks: {
    onActivate: handleHyperlinkActivation,
  },
  ui: {
    toolbar: { container: '#toolbar', items: { center: ['link'] } },
  },
});

window.addEventListener('beforeunload', () => superdoc.destroy());
