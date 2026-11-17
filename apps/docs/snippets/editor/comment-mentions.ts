import { SuperDoc, type SuperDocCommentsUpdatePayload } from 'superdoc';
import 'superdoc/style.css';

type MentionedPerson = { id?: string; name?: string; email?: string };

function readMentions(comment: SuperDocCommentsUpdatePayload['comment']): MentionedPerson[] {
  const mentions = comment?.['mentions'];
  if (!Array.isArray(mentions)) return [];

  return mentions.flatMap((mention: unknown) => {
    if (typeof mention !== 'object' || mention === null) return [];
    const id: unknown = Reflect.get(mention, 'id');
    const name: unknown = Reflect.get(mention, 'name');
    const email: unknown = Reflect.get(mention, 'email');
    const person: MentionedPerson = {
      ...(typeof id === 'string' ? { id } : {}),
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof email === 'string' ? { email } : {}),
    };
    return person.id || person.email ? [person] : [];
  });
}

async function reportMentions(event: SuperDocCommentsUpdatePayload) {
  if (event.rejected || (event.type !== 'add' && event.type !== 'update')) return;

  const commentId = event.comment?.commentId;
  const mentioned = readMentions(event.comment);
  if (typeof commentId !== 'string' || mentioned.length === 0) return;

  const response = await fetch('/api/comment-mentions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ documentId: 'sample', commentId, mentioned }),
  });
  if (!response.ok) throw new Error(`Mention notification failed: ${response.status}`);
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  user: { id: 'u-alex', name: 'Alex Rivera', email: 'alex@example.com' },
  users: [
    { id: 'u-alex', name: 'Alex Rivera', email: 'alex@example.com' },
    { id: 'u-sam', name: 'Sam Patel', email: 'sam@example.com' },
    { id: 'u-jordan', name: 'Jordan Lee', email: 'jordan@example.com', role: 'viewer' },
  ],
  onCommentsUpdate: (event) => {
    reportMentions(event).catch((error) => console.error('Could not report mentions.', error));
  },
});

window.addEventListener('beforeunload', () => superdoc.destroy());
