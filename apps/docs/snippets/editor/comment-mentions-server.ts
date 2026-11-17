type Person = { id: string; name: string };

type MentionNotifier = {
  googleChatWebhookUrl: string;
  currentUser(request: Request): Promise<Person | null>;
  canComment(user: Person, documentId: string): Promise<boolean>;
  findMember(documentId: string, mention: { id?: string; email?: string }): Promise<Person | null>;
  claimOnce(key: string): Promise<boolean>;
  releaseClaim(key: string): Promise<void>;
};

function readText(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' && field !== '' ? field : undefined;
}

export async function handleCommentMentions(request: Request, notifier: MentionNotifier): Promise<Response> {
  const author = await notifier.currentUser(request);
  if (!author) return new Response('Sign in required', { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const documentId = readText(body, 'documentId');
  const commentId = readText(body, 'commentId');
  const mentioned: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'mentioned') : null;
  if (!documentId || !commentId || !Array.isArray(mentioned)) {
    return new Response('Invalid request', { status: 400 });
  }
  if (!(await notifier.canComment(author, documentId))) return new Response('Forbidden', { status: 403 });

  const claimedKeys: string[] = [];
  let sent = false;
  try {
    const recipients: Person[] = [];
    for (const mention of mentioned.slice(0, 20)) {
      const id = readText(mention, 'id');
      const email = readText(mention, 'email');
      const member = await notifier.findMember(documentId, { ...(id ? { id } : {}), ...(email ? { email } : {}) });
      if (!member || member.id === author.id) continue;
      const key = `${documentId}:${commentId}:${member.id}`;
      if (!(await notifier.claimOnce(key))) continue;
      recipients.push(member);
      claimedKeys.push(key);
    }
    if (recipients.length === 0) return new Response(null, { status: 204 });

    const names = recipients.map((member) => member.name).join(', ');
    const response = await fetch(notifier.googleChatWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: `${author.name} mentioned ${names} in a comment on ${documentId}.` }),
    });
    sent = response.ok;
  } finally {
    if (!sent) await Promise.all(claimedKeys.map((key) => notifier.releaseClaim(key)));
  }

  return sent
    ? new Response(null, { status: 204 })
    : new Response('Google Chat did not accept the message', { status: 502 });
}
