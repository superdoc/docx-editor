import type { Whiteboard } from '../../core/whiteboard/Whiteboard';

export type WhiteboardPageSize = { width: number; height: number; originalWidth?: number | null };

export type WhiteboardPageOffset = { top: number; left: number };

export type WhiteboardDropTarget = Pick<Whiteboard, 'getTool' | 'getType'>;
