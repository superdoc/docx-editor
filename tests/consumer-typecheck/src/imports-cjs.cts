/**
 * Consumer typecheck: CommonJS require() root entry.
 *
 * The v2 public package exposes the root entry and stylesheet assets only.
 * This fixture verifies the root require condition resolves to real types
 * under Node16/NodeNext module resolution.
 */
import superdoc = require('superdoc');

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertNotAny<T> = IsAny<T> extends true ? never : true;

const _rootIsTyped: AssertNotAny<typeof superdoc> = true;
const _SuperDoc: AssertNotAny<typeof superdoc.SuperDoc> = true;
const _createTheme: AssertNotAny<typeof superdoc.createTheme> = true;
const _defineExtension: AssertNotAny<typeof superdoc.defineSuperDocExtension> = true;

const _instance = new superdoc.SuperDoc({
  selector: '#editor',
});

void _rootIsTyped;
void _SuperDoc;
void _createTheme;
void _defineExtension;
void _instance;

import collaboration = require('superdoc/collaboration');
const _collaborationResolver: (documentId: string) => string = collaboration.resolveCollaborationRoomName;
void _collaborationResolver;
