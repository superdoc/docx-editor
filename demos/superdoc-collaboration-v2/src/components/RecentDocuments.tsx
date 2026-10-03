import { useState } from 'react';

export type RecentDocument = { id: string; name: string; lastOpened: string };

export function RecentDocuments({
  documents,
  onClose,
  onOpen,
}: {
  documents: RecentDocument[];
  onClose: () => void;
  onOpen: (roomId: string) => void;
}) {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(documents[0]?.id ?? null);

  const openSelected = () => {
    if (selectedRoomId) onOpen(selectedRoomId);
  };

  return (
    <div className='room-dialog-backdrop' role='presentation' onMouseDown={onClose}>
      <section
        className='room-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='room-dialog-title'
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className='room-dialog-header'>
          <h2 id='room-dialog-title'>Open recent</h2>
        </div>
        <div className='room-list-header'>
          <span>Name</span>
          <span>Last opened by you</span>
        </div>
        <div className='room-list'>
          {documents.length ? (
            documents.map((document) => (
              <button
                key={document.id}
                className={selectedRoomId === document.id ? 'is-selected' : ''}
                onClick={() => setSelectedRoomId(document.id)}
                onDoubleClick={() => onOpen(document.id)}
              >
                <span className='document-icon' aria-hidden='true'>
                  <span className='document-sheet' />
                  <span>DOCX</span>
                </span>
                <span className='room-document-copy'>
                  <strong>{document.name}</strong>
                  <small>Room {document.id}</small>
                </span>
                <time>{formatLastOpened(document.lastOpened)}</time>
              </button>
            ))
          ) : (
            <p>No documents are available yet.</p>
          )}
        </div>
        <div className='room-dialog-footer'>
          <button onClick={onClose}>Cancel</button>
          <button className='open-room-button' disabled={!selectedRoomId} onClick={openSelected}>
            Open
          </button>
        </div>
      </section>
    </div>
  );
}

function formatLastOpened(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
