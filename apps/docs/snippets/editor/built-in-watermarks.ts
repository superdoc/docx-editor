import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  ui: { toolbar: { container: '#toolbar', includeItems: ['watermark'] } },
});

window.addEventListener('beforeunload', () => superdoc.destroy());
