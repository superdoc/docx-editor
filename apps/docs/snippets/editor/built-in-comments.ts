import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  user: {
    name: 'Alex Rivera',
    email: 'alex@example.com',
  },
  ui: {
    toolbar: { container: '#toolbar' },
    comments: {
      layout: 'auto',
    },
  },
});

window.addEventListener('beforeunload', () => superdoc.destroy());
