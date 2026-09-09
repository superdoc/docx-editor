import { renderPlaceholder } from 'fumadocs-core/mdx-plugins/remark-llms.runtime';
import {
  renderReferenceLandingMarkdown,
  renderReferenceNamespaceMarkdown,
  renderReferenceOperationMarkdown,
} from './document-api-reference/markdown';
import { renderConfigReferenceMarkdown } from './config-explorer';
import { contextMenuConfigExplorer } from './context-menu-config-explorer';
import { hyperlinksConfigExplorer } from './hyperlinks-config-explorer';
import { loadingConfigExplorer } from './loading-config-explorer';
import { renderBuiltInUiMapMarkdown } from './built-in-ui-map';
import { renderBuiltInEditorDemoMarkdown } from './built-in-editor-demos';
import { renderClauseLibraryMarkdown } from './clause-library';
import { renderContentControlAuthoringMarkdown } from './content-control-authoring';
import { renderContentControlLocksMarkdown } from './content-control-locks';
import { renderContentControlPatternsMarkdown } from './content-control-patterns';
import { renderFontResolutionExplorerMarkdown } from './font-resolution-explorer';
import { renderLifecycleJourneyMarkdown } from './lifecycle-journey';
import { commentsConfigExplorer } from './comments-config-explorer';
import { editorConfigExplorer } from './editor-config-explorer';
import { proofingConfigExplorer } from './proofing-config-explorer';
import { rulerConfigExplorer } from './ruler-config-explorer';
import { searchConfigExplorer } from './search-config-explorer';
import { toolbarConfigExplorer } from './toolbar-config-explorer';
import { renderTemplatePopulationMarkdown } from './template-population';

export const llmPlaceholderComponents = [
  'Callout',
  'BuiltInUiMap',
  'Card',
  'Cards',
  'ClauseLibraryDemo',
  'CommandStateDemo',
  'ContentControlAuthoringDemo',
  'ContentControlLocksDemo',
  'ContentControlPatterns',
  'CommentsConfigReference',
  'ConfigReference',
  'ContextMenuConfigReference',
  'CustomBoldDemo',
  'CustomCommentsDemo',
  'CustomCommandDemo',
  'CustomContentControlsDemo',
  'CustomDocumentControlsDemo',
  'CustomReviewFindingsDemo',
  'CustomSearchDemo',
  'CustomSelectionDemo',
  'CustomTrackChangesDemo',
  'CustomToolbarDemo',
  'CustomUiArchitecture',
  'CollaborationOverview',
  'CollaborationDemo',
  'DocumentPreview',
  'DocumentApiNamespace',
  'DocumentApiOperation',
  'DocumentApiReferenceLanding',
  'EditorDemo',
  'FileDownload',
  'FontResolutionExplorer',
  'FrameworkExample',
  'FrameworkExampleTabs',
  'HyperlinksConfigReference',
  'InterfaceOwnership',
  'LifecycleJourney',
  'LoadingConfigReference',
  'MigrationAgentPrompt',
  'MigrationExplorer',
  'ProofingConfigReference',
  'ReceiptBar',
  'RuntimeExample',
  'RuntimeExampleTabs',
  'RulerConfigReference',
  'SearchConfigReference',
  'SurfaceLifecycleDemo',
  'ThemePlayground',
  'ToolbarConfigReference',
  'TemplatePopulationDemo',
  'MigrationExample',
  'MigrationExampleTabs',
  'img',
] as const;

type PlaceholderAttributes = Record<string, unknown>;

function textAttribute(attributes: PlaceholderAttributes, name: string) {
  const value = attributes[name];
  return typeof value === 'string' ? value : undefined;
}

function booleanAttribute(attributes: PlaceholderAttributes, name: string) {
  if (!(name in attributes)) return false;
  const value = attributes[name];
  return value === null || value === true || value === 'true';
}

function quoteMarkdown(content: string) {
  return content
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/**
 * Strips MDX comments from agent-facing Markdown.
 *
 * AIDEV-NOTE: `{/* ... *\/}` is a note to whoever edits the page — a "generated,
 * do not hand-edit" banner, a recorded media decision. It is meaningless to an
 * agent reading `/md/...` or `llms-full.txt`, and it leaks MDX syntax into a
 * surface that should be plain Markdown. Stripped here rather than at each
 * call site so every page benefits, including generated ones.
 */
function stripMdxComments(markdown: string) {
  return markdown.replace(/^[ \t]*\{\/\*[\s\S]*?\*\/\}[ \t]*\r?\n/gm, '');
}

export function renderLLMMarkdown(markdown: string) {
  return renderPlaceholder(stripMdxComments(markdown), {
    Callout({ attributes, children }) {
      const title = textAttribute(attributes, 'title');
      const variant = textAttribute(attributes, 'variant') ?? 'note';
      const heading = title ? `**${title} (${variant})**` : `**${variant}**`;
      return `${quoteMarkdown(`${heading}\n\n${children}`)}\n`;
    },
    BuiltInUiMap() {
      return renderBuiltInUiMapMarkdown();
    },
    ClauseLibraryDemo() {
      return renderClauseLibraryMarkdown();
    },
    Card({ attributes }) {
      const title = textAttribute(attributes, 'title') ?? 'Related guide';
      const description = textAttribute(attributes, 'description');
      const href = textAttribute(attributes, 'href');
      const label = href ? `[${title}](${href})` : `**${title}**`;
      return `- ${label}${description ? `: ${description}` : ''}\n`;
    },
    Cards({ children }) {
      return `${children.trim()}\n`;
    },
    CommandStateDemo() {
      return [
        '> **Interactive model: watch one control follow the selection**',
        '>',
        '> The sample selection is simulated. Normal text reports `enabled: true` and `active: false`. Pressing Bold changes `active` to `true` and reports `{ success: true }`. Bold text starts with `active: true`. A locked heading reports `enabled: false`, `active: false`, and a disabled reason. State describes what the control should render; the execution result confirms what the command did.',
        '',
      ].join('\n');
    },
    ContentControlAuthoringDemo() {
      return renderContentControlAuthoringMarkdown();
    },
    ContentControlLocksDemo() {
      return renderContentControlLocksMarkdown();
    },
    ContentControlPatterns() {
      return renderContentControlPatternsMarkdown();
    },
    CommentsConfigReference() {
      return renderConfigReferenceMarkdown(commentsConfigExplorer);
    },
    ConfigReference() {
      return renderConfigReferenceMarkdown(editorConfigExplorer);
    },
    ContextMenuConfigReference() {
      return renderConfigReferenceMarkdown(contextMenuConfigExplorer);
    },
    HyperlinksConfigReference() {
      return renderConfigReferenceMarkdown(hyperlinksConfigExplorer);
    },
    LoadingConfigReference() {
      return renderConfigReferenceMarkdown(loadingConfigExplorer);
    },
    CustomBoldDemo({ attributes }) {
      if (textAttribute(attributes, 'variant') === 'handoff') {
        return [
          '> **Live example: move one control into your application**',
          '>',
          "> Select text in the real DOCX. The application-owned Bold button and SuperDoc's remaining toolbar act on the same Editor selection. Bold is excluded from the built-in toolbar, but its command remains available through `superdoc.ui`.",
          '',
        ].join('\n');
      }

      return [
        '> **Live example: one custom control on a real document**',
        '>',
        '> A Bold button rendered by the application, running against a real Editor. It reads `enabled` and `active` from the `bold` command handle, sets `disabled` and `aria-pressed` from those values rather than inspecting the selection, and reports the outcome from what `executeAsync()` resolves with. `CommandExecutionResult` is `boolean | receipt`, so both shapes are handled.',
        '',
      ].join('\n');
    },
    CustomCommentsDemo() {
      return [
        '> **Live example: replace the comments panel**',
        '>',
        '> SuperDoc renders the toolbar and a three-page DOCX while the application renders the comments panel. Existing threads on the first and final pages make `setActive()` and `scrollTo()` visible; the middle page provides text for `createFromCapture()`. The panel observes `ui.comments` and reports resolve or reopen receipts. Setting `ui.comments` to `false` removes the built-in comments panel without removing comments from the document.',
        '',
      ].join('\n');
    },
    CustomCommandDemo() {
      return [
        '> **Live example: run one application command from two controls**',
        '>',
        '> Place the caret in the real DOCX. Insert clause and Control-Shift-Y execute the same registered `application.insertClause` command. The button observes the command handle for its enabled state, and the result identifies which trigger ran and whether the clause was inserted.',
        '',
      ].join('\n');
    },
    CustomContentControlsDemo() {
      return [
        '> **Live example: edit document fields from an application-owned panel**',
        '>',
        '> SuperDoc renders its toolbar and a two-page DOCX while the application renders a persistent field panel. Show in document moves between a text field on page 1 and a checkbox on page 2. The panel observes `ui.contentControls`, runs `activeEditor.doc.contentControls.text.setValue()` or `checkbox.setState()`, and stays pending until the observed field contains the new value.',
        '',
      ].join('\n');
    },
    CustomDocumentControlsDemo() {
      return [
        '> **Live example: build document-wide controls without replacing the toolbar**',
        '>',
        '> The application renders Zoom, the current document mode, and Download DOCX. SuperDoc renders the remaining built-in toolbar without its Zoom control. Changing zoom updates the percentage, and Download DOCX exports the current document.',
        '',
      ].join('\n');
    },
    CustomReviewFindingsDemo() {
      return [
        '> **Live example: turn an AI finding into a tracked suggestion**',
        '>',
        '> The embedded example runs the steps above in a two-page DOCX. The model response is simulated locally; metadata and the tracked replacement use SuperDoc.',
        '',
      ].join('\n');
    },
    CustomSearchDemo() {
      return [
        '> **Live example: drive Search from application-owned controls**',
        '>',
        '> SuperDoc renders its toolbar and a three-page DOCX while the application renders Find, Match case, Previous, Next, and Replace controls. The example starts with eight case-insensitive `Client` matches. `ui.search` paints and navigates the matches, while the panel observes the same session for its active index, total, and `canReplace` state. The document starts at 80% on wide layouts and fits to width on narrow layouts.',
        '',
      ].join('\n');
    },
    CustomSelectionDemo() {
      return [
        '> **Live example: ask AI about selected document text**',
        '>',
        '> Select text in the two-page DOCX. A compact Ask AI action appears first, then expands into a question field. The application captures the text and document target before focus moves. The demo response is local: no text is sent to a model. Scrolling or zooming resolves the same target again, and Show selection reapplies it in the Editor.',
        '',
      ].join('\n');
    },
    CustomTrackChangesDemo() {
      return [
        '> **Live example: review changes from an application-owned panel**',
        '>',
        '> SuperDoc renders its toolbar and a three-page DOCX while the application renders the review queue. Previous, Next, and Show in document move between three real tracked changes. Accepting or rejecting one removes its row and decreases the open-change count. The panel observes `ui.trackChanges`; setting `ui.comments` to `false` removes the built-in comments and review sidebar without removing tracked changes from the document.',
        '',
      ].join('\n');
    },
    CustomToolbarDemo() {
      return [
        '> **Live example: scale one control into a custom toolbar**',
        '>',
        '> Select text in the real DOCX, then use the application-owned Bold, font-family, and font-size controls. The toolbar reads `active`, `value`, and `enabled` from the corresponding command handles. Formatting one sentence and extending the selection into plain text makes the font and size pickers show `Mixed`. Each action reports the result from `executeAsync()`.',
        '',
      ].join('\n');
    },
    CollaborationOverview() {
      return '> **Illustration: two editors, one shared document.** Alex changes the delivery date to Friday. A provider carries the change through their shared room, and Sam sees Friday in the other editor. Both people can edit.\n';
    },
    CollaborationDemo({ attributes }) {
      if (booleanAttribute(attributes, 'access')) {
        return '> **Live access demo:** Alex opens a temporary shared document automatically. Edit it, then connect Sam to receive the same edits. Connect Taylor: the server rejects the request because Taylor has no permission for this room. These are simulated identities with public test credentials, checked by a real server. The demo reports access denied only after server confirmation, not for every connection failure. Demo edits are not saved. If the server is unavailable, follow the local example below.\n';
      }
      if (booleanAttribute(attributes, 'presence')) {
        return '> **Live presence demo:** Alex and Sam edit a temporary shared document. The participant list comes from Alex’s awareness updates and includes Alex himself. Type in Sam’s editor, then disconnect Sam: his presence disappears while his edits remain in Alex’s document. Reconnect Sam to rejoin the same room. This requires a configured collaboration server; otherwise follow the local two-editor example. Demo edits are not saved.\n';
      }
      return '> **Live collaboration demo:** Two real editors connect automatically in a temporary room. Expand the collapsed preview, change Monday to Friday in Alex’s editor, and watch Sam’s editor update. Alex’s cursor is blue; Sam’s is green. The demo requires a configured collaboration server; when unavailable, use the local example below. Demo edits are not saved.\n';
    },
    CustomUiArchitecture() {
      return [
        '> **Diagram: the custom UI ownership boundary**',
        '>',
        '> SuperDoc renders the document, layout, selection, and editing behavior. The application renders the controls around it — a toolbar above, panels beside. Reactive state (selection, command state, comments) flows out of the editor to those controls, and commands and document operations flow back in.',
        '',
      ].join('\n');
    },
    InterfaceOwnership() {
      return [
        '> **Interactive comparison: who renders the interface**',
        '>',
        '> SuperDoc renders the DOCX canvas in every approach. The configuration changes who renders the controls around it.',
        '',
        '| Approach | Configuration | Who renders the controls |',
        '| --- | --- | --- |',
        "| Built-in | `ui: { toolbar: { container: '#toolbar' } }` | SuperDoc |",
        "| Hybrid | `ui: { toolbar: { container: '#toolbar' }, comments: false }` | SuperDoc renders the toolbar; your application renders comments through `superdoc.ui.comments` |",
        '| Fully custom | `ui: false` | Your application, through `superdoc.ui` |',
        '',
      ].join('\n');
    },
    DocumentPreview({ attributes }) {
      const label = textAttribute(attributes, 'label') ?? 'Document preview';
      const selection = booleanAttribute(attributes, 'selection');
      const trackedChanges = booleanAttribute(attributes, 'trackedChanges');
      return [
        `> **Preview:** ${label}`,
        '>',
        `> Selection highlight: ${selection ? 'enabled' : 'disabled'}.`,
        `> Tracked changes: ${trackedChanges ? 'shown' : 'hidden'}.`,
        '',
      ].join('\n');
    },
    DocumentApiReferenceLanding() {
      return renderReferenceLandingMarkdown();
    },
    DocumentApiNamespace({ attributes }) {
      const namespace = textAttribute(attributes, 'namespace');
      return namespace ? renderReferenceNamespaceMarkdown(namespace) : 'Unknown Document API namespace.\n';
    },
    DocumentApiOperation({ attributes }) {
      const operationId = textAttribute(attributes, 'operationId');
      return operationId ? renderReferenceOperationMarkdown(operationId) : 'Unknown Document API operation.\n';
    },
    EditorDemo({ attributes }) {
      const title = textAttribute(attributes, 'title') ?? 'Interactive editor demo';
      const fixture = textAttribute(attributes, 'fixture');
      const preset = textAttribute(attributes, 'preset');
      const showConfiguration =
        attributes.showConfiguration === undefined || booleanAttribute(attributes, 'showConfiguration');
      const localFile = booleanAttribute(attributes, 'allowLocalFile');
      const builtInDemo =
        preset === 'comments' ||
        preset === 'content-controls' ||
        preset === 'context-menu' ||
        preset === 'hyperlinks' ||
        preset === 'loading' ||
        preset === 'ruler' ||
        preset === 'search' ||
        preset === 'toolbar'
          ? preset
          : null;
      const details = [
        fixture ? `Sample: [open the fixture](${fixture}).` : undefined,
        preset ? `Preset: \`${preset}\`.` : undefined,
        preset === 'document-modes'
          ? 'Try the same edit in each mode. Editing changes the document directly and is the default. Suggesting records a tracked change. After making a suggestion, switch to Viewing and use Changes to choose Original, Markup, or Final for the same proposal.'
          : undefined,
        preset === 'proofing'
          ? 'Proofing: type `mispelled`, `workng`, or `teh`, then right-click the underline.'
          : undefined,
        builtInDemo && showConfiguration ? renderBuiltInEditorDemoMarkdown(builtInDemo) : undefined,
        preset === 'comments' && !showConfiguration
          ? 'Comment thread: open the delivery-date comment, reply, resolve, and reopen it. The messages and status change without editing the passage. Layout and permission experiments are hidden; zoom and expansion remain available.'
          : undefined,
        preset === 'tracked-review'
          ? 'Tracked-change review: select a marked proposal and use the built-in toolbar to accept or reject it. Reset the sample to compare both decisions.'
          : undefined,
        localFile ? 'Local DOCX selection: enabled. Files remain in the browser.' : 'Local DOCX selection: disabled.',
      ].filter((value): value is string => Boolean(value));

      return `${quoteMarkdown(`**Interactive editor: ${title}**\n\n${details.join('\n\n')}`)}\n`;
    },
    TemplatePopulationDemo() {
      return renderTemplatePopulationMarkdown();
    },
    FileDownload({ attributes }) {
      const label = textAttribute(attributes, 'label') ?? 'Download file';
      const href = textAttribute(attributes, 'href');
      const description = textAttribute(attributes, 'description');
      const fileType = textAttribute(attributes, 'fileType');
      const link = href ? `[${label}](${href})` : label;
      const details = [description, fileType].filter((value): value is string => Boolean(value));
      return `${link}${details.length > 0 ? `: ${details.join(' · ')}` : ''}\n`;
    },
    FontResolutionExplorer() {
      return renderFontResolutionExplorerMarkdown();
    },
    FrameworkExample({ attributes, children }) {
      const framework = textAttribute(attributes, 'framework') ?? 'Framework';
      const filename = textAttribute(attributes, 'filename');
      const label = filename ? `**${framework} — \`${filename}\`**` : `**${framework}**`;
      return `${label}\n\n${children.trim()}\n\n`;
    },
    FrameworkExampleTabs({ children }) {
      return `${children.trim()}\n`;
    },
    LifecycleJourney() {
      return renderLifecycleJourneyMarkdown();
    },
    MigrationAgentPrompt() {
      // AIDEV-NOTE: The prompt itself, not a description of it. An agent
      // reading this export IS the audience the card exists for, so rendering
      // "copy the prompt to have your agent inspect the project" and omitting
      // the prompt would be the one failure that matters here.
      //
      // Relative URLs: this corpus is served from the same origin as the pages,
      // and unlike a clipboard paste the reader already has that context.
      return [
        '**Migrating with an AI coding agent?** Use this prompt:',
        '',
        '```text',
        'Help me migrate this project from SuperDoc v1 to v2.',
        '',
        'First, read these sources of truth:',
        '/md/editor/migrate-from-v1/overview.md',
        '/migration/v1-to-v2.json',
        '',
        'Inspect the project and report:',
        '1. Removed imports and package subpaths',
        '2. Any direct editor.* access, including commands, state, view, chain(), helpers, comments, presentationEditor, and on()',
        '3. Legacy configuration and collaboration usage',
        '4. Custom UI, extensions, and DOM selectors that require redesign',
        '5. Synchronous Document API reads such as doc.extract(), doc.getMarkdown(), and doc.selection.current(), which the browser resolves as Promises',
        '',
        'Do not change code yet. Classify each finding using the migration catalog,',
        'then propose the smallest safe migration sequence and a verification plan.',
        '```',
        '',
      ].join('\n');
    },
    MigrationExplorer() {
      // The explorer is a filter over the table that follows it on the page.
      // Restating every row here would duplicate that table in every machine-
      // readable projection, so this points at the data instead.
      return [
        '> **Searchable migration reference.**',
        '>',
        '> The interactive explorer filters the same entries listed in the tables below,',
        '> by symbol name, by when the failure surfaces, and by how much work the migration is.',
        '> A machine-readable version of every entry is published at `/migration/v1-to-v2.json`.',
        '',
      ].join('\n');
    },
    ProofingConfigReference() {
      return renderConfigReferenceMarkdown(proofingConfigExplorer);
    },
    RulerConfigReference() {
      return renderConfigReferenceMarkdown(rulerConfigExplorer);
    },
    SearchConfigReference() {
      return renderConfigReferenceMarkdown(searchConfigExplorer);
    },
    SurfaceLifecycleDemo() {
      return [
        '> **Live example: compare a dialog and a floating surface**',
        '>',
        '> Open confirmation to see a modal dialog finish as `submitted` or `closed`. Open inspector twice to see the first floating surface finish as `replaced` while the new inspector stays open. The floating inspector leaves the document usable. The status line reports each lifecycle result.',
        '',
      ].join('\n');
    },
    ThemePlayground() {
      return [
        '> **Live example: theme the Editor UI**',
        '>',
        '> Change the semantic action, surface, text, border, or radius value and the real Editor updates. The dialog inherits the same theme because the generated class is applied to `<html>`. Turning on Toolbar override adds `--sd-ui-toolbar-bg` after the semantic values. The generated `ThemeConfig` code updates with each choice.',
        '',
      ].join('\n');
    },
    ToolbarConfigReference() {
      return renderConfigReferenceMarkdown(toolbarConfigExplorer);
    },
    ReceiptBar({ attributes }) {
      const operation = textAttribute(attributes, 'operation') ?? 'operation';
      const detail = textAttribute(attributes, 'detail');
      return `**Receipt \`${operation}\`**${detail ? `: ${detail}` : ''}\n`;
    },
    RuntimeExample({ attributes, children }) {
      const runtime = textAttribute(attributes, 'runtime') ?? 'Runtime';
      return `### ${runtime}\n\n${children.trim()}\n\n`;
    },
    RuntimeExampleTabs({ children }) {
      return `${children.trim()}\n`;
    },
    MigrationExample({ attributes, children }) {
      // AIDEV-NOTE: A bold label, not a heading. Every migration operation is a
      // `####` on the page, so emitting `###` here closed the operation section
      // before its own examples: all 44 V1/V2 snippets became peers of the API
      // categories instead of children of the operation they demonstrate.
      // `RuntimeExample` keeps `###` because its operations are `##`.
      const version = textAttribute(attributes, 'version') ?? 'Version';
      return `**${version}**\n\n${children.trim()}\n\n`;
    },
    MigrationExampleTabs({ children }) {
      return `${children.trim()}\n`;
    },
    img({ attributes }) {
      const alt = textAttribute(attributes, 'alt') ?? 'Documentation diagram';
      const title = textAttribute(attributes, 'title');
      const label = title ? `Diagram: ${title}` : 'Diagram';
      return `> **${label}:** ${alt}\n`;
    },
  });
}
