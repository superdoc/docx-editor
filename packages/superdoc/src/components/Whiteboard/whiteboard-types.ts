import type { Whiteboard } from '../../core/whiteboard/Whiteboard';
import type { WhiteboardPage } from '../../core/whiteboard/WhiteboardPage';

export type WhiteboardPageSize = { width: number; height: number; originalWidth?: number | null };

export type WhiteboardPageOffset = { top: number; left: number };

export type WhiteboardDropTarget = Pick<Whiteboard, 'getTool' | 'getType'>;

export type WhiteboardPageView = Pick<
  WhiteboardPage,
  'pageIndex' | 'size' | 'mount' | 'resize' | 'destroy' | 'addImage' | 'addText'
>;
