'use client';

import { useEffect, useRef, useState } from 'react';
import type { SuperDocAwarenessUpdatePayload } from 'superdoc';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { CollaborationOverview } from './collaboration-overview';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
class DemoAccessDenied extends Error {}

export function CollaborationDemo({ presence = false, access = false }: { presence?: boolean; access?: boolean }) {
  const serverUrl = access
    ? process.env.NEXT_PUBLIC_COLLABORATION_ACCESS_DEMO_URL
    : process.env.NEXT_PUBLIC_COLLABORATION_DEMO_URL;
  const roomServiceUrl = !access
    ? process.env.NEXT_PUBLIC_COLLABORATION_ROOM_SERVICE_URL?.replace(/\/$/, '')
    : undefined;
  const configured = Boolean(serverUrl || roomServiceUrl);
  const root = useRef<HTMLDivElement>(null);
  const alex = useRef<HTMLDivElement>(null);
  const sam = useRef<HTMLDivElement>(null);
  const editors = useRef<SuperDocInstance[]>([]);
  const generation = useRef(0);
  const guestGeneration = useRef(0);
  const cancelPending = useRef<(() => void) | null>(null);
  const startupTimeout = useRef<number | undefined>(undefined);
  const [state, setState] = useState<DemoState>('idle');
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(50);
  const [fullscreen, setFullscreen] = useState(false);
  const [participants, setParticipants] = useState<SuperDocAwarenessUpdatePayload['states']>([]);
  const [samState, setSamState] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const reconnectSam = useRef<(() => Promise<void>) | null>(null);
  const connectGuest = useRef<((name: 'Sam' | 'Taylor') => Promise<void>) | null>(null);
  const [guest, setGuest] = useState<'Sam' | 'Taylor'>('Sam');
  const [guestStatus, setGuestStatus] = useState<'idle' | 'connecting' | 'connected' | 'denied' | 'error'>('idle');
  const guestMessage = {
    idle: 'Connect another person',
    connecting: `Connecting ${guest}…`,
    connected: `${guest} joined the room.`,
    denied: `Access denied. ${guest} cannot join this room.`,
    error: 'Could not connect. Check the server and try again.',
  }[guestStatus];

  function release() {
    generation.current += 1;
    window.clearTimeout(startupTimeout.current);
    cancelPending.current?.();
    cancelPending.current = null;
    for (const editor of editors.current) editor.destroy();
    editors.current = [];
    reconnectSam.current = null;
    connectGuest.current = null;
  }

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', update);
    void start();
    return () => {
      release();
      document.removeEventListener('fullscreenchange', update);
    };
  }, []);

  function applyZoom(value: number) {
    const bounded = Math.max(20, Math.min(120, value));
    for (const editor of editors.current) editor.setZoom(bounded);
    setZoom(bounded);
  }

  function fit() {
    const widths = editors.current.flatMap((editor, index) => {
      const mount = index === 0 ? alex.current : sam.current;
      const metrics = editor.activeEditor?.pageMetrics as
        | { getSnapshot(): { pages: ReadonlyArray<{ base: { widthPx: number } }> } }
        | undefined;
      if (typeof metrics?.getSnapshot !== 'function') return [];
      const widest = metrics.getSnapshot().pages.reduce((width, page) => Math.max(width, page.base.widthPx), 0);
      return mount && widest ? [(mount.clientWidth / widest) * 100] : [];
    });
    if (widths.length) applyZoom(Math.floor(Math.min(...widths)));
  }

  async function start() {
    if (!configured) return;
    release();
    const attempt = generation.current;
    const current = () => attempt === generation.current;
    startupTimeout.current = window.setTimeout(() => {
      if (!current()) return;
      release();
      setState('error');
      setNotice('The live demo timed out. Retry or run the example locally below.');
    }, 60_000);
    setState('loading');
    setParticipants([]);
    setSamState('connecting');
    setGuestStatus('idle');
    setNotice(access ? 'Opening Alex’s editor…' : 'Opening Alex’s editor, then connecting Sam…');
    try {
      const ctor = await loadRuntime();
      if (!current()) return;
      const response = await fetch('/fixtures/collaboration-sample.docx');
      if (!response.ok) throw new Error('Sample unavailable');
      const data = await response.blob();
      if (!current()) return;
      let documentId = `${access ? 'docs-access' : 'docs'}-${crypto.randomUUID()}`;
      let roomToken: string | undefined;
      let connectionUrl = serverUrl;
      if (roomServiceUrl) {
        const response = await fetch(`${roomServiceUrl}/rooms`, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error('The demo room could not be opened.');
        const room: unknown = await response.json();
        if (
          !room ||
          typeof room !== 'object' ||
          !('documentId' in room) ||
          typeof room.documentId !== 'string' ||
          !('token' in room) ||
          typeof room.token !== 'string' ||
          !('expiresAt' in room) ||
          typeof room.expiresAt !== 'number'
        ) {
          throw new Error('Invalid demo room response.');
        }
        if (!current()) return;
        documentId = room.documentId;
        roomToken = room.token;
        connectionUrl = `${roomServiceUrl.replace(/^http/, 'ws')}/rooms`;
      }
      const connect = async (name: 'Alex' | 'Sam' | 'Taylor', roomMode: 'create' | 'join') => {
        const guestAttempt = guestGeneration.current;
        const isActive = () => current() && (name === 'Alex' || guestAttempt === guestGeneration.current);
        const attemptId = crypto.randomUUID();
        const mount = name === 'Alex' ? alex.current : sam.current;
        const color = name === 'Alex' ? '#1355ff' : '#00853d';
        if (!current() || !mount) return;
        try {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (failed: boolean, error: unknown = new Error('Connection failed')) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeout);
              cancelPending.current = null;
              if (failed) reject(error);
              else resolve();
            };
            const timeout = window.setTimeout(() => finish(true), 30_000);
            const done = () => finish(false);
            const fail = () => finish(true);
            cancelPending.current = fail;
            try {
              const instance = createRuntimeEditor(ctor, {
                selector: mount,
                contained: true,
                document: {
                  id: 'sample',
                  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  data,
                  v2Collaboration: {
                    providerType: roomServiceUrl ? 'y-websocket' : 'hocuspocus',
                    documentId,
                    serverUrl: connectionUrl,
                    roomMode,
                    ...(access ? { token: `demo-${name.toLowerCase()}`, params: { attempt: attemptId } } : {}),
                    ...(roomToken ? { params: { token: roomToken } } : {}),
                  },
                },
                user: { name, email: `${name.toLowerCase()}@example.com`, color },
                ui: false,
                zoom: { initial: 50, mode: 'manual' },
                onCollaborationReady: done,
                onAwarenessUpdate:
                  name === 'Alex'
                    ? ({ states }) => {
                        if (current()) setParticipants(states);
                      }
                    : undefined,
                onContentError: fail,
                onException: (payload) => {
                  if (!isActive() || 'diagnosticCode' in payload) return;
                  finish(true, payload.error);
                  if (!access || name === 'Alex') {
                    setNotice('An editor reported an error. Your current demo remains visible; restarting clears it.');
                  }
                },
              });
              editors.current.push(instance);
            } catch (error) {
              window.clearTimeout(timeout);
              reject(error);
            }
          });
        } catch (error) {
          if (access && isActive()) {
            const resultUrl = new URL('/access-result', serverUrl);
            resultUrl.protocol = resultUrl.protocol === 'wss:' ? 'https:' : 'http:';
            resultUrl.searchParams.set('attempt', attemptId);
            const result = await fetch(resultUrl, { signal: AbortSignal.timeout(3000) })
              .then(async (response) => (response.ok ? (response.json() as Promise<{ denied?: boolean }>) : null))
              .catch(() => null);
            if (result?.denied === true) throw new DemoAccessDenied();
          }
          throw error;
        }
      };
      await connect('Alex', 'create');
      if (!access) await connect('Sam', 'join');
      if (!current()) return;
      connectGuest.current = async (name) => {
        await connect(name, 'join');
        if (!current()) return;
        await editors.current[1]?.activeEditor?.authoring?.setSelectionByText({
          text: 'Delivery agreement',
          collapse: 'end',
          focus: false,
        });
      };
      reconnectSam.current = async () => {
        await connect('Sam', 'join');
        if (!current()) return;
        await editors.current[1]?.activeEditor?.authoring?.setSelectionByText({
          text: 'Delivery agreement',
          collapse: 'end',
          focus: false,
        });
        if (!current()) return;
        setSamState('connected');
      };
      for (const [index, editor] of editors.current.entries()) {
        const result = await editor.activeEditor?.authoring?.setSelectionByText({
          text: index === 0 ? 'Delivery is due Monday.' : 'Delivery agreement',
          collapse: 'end',
          focus: false,
        });
        if (!current()) return;
        if (!result?.ok) throw new Error('The initial collaborator cursor could not be placed.');
      }
      window.clearTimeout(startupTimeout.current);
      fit();
      setState('ready');
      setSamState('connected');
      setNotice(
        access
          ? 'Simulated identities · Real server access checks · Changes are not saved.'
          : roomServiceUrl
            ? 'Edit either document and watch the other. This shared demo expires after 15 minutes. Use sample text only.'
            : 'Edit either document and watch the other. Demo changes are not saved.',
      );
    } catch {
      if (!current()) return;
      release();
      setState('error');
      setNotice('The live demo could not connect. Retry or run the example locally below.');
    }
  }

  async function tryGuest(name: 'Sam' | 'Taylor') {
    if (!connectGuest.current || guestStatus === 'connecting') return;
    const attempt = generation.current;
    guestGeneration.current += 1;
    for (const editor of editors.current.splice(1)) editor.destroy();
    setGuest(name);
    setGuestStatus('connecting');
    try {
      await connectGuest.current?.(name);
      if (attempt !== generation.current) return;
      fit();
      setGuestStatus('connected');
    } catch (error) {
      if (attempt !== generation.current) return;
      for (const editor of editors.current.splice(1)) editor.destroy();
      setGuestStatus(error instanceof DemoAccessDenied ? 'denied' : 'error');
    }
  }

  async function toggleSam() {
    if (samState === 'connected') {
      for (const editor of editors.current.splice(1)) editor.destroy();
      setSamState('disconnected');
      return;
    }
    const attempt = generation.current;
    setSamState('connecting');
    try {
      await reconnectSam.current?.();
      if (attempt === generation.current) fit();
    } catch {
      if (attempt !== generation.current) return;
      for (const editor of editors.current.splice(1)) editor.destroy();
      setSamState('disconnected');
      setNotice('Sam could not reconnect. Check the server and try again.');
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setNotice('Fullscreen is unavailable in this browser. You can still expand the demo.');
    }
  }

  return (
    <div ref={root} className='not-prose sd-editor-demo sd-collaboration-demo' data-fullscreen={fullscreen}>
      <div className='sd-editor-demo-toolbar'>
        {(state === 'ready' || state === 'error') && (
          <button
            type='button'
            disabled={!configured}
            onClick={() => {
              if (state === 'ready' && !window.confirm('Restart and discard this demo’s edits?')) return;
              void start();
            }}
          >
            {state === 'ready' ? 'Restart demo' : 'Retry'}
          </button>
        )}
        <EditorDemoViewControls
          disabled={state !== 'ready'}
          fitActive={false}
          isFullscreen={fullscreen}
          zoom={{ min: 20, max: 120, mode: 'manual', value: zoom }}
          onFit={fit}
          onFullscreen={() => void toggleFullscreen()}
          onZoom={(direction) => applyZoom(zoom + direction * 10)}
        />
      </div>
      {access && state === 'ready' && (
        <div className='sd-collaboration-presence'>
          <span role='status'>{guestMessage}</span>
          <div className='sd-collaboration-access-actions'>
            <button type='button' disabled={guestStatus === 'connecting'} onClick={() => void tryGuest('Sam')}>
              Connect Sam
            </button>
            <button type='button' disabled={guestStatus === 'connecting'} onClick={() => void tryGuest('Taylor')}>
              Connect Taylor
            </button>
          </div>
        </div>
      )}
      {presence && state === 'ready' && (
        <div className='sd-collaboration-presence'>
          <ul aria-label='Connected participants'>
            {participants.map((participant) => (
              <li key={participant.clientId}>
                <span aria-hidden='true' style={{ backgroundColor: participant.color }} />
                {participant.name || 'Guest'}
              </li>
            ))}
          </ul>
          <button type='button' disabled={samState === 'connecting'} onClick={() => void toggleSam()}>
            {samState === 'connected'
              ? 'Disconnect Sam'
              : samState === 'connecting'
                ? 'Connecting Sam…'
                : 'Reconnect Sam'}
          </button>
        </div>
      )}
      <p role='status' className='sd-collaboration-demo-notice'>
        {configured
          ? notice || 'Connecting the two editors…'
          : 'The hosted demo is not configured. Run the local example below.'}
      </p>
      {(state === 'idle' || state === 'error') && <CollaborationOverview />}
      <div hidden={state === 'idle' || state === 'error'}>
        <CollapsibleEditorPreview className='sd-editor-demo-preview'>
          <div className='sd-collaboration-demo-panes'>
            <section aria-label="Alex's editor">
              <h3>Alex</h3>
              <div ref={alex} className='sd-collaboration-demo-mount' />
            </section>
            <section aria-label={access ? `${guest}'s editor` : "Sam's editor"}>
              <h3>{access ? guest : 'Sam'}</h3>
              {presence && samState === 'disconnected' && <p>Sam has left. His edits remain in Alex’s document.</p>}
              <div
                ref={sam}
                className='sd-collaboration-demo-mount'
                style={access && guestStatus !== 'connected' ? { visibility: 'hidden' } : undefined}
              />
            </section>
          </div>
        </CollapsibleEditorPreview>
      </div>
    </div>
  );
}
