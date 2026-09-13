import { SuperDoc, type ToolbarConfig } from 'superdoc';
import 'superdoc/style.css';

const toolbar = {
  container: '#toolbar',
  items: {
    left: ['undo', 'redo'],
    center: ['bold', 'italic', 'underline', 'link', 'image', 'table', 'table-actions'],
    right: ['document-mode', 'zoom'],
  },
  responsiveTo: 'container',
} satisfies ToolbarConfig;

function withImageMimeType(file: File): Blob {
  const type = file.type.toLowerCase();
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg') return file;
  if (type) throw new Error('Choose a PNG or JPEG image.');
  if (/\.png$/i.test(file.name)) return file.slice(0, file.size, 'image/png');
  if (/\.jpe?g$/i.test(file.name)) return file.slice(0, file.size, 'image/jpeg');
  throw new Error('Choose a PNG or JPEG image.');
}

function handleImageUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(withImageMimeType(file));
  });
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  handleImageUpload,
  ui: { toolbar },
});

window.addEventListener('beforeunload', () => superdoc.destroy());
