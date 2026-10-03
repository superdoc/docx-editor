import { useEffect, useState } from 'react';
import { BlankDOCX } from 'superdoc';
import { Editor } from './components/Editor';
import { RecentDocuments, type RecentDocument } from './components/RecentDocuments';
import { Topbar } from './components/Topbar';

type RoomMode = 'create' | 'join';
type Room = { id: string; mode: RoomMode; name: string; sourceUrl: string };
const serverUrl = import.meta.env.VITE_COLLAB_URL ?? 'ws://127.0.0.1:3101';
const clientId = crypto.randomUUID();

function roomIdFromPath() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const initialRoomId = roomIdFromPath();
  const [room, setRoom] = useState<Room | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<RecentDocument[]>([]);

  const openRoom = async (id: string, options?: { name?: string; sourceUrl?: string }) => {
    const normalizedId = id.trim();
    if (!normalizedId) return;
    setOpening(true);
    setOpenError('');
    try {
      const params = new URLSearchParams({ clientId });
      if (options?.name) params.set('name', options.name);
      const apiUrl = `${serverUrl.replace(/^ws/, 'http')}/api/rooms/${encodeURIComponent(normalizedId)}/open?${params}`;
      const response = await fetch(apiUrl, { method: 'POST' });
      if (!response.ok) throw new Error(`Room lookup failed (${response.status})`);
      const { mode, name } = (await response.json()) as { mode: RoomMode; name: string };
      history.pushState({}, '', `/room/${encodeURIComponent(normalizedId)}`);
      setRoom({
        id: normalizedId,
        mode,
        name,
        sourceUrl: mode === 'create' ? (options?.sourceUrl ?? BlankDOCX) : BlankDOCX,
      });
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    if (initialRoomId) {
      void openRoom(initialRoomId);
    } else {
      void openRoom(crypto.randomUUID().slice(0, 8), { name: 'untitled document' });
    }
  }, []);

  const createBlankRoom = () => {
    void openRoom(crypto.randomUUID().slice(0, 8), { name: 'untitled document' });
  };

  const createUploadedRoom = (file: File) => {
    void openRoom(crypto.randomUUID().slice(0, 8), {
      name: file.name,
      sourceUrl: URL.createObjectURL(file),
    });
  };

  const showRoomPicker = async () => {
    setOpenError('');
    try {
      const response = await fetch(`${serverUrl.replace(/^ws/, 'http')}/api/rooms`);
      if (!response.ok) throw new Error(`Room list failed (${response.status})`);
      const nextRooms = (await response.json()) as RecentDocument[];
      setAvailableRooms(nextRooms);
      setRoomPickerOpen(true);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  };

  const renameDocument = async (name: string) => {
    if (!room) return;
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName === room.name) return;
    const apiUrl = `${serverUrl.replace(/^ws/, 'http')}/api/rooms/${encodeURIComponent(room.id)}/rename?name=${encodeURIComponent(normalizedName)}`;
    const response = await fetch(apiUrl, { method: 'POST' });
    if (!response.ok) throw new Error(`Rename failed (${response.status})`);
    setRoom((current) => (current ? { ...current, name: normalizedName } : current));
  };

  if (!room) {
    return (
      <main className='room-picker'>
        <div className='room-card'>
          <span className='eyebrow'>SuperDoc v2</span>
          <h1>Opening a new document</h1>
          <p>A blank collaboration room is being created.</p>
          {openError ? <p className='room-error'>{openError}</p> : null}
          {openError ? (
            <button className='retry-room' disabled={opening} onClick={createBlankRoom}>
              Try again
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <div className='app-shell'>
      <Topbar
        documentName={room.name}
        onNewDocument={createBlankRoom}
        onUploadDocument={createUploadedRoom}
        onOpenRoom={() => void showRoomPicker()}
        onRenameDocument={renameDocument}
      />
      <div className='workspace'>
        <Editor roomId={room.id} roomMode={room.mode} sourceUrl={room.sourceUrl} />
      </div>
      {roomPickerOpen ? (
        <RecentDocuments
          documents={availableRooms}
          onClose={() => setRoomPickerOpen(false)}
          onOpen={(roomId) => {
            setRoomPickerOpen(false);
            void openRoom(roomId);
          }}
        />
      ) : null}
    </div>
  );
}
