import { ref, shallowRef } from 'vue';
import { useField } from './use-field';
import { documentTypes } from '@superdoc/common';
import useComment from '../components/CommentsLayer/use-comment.js';
import type { UseCommentParams } from '../components/CommentsLayer/use-comment.js';
import type { DocumentRendererRuntime, Editor, InternalConfig, RuntimeDocument } from '../core/types/index.js';

type UseDocumentParams = Pick<
  RuntimeDocument,
  | 'id'
  | 'data'
  | 'password'
  | 'fieldContext'
  | 'load'
  | 'loadScope'
  | 'role'
  | 'ydoc'
  | 'provider'
  | 'isNewFile'
  | 'v2Collaboration'
> & {
  type?: string;
  state?: unknown;
  html?: string;
  markdown?: string;
  socket?: unknown;
  fields?: unknown[];
  annotations?: unknown[];
  conversations?: UseCommentParams[];
  commentThreadingProfile?: unknown;
};

type DocumentPageContainer = {
  page: number;
  containerBounds?: unknown;
  container?: Element | null;
};

type UseDocumentConfig = Pick<InternalConfig, 'modules' | 'rulers'>;

const mimeTypesByShorthand: Readonly<Record<string, string | undefined>> = documentTypes;

function initDocumentType({ type, data }: Pick<UseDocumentParams, 'type' | 'data'>): string {
  if (data?.type) return data.type;
  if (type) return mimeTypesByShorthand[type] || type;
  throw new Error('Document type not specified');
}

export default function useDocument(params: UseDocumentParams, superdocConfig: UseDocumentConfig | null) {
  const id = params.id;
  const type = initDocumentType(params);

  if (!superdocConfig) throw new TypeError('SuperDoc config is required to initialize a document');

  const data = params.data;
  const config = superdocConfig;
  const state = params.state;
  const role = params.role;
  const html = params.html;
  const markdown = params.markdown;
  const password = params.password;

  const editorMountNonce = ref(0);

  const container = ref<Element | null>(null);
  const pageContainers = ref<DocumentPageContainer[]>([]);
  const isReady = ref(false);
  const rulers = ref(superdocConfig.rulers);

  const ydoc = shallowRef(params.ydoc);
  const provider = shallowRef(params.provider);
  const socket = shallowRef(params.socket);
  const isNewFile = ref(params.isNewFile);
  const v2Collaboration = shallowRef(params.v2Collaboration || null);

  const editorRef = shallowRef<Editor | null>(null);
  const setEditor = (ref: Editor | null) => (editorRef.value = ref);

  const getEditor = () => editorRef.value;

  const documentRuntimeRef = shallowRef<DocumentRendererRuntime | null>(null);
  const setDocumentRuntime = (ref: DocumentRendererRuntime | null) => (documentRuntimeRef.value = ref);

  const getDocumentRuntime = () => documentRuntimeRef.value;

  const removeComments = () => {
    conversationsBackup.value = conversations.value;
    conversations.value = [];
  };

  const restoreComments = () => {
    conversations.value = conversationsBackup.value;
    console.debug('[superdoc] Restored comments:', conversations.value);
  };

  const rawFields = ref(params.fields || []);
  const fields = ref(params.fields?.map((f) => useField(f)) || []);
  const annotations = ref(params.annotations || []);
  const conversations = ref(initConversations());
  const conversationsBackup = ref(conversations.value);
  const commentThreadingProfile = ref(params.commentThreadingProfile || null);

  function initConversations() {
    if (!config.modules.comments) return [];
    return params.conversations?.map((c) => useComment(c)) || [];
  }

  const core = ref(null);

  return {
    id,
    data,
    html,
    markdown,
    password,
    fieldContext: params.fieldContext,
    load: params.load,
    loadScope: params.loadScope,
    type,
    config,
    state,
    role,

    core,
    editorMountNonce,
    ydoc,
    provider,
    socket,
    isNewFile,
    v2Collaboration,

    container,
    pageContainers,
    isReady,
    rulers,

    rawFields,
    fields,
    annotations,
    conversations,
    commentThreadingProfile,

    setEditor,
    getEditor,
    setDocumentRuntime,
    getDocumentRuntime,
    removeComments,
    restoreComments,
  };
}
