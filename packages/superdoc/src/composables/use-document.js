import { ref, shallowRef } from 'vue';
import { useField } from './use-field';
import { documentTypes } from '@superdoc/common';
import useComment from '@superdoc/components/CommentsLayer/use-comment';

export default function useDocument(params, superdocConfig) {
  const id = params.id;
  const type = initDocumentType(params);

  const data = params.data;
  const config = superdocConfig;
  const state = params.state;
  const role = params.role;
  const html = params.html;
  const markdown = params.markdown;
  const password = params.password;

  // Password retry — incrementing this forces SuperDoc editor to remount and re-run loadXmlData.
  const editorMountNonce = ref(0);

  // Placement
  const container = ref(null);
  const pageContainers = ref([]);
  const isReady = ref(false);
  const rulers = ref(superdocConfig.rulers);

  // Collaboration
  const ydoc = shallowRef(params.ydoc);
  const provider = shallowRef(params.provider);
  const socket = shallowRef(params.socket);
  const isNewFile = ref(params.isNewFile);
  const v2Collaboration = shallowRef(params.v2Collaboration || null);

  // For docx
  const editorRef = shallowRef(null);
  const setEditor = (ref) => (editorRef.value = ref);

  /**
   * @deprecated Direct editor access will be removed in a future version. Use the Document API (`editor.doc`) instead.
   * See https://docs.superdoc.dev/document-api/overview
   */
  const getEditor = () => editorRef.value;

  const documentRuntimeRef = shallowRef(null);
  const setDocumentRuntime = (ref) => (documentRuntimeRef.value = ref);

  /**
   * @deprecated Direct editor access will be removed in a future version. Use the Document API (`editor.doc`) instead.
   * See https://docs.superdoc.dev/document-api/overview
   */
  const getDocumentRuntime = () => documentRuntimeRef.value;

  /**
   * Initialize the mime type of the document.
   * Accepts shorthand ('docx') or full mime type ('application/vnd...').
   * @param {Object} params - The document parameters
   * @param {string} [params.type] - The document type (shorthand or mime type)
   * @param {Object} [params.data] - The document data object
   * @param {string} [params.data.type] - The mime type from the data object
   * @returns {string} The resolved mime type
   * @throws {Error} If no document type can be determined
   */
  function initDocumentType({ type, data }) {
    if (data?.type) return data.type;
    if (type) return documentTypes[type] || type;
    throw new Error('Document type not specified');
  }

  // Comments
  const removeComments = () => {
    conversationsBackup.value = conversations.value;
    conversations.value = [];
  };

  const restoreComments = () => {
    conversations.value = conversationsBackup.value;
    console.debug('[superdoc] Restored comments:', conversations.value);
  };

  // Modules
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

  const removeConversation = (conversationId) => {
    const index = conversations.value.findIndex((c) => c.conversationId === conversationId);
    if (index > -1) conversations.value.splice(index, 1);
  };

  return {
    id,
    data,
    html,
    markdown,
    password,
    fieldContext: params.fieldContext,
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

    // Placement
    container,
    pageContainers,
    isReady,
    rulers,

    // Modules
    rawFields,
    fields,
    annotations,
    conversations,
    commentThreadingProfile,

    // Actions
    setEditor,
    getEditor,
    setDocumentRuntime,
    getDocumentRuntime,
    removeComments,
    restoreComments,
    removeConversation,
  };
}
