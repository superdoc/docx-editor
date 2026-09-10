/**
 * Runtime dispatch table for the invoke API.
 *
 * Maps every OperationId to a function that delegates to the corresponding
 * direct method on DocumentApi. Built once per createDocumentApi call.
 */
import type { OperationId } from '../contract/types.js';
import type { OperationRegistry } from '../contract/operation-registry.js';
import type { DocumentApi } from '../index.js';
import { INLINE_PROPERTY_REGISTRY } from '../format/inline-run-patch.js';
// ---------------------------------------------------------------------------
// TypedDispatchTable: compile-time contract between registry and dispatch
// ---------------------------------------------------------------------------
type DispatchOutput<K extends OperationId> = K extends 'mutations.preview' | 'mutations.apply'
  ? Promise<OperationRegistry[K]['output']>
  : K extends 'plan.execute'
    ? OperationRegistry[K]['output'] | Promise<OperationRegistry[K]['output']>
    : OperationRegistry[K]['output'];
type TypedDispatchHandler<K extends OperationId> = OperationRegistry[K]['options'] extends never
  ? (input: OperationRegistry[K]['input']) => DispatchOutput<K>
  : (input: OperationRegistry[K]['input'], options?: OperationRegistry[K]['options']) => DispatchOutput<K>;
export type TypedDispatchTable = {
  [K in OperationId]: TypedDispatchHandler<K>;
};
type FormatInlineAliasOperationId = `format.${(typeof INLINE_PROPERTY_REGISTRY)[number]['key']}`;
function buildFormatInlineAliasDispatch(api: DocumentApi): Pick<TypedDispatchTable, FormatInlineAliasOperationId> {
  return Object.fromEntries(
    INLINE_PROPERTY_REGISTRY.map((entry) => {
      const operationId = `format.${entry.key}` as FormatInlineAliasOperationId;
      return [
        operationId,
        (
          input: OperationRegistry[typeof operationId]['input'],
          options?: OperationRegistry[typeof operationId]['options'],
        ) =>
          (
            api.format[entry.key] as (
              input: OperationRegistry[typeof operationId]['input'],
              options?: OperationRegistry[typeof operationId]['options'],
            ) => OperationRegistry[typeof operationId]['output']
          )(input, options),
      ];
    }),
  ) as Pick<TypedDispatchTable, FormatInlineAliasOperationId>;
}
/**
 * Builds a dispatch table that maps every OperationId to the corresponding
 * direct method call on the given DocumentApi instance.
 *
 * Each entry delegates to the direct method: no parallel execution path.
 * The return type is {@link TypedDispatchTable}, which validates at compile
 * time that each handler conforms to the {@link OperationRegistry} contract.
 */
export function buildDispatchTable(api: DocumentApi): TypedDispatchTable {
  const formatInlineAliasDispatch = buildFormatInlineAliasDispatch(api);
  return {
    // --- Singleton reads ---
    get: (input) => api.get(input),
    find: (input) => api.find(input),
    getNode: (input) => api.getNode(input),
    getNodeById: (input) => api.getNodeById(input),
    getText: (input) => api.getText(input),
    getMarkdown: (input) => api.getMarkdown(input),
    getHtml: (input) => api.getHtml(input),
    projectMarkdown: (input) => api.projectMarkdown(input),
    projectHtml: (input) => api.projectHtml(input),
    markdownToFragment: (input) => api.markdownToFragment(input),
    htmlToFragment: (input) => api.htmlToFragment(input),
    info: (input) => api.info(input),
    extract: (input) => api.extract(input),
    // --- Singleton mutations ---
    clearContent: (input, options) => api.clearContent(input, options),
    insert: (input, options) => api.insert(input, options),
    replace: (input, options) => api.replace(input, options),
    delete: (input, options) => api.delete(input, options),
    formatRange: (input, options) => api.formatRange(input, options),
    // --- blocks.* ---
    'blocks.list': (input) => api.blocks.list(input),
    'blocks.findText': (input) => api.blocks.findText(input),
    'blocks.delete': (input, options) => api.blocks.delete(input, options),
    'blocks.deleteRange': (input, options) => api.blocks.deleteRange(input, options),
    'blocks.split': (input, options) => api.blocks.split(input, options),
    'blocks.merge': (input, options) => api.blocks.merge(input, options),
    'blocks.move': (input, options) => api.blocks.move(input, options),
    // --- format.* ---
    'format.apply': (input, options) => api.format.apply(input, options),
    ...formatInlineAliasDispatch,
    // --- styles.paragraph.* ---
    'styles.paragraph.setStyle': (input, options) => api.styles.paragraph.setStyle(input, options),
    'styles.paragraph.setStyleRef': (input, options) => api.styles.paragraph.setStyleRef(input, options),
    'styles.paragraph.clearStyle': (input, options) => api.styles.paragraph.clearStyle(input, options),
    // --- format.paragraph.* ---
    'format.paragraph.resetDirectFormatting': (input, options) =>
      api.format.paragraph.resetDirectFormatting(input, options),
    'format.paragraph.setAlignment': (input, options) => api.format.paragraph.setAlignment(input, options),
    'format.paragraph.clearAlignment': (input, options) => api.format.paragraph.clearAlignment(input, options),
    'format.paragraph.setIndentation': (input, options) => api.format.paragraph.setIndentation(input, options),
    'format.paragraph.clearIndentation': (input, options) => api.format.paragraph.clearIndentation(input, options),
    'format.paragraph.setSpacing': (input, options) => api.format.paragraph.setSpacing(input, options),
    'format.paragraph.clearSpacing': (input, options) => api.format.paragraph.clearSpacing(input, options),
    'format.paragraph.setKeepOptions': (input, options) => api.format.paragraph.setKeepOptions(input, options),
    'format.paragraph.setOutlineLevel': (input, options) => api.format.paragraph.setOutlineLevel(input, options),
    'format.paragraph.setFlowOptions': (input, options) => api.format.paragraph.setFlowOptions(input, options),
    'format.paragraph.setTabStop': (input, options) => api.format.paragraph.setTabStop(input, options),
    'format.paragraph.clearTabStop': (input, options) => api.format.paragraph.clearTabStop(input, options),
    'format.paragraph.clearAllTabStops': (input, options) => api.format.paragraph.clearAllTabStops(input, options),
    'format.paragraph.setBorder': (input, options) => api.format.paragraph.setBorder(input, options),
    'format.paragraph.clearBorder': (input, options) => api.format.paragraph.clearBorder(input, options),
    'format.paragraph.setShading': (input, options) => api.format.paragraph.setShading(input, options),
    'format.paragraph.clearShading': (input, options) => api.format.paragraph.clearShading(input, options),
    'format.paragraph.setMarkRunProps': (input, options) => api.format.paragraph.setMarkRunProps(input, options),
    'format.paragraph.setDirection': (input, options) => api.format.paragraph.setDirection(input, options),
    'format.paragraph.clearDirection': (input, options) => api.format.paragraph.clearDirection(input, options),
    'format.paragraph.setNumbering': (input, options) => api.format.paragraph.setNumbering(input, options),
    // --- styles.* ---
    'styles.apply': (input, options) => api.styles.apply(input, options),
    'styles.getCatalog': (input) => api.styles.getCatalog(input),
    // --- templates.* ---
    'templates.apply': (input, options) => api.templates.apply(input, options),
    // --- create.* ---
    'create.paragraph': (input, options) => api.create.paragraph(input, options),
    'create.heading': (input, options) => api.create.heading(input, options),
    'create.sectionBreak': (input, options) => api.create.sectionBreak(input, options),
    // --- lists.* ---
    'lists.list': (input) => api.lists.list(input),
    'lists.get': (input) => api.lists.get(input),
    'lists.insert': (input, options) => api.lists.insert(input, options),
    'lists.create': (input, options) => api.lists.create(input, options),
    'lists.attach': (input, options) => api.lists.attach(input, options),
    'lists.detach': (input, options) => api.lists.detach(input, options),
    'lists.delete': (input, options) => api.lists.delete(input, options),
    'lists.indent': (input, options) => api.lists.indent(input, options),
    'lists.outdent': (input, options) => api.lists.outdent(input, options),
    'lists.join': (input, options) => api.lists.join(input, options),
    'lists.canJoin': (input) => api.lists.canJoin(input),
    'lists.separate': (input, options) => api.lists.separate(input, options),
    'lists.merge': (input, options) => api.lists.merge(input, options),
    'lists.split': (input, options) => api.lists.split(input, options),
    'lists.setLevel': (input, options) => api.lists.setLevel(input, options),
    'lists.setValue': (input, options) => api.lists.setValue(input, options),
    'lists.continuePrevious': (input, options) => api.lists.continuePrevious(input, options),
    'lists.canContinuePrevious': (input) => api.lists.canContinuePrevious(input),
    'lists.setLevelRestart': (input, options) => api.lists.setLevelRestart(input, options),
    'lists.convertToText': (input, options) => api.lists.convertToText(input, options),
    // --- lists.* (SD-1973 formatting) ---
    'lists.applyTemplate': (input, options) => api.lists.applyTemplate(input, options),
    'lists.applyPreset': (input, options) => api.lists.applyPreset(input, options),
    'lists.setType': (input, options) => api.lists.setType(input, options),
    'lists.captureTemplate': (input) => api.lists.captureTemplate(input),
    'lists.setLevelNumbering': (input, options) => api.lists.setLevelNumbering(input, options),
    'lists.setLevelBullet': (input, options) => api.lists.setLevelBullet(input, options),
    'lists.setLevelPictureBullet': (input, options) => api.lists.setLevelPictureBullet(input, options),
    'lists.setLevelAlignment': (input, options) => api.lists.setLevelAlignment(input, options),
    'lists.setLevelIndents': (input, options) => api.lists.setLevelIndents(input, options),
    'lists.setLevelTrailingCharacter': (input, options) => api.lists.setLevelTrailingCharacter(input, options),
    'lists.setLevelMarkerFont': (input, options) => api.lists.setLevelMarkerFont(input, options),
    'lists.clearLevelOverrides': (input, options) => api.lists.clearLevelOverrides(input, options),
    // --- lists.* (SD-2025 user-facing) ---
    'lists.getStyle': (input) => api.lists.getStyle(input),
    'lists.applyStyle': (input, options) => api.lists.applyStyle(input, options),
    'lists.restartAt': (input, options) => api.lists.restartAt(input, options),
    'lists.setLevelNumberStyle': (input, options) => api.lists.setLevelNumberStyle(input, options),
    'lists.setLevelText': (input, options) => api.lists.setLevelText(input, options),
    'lists.setLevelStart': (input, options) => api.lists.setLevelStart(input, options),
    'lists.setLevelLayout': (input, options) => api.lists.setLevelLayout(input, options),
    // --- lists.* (v2 numbering-aware) ---
    'lists.getState': (input) => api.lists.getState(input),
    'lists.apply': (input, options) => api.lists.apply(input, options),
    'lists.continue': (input, options) => api.lists.continue(input, options),
    'lists.restart': (input, options) => api.lists.restart(input, options),
    'lists.remove': (input, options) => api.lists.remove(input, options),
    // --- sections.* ---
    'sections.list': (input) => api.sections.list(input),
    'sections.get': (input) => api.sections.get(input),
    'sections.setBreakType': (input, options) => api.sections.setBreakType(input, options),
    'sections.setPageMargins': (input, options) => api.sections.setPageMargins(input, options),
    'sections.setHeaderFooterMargins': (input, options) => api.sections.setHeaderFooterMargins(input, options),
    'sections.setPageSetup': (input, options) => api.sections.setPageSetup(input, options),
    'sections.setColumns': (input, options) => api.sections.setColumns(input, options),
    'sections.setLineNumbering': (input, options) => api.sections.setLineNumbering(input, options),
    'sections.setPageNumbering': (input, options) => api.sections.setPageNumbering(input, options),
    'sections.setTitlePage': (input, options) => api.sections.setTitlePage(input, options),
    'sections.setOddEvenHeadersFooters': (input, options) => api.sections.setOddEvenHeadersFooters(input, options),
    'sections.setVerticalAlign': (input, options) => api.sections.setVerticalAlign(input, options),
    'sections.setSectionDirection': (input, options) => api.sections.setSectionDirection(input, options),
    'sections.setHeaderFooterRef': (input, options) => api.sections.setHeaderFooterRef(input, options),
    'sections.clearHeaderFooterRef': (input, options) => api.sections.clearHeaderFooterRef(input, options),
    'sections.setLinkToPrevious': (input, options) => api.sections.setLinkToPrevious(input, options),
    'sections.setPageBorders': (input, options) => api.sections.setPageBorders(input, options),
    'sections.clearPageBorders': (input, options) => api.sections.clearPageBorders(input, options),
    // --- comments.* ---
    'comments.create': (input, options) => api.comments.create(input, options),
    'comments.patch': (input, options) => api.comments.patch(input, options),
    'comments.delete': (input, options) => api.comments.delete(input, options),
    'comments.get': (input) => api.comments.get(input),
    'comments.list': (input) => api.comments.list(input),
    // --- trackChanges.* ---
    'trackChanges.list': (input) => api.trackChanges.list(input),
    'trackChanges.get': (input) => api.trackChanges.get(input),
    'trackChanges.decide': (input, options) => api.trackChanges.decide(input, options),
    // --- query.* ---
    'query.match': (input) => api.query.match(input),
    // --- ranges.* ---
    'ranges.resolve': (input) => api.ranges.resolve(input),
    // --- selection.* ---
    'selection.current': (input) => api.selection.current(input),
    // --- mutations.* ---
    'mutations.preview': (input) => api.mutations.preview(input),
    'mutations.apply': (input) => api.mutations.apply(input),
    'plan.execute': (input) => api.plan.execute(input),
    // --- capabilities ---
    'capabilities.get': () => api.capabilities(),
    'capabilities.check': (input) => api.capabilities.check(input),
    // --- history.* ---
    'history.get': () => api.history.get(),
    'history.undo': () => api.history.undo(),
    'history.redo': () => api.history.redo(),
    // --- create.table ---
    'create.table': (input, options) => api.create.table(input, options),
    // --- tables.* ---
    'tables.convertFromText': (input, options) => api.tables.convertFromText(input, options),
    'tables.delete': (input, options) => api.tables.delete(input, options),
    'tables.clearContents': (input, options) => api.tables.clearContents(input, options),
    'tables.move': (input, options) => api.tables.move(input, options),
    'tables.split': (input, options) => api.tables.split(input, options),
    'tables.convertToText': (input, options) => api.tables.convertToText(input, options),
    'tables.setLayout': (input, options) => api.tables.setLayout(input, options),
    'tables.insertRow': (input, options) => api.tables.insertRow(input, options),
    'tables.deleteRow': (input, options) => api.tables.deleteRow(input, options),
    'tables.moveRow': (input, options) => api.tables.moveRow(input, options),
    'tables.setRowHeight': (input, options) => api.tables.setRowHeight(input, options),
    'tables.distributeRows': (input, options) => api.tables.distributeRows(input, options),
    'tables.setRowOptions': (input, options) => api.tables.setRowOptions(input, options),
    'tables.insertColumn': (input, options) => api.tables.insertColumn(input, options),
    'tables.deleteColumn': (input, options) => api.tables.deleteColumn(input, options),
    'tables.moveColumn': (input, options) => api.tables.moveColumn(input, options),
    'tables.setColumnWidth': (input, options) => api.tables.setColumnWidth(input, options),
    'tables.distributeColumns': (input, options) => api.tables.distributeColumns(input, options),
    'tables.insertCell': (input, options) => api.tables.insertCell(input, options),
    'tables.deleteCell': (input, options) => api.tables.deleteCell(input, options),
    'tables.mergeCells': (input, options) => api.tables.mergeCells(input, options),
    'tables.unmergeCells': (input, options) => api.tables.unmergeCells(input, options),
    'tables.splitCell': (input, options) => api.tables.splitCell(input, options),
    'tables.setCellProperties': (input, options) => api.tables.setCellProperties(input, options),
    'tables.setCellText': (input, options) => api.tables.setCellText(input, options),
    'tables.sort': (input, options) => api.tables.sort(input, options),
    'tables.setAltText': (input, options) => api.tables.setAltText(input, options),
    'tables.setStyle': (input, options) => api.tables.setStyle(input, options),
    'tables.clearStyle': (input, options) => api.tables.clearStyle(input, options),
    'tables.setStyleOption': (input, options) => api.tables.setStyleOption(input, options),
    'tables.setBorder': (input, options) => api.tables.setBorder(input, options),
    'tables.clearBorder': (input, options) => api.tables.clearBorder(input, options),
    'tables.applyBorderPreset': (input, options) => api.tables.applyBorderPreset(input, options),
    'tables.setShading': (input, options) => api.tables.setShading(input, options),
    'tables.clearShading': (input, options) => api.tables.clearShading(input, options),
    'tables.setTablePadding': (input, options) => api.tables.setTablePadding(input, options),
    'tables.setCellPadding': (input, options) => api.tables.setCellPadding(input, options),
    'tables.setCellSpacing': (input, options) => api.tables.setCellSpacing(input, options),
    'tables.clearCellSpacing': (input, options) => api.tables.clearCellSpacing(input, options),
    'tables.applyStyle': (input, options) => api.tables.applyStyle(input, options),
    'tables.setBorders': (input, options) => api.tables.setBorders(input, options),
    'tables.setTableOptions': (input, options) => api.tables.setTableOptions(input, options),
    'tables.applyPreset': (input, options) => api.tables.applyPreset(input, options),
    // --- tables.* reads ---
    'tables.get': (input) => api.tables.get(input),
    'tables.getCells': (input) => api.tables.getCells(input),
    'tables.getProperties': (input) => api.tables.getProperties(input),
    'tables.getStyles': (input) => api.tables.getStyles(input),
    'tables.setDefaultStyle': (input, options) => api.tables.setDefaultStyle(input, options),
    'tables.clearDefaultStyle': (input, options) => api.tables.clearDefaultStyle(input, options),
    // --- create.tableOfContents ---
    'create.tableOfContents': (input, options) => api.create.tableOfContents(input, options),
    // --- toc.* ---
    'toc.list': (input) => api.toc.list(input),
    'toc.get': (input) => api.toc.get(input),
    'toc.configure': (input, options) => api.toc.configure(input, options),
    'toc.update': (input, options) => api.toc.update(input, options),
    'toc.remove': (input, options) => api.toc.remove(input, options),
    // --- toc entry (TC field) operations ---
    'toc.markEntry': (input, options) => api.toc.markEntry(input, options),
    'toc.unmarkEntry': (input, options) => api.toc.unmarkEntry(input, options),
    'toc.listEntries': (input) => api.toc.listEntries(input),
    'toc.getEntry': (input) => api.toc.getEntry(input),
    'toc.editEntry': (input, options) => api.toc.editEntry(input, options),
    // --- create.image ---
    'create.image': (input, options) => api.create.image(input, options),
    // --- images.* ---
    'images.list': (input) => api.images.list(input),
    'images.get': (input) => api.images.get(input),
    'images.delete': (input, options) => api.images.delete(input, options),
    'images.move': (input, options) => api.images.move(input, options),
    'images.convertToInline': (input, options) => api.images.convertToInline(input, options),
    'images.convertToFloating': (input, options) => api.images.convertToFloating(input, options),
    'images.setSize': (input, options) => api.images.setSize(input, options),
    'images.setWrapType': (input, options) => api.images.setWrapType(input, options),
    'images.setWrapSide': (input, options) => api.images.setWrapSide(input, options),
    'images.setWrapDistances': (input, options) => api.images.setWrapDistances(input, options),
    'images.setPosition': (input, options) => api.images.setPosition(input, options),
    'images.setAnchorOptions': (input, options) => api.images.setAnchorOptions(input, options),
    'images.setZOrder': (input, options) => api.images.setZOrder(input, options),
    // SD-2100: Geometry
    'images.scale': (input, options) => api.images.scale(input, options),
    'images.setLockAspectRatio': (input, options) => api.images.setLockAspectRatio(input, options),
    'images.rotate': (input, options) => api.images.rotate(input, options),
    'images.flip': (input, options) => api.images.flip(input, options),
    'images.crop': (input, options) => api.images.crop(input, options),
    'images.resetCrop': (input, options) => api.images.resetCrop(input, options),
    // SD-2100: Content
    'images.replaceSource': (input, options) => api.images.replaceSource(input, options),
    // SD-2100: Semantic metadata
    'images.setAltText': (input, options) => api.images.setAltText(input, options),
    'images.setDecorative': (input, options) => api.images.setDecorative(input, options),
    'images.setName': (input, options) => api.images.setName(input, options),
    'images.setHyperlink': (input, options) => api.images.setHyperlink(input, options),
    // SD-2100: Caption lifecycle
    'images.insertCaption': (input, options) => api.images.insertCaption(input, options),
    'images.updateCaption': (input, options) => api.images.updateCaption(input, options),
    'images.removeCaption': (input, options) => api.images.removeCaption(input, options),
    // --- hyperlinks.* ---
    'hyperlinks.list': (input) => api.hyperlinks.list(input),
    'hyperlinks.get': (input) => api.hyperlinks.get(input),
    'hyperlinks.wrap': (input, options) => api.hyperlinks.wrap(input, options),
    'hyperlinks.insert': (input, options) => api.hyperlinks.insert(input, options),
    'hyperlinks.patch': (input, options) => api.hyperlinks.patch(input, options),
    'hyperlinks.remove': (input, options) => api.hyperlinks.remove(input, options),
    // --- headerFooters.* ---
    'headerFooters.list': (input) => api.headerFooters.list(input),
    'headerFooters.get': (input) => api.headerFooters.get(input),
    'headerFooters.resolve': (input) => api.headerFooters.resolve(input),
    'headerFooters.refs.set': (input, options) => api.headerFooters.refs.set(input, options),
    'headerFooters.refs.clear': (input, options) => api.headerFooters.refs.clear(input, options),
    'headerFooters.refs.setLinkedToPrevious': (input, options) =>
      api.headerFooters.refs.setLinkedToPrevious(input, options),
    'headerFooters.parts.list': (input) => api.headerFooters.parts.list(input),
    'headerFooters.parts.create': (input, options) => api.headerFooters.parts.create(input, options),
    'headerFooters.parts.delete': (input, options) => api.headerFooters.parts.delete(input, options),
    // --- create.contentControl ---
    'create.contentControl': (input, options) => api.create.contentControl(input, options),
    // --- contentControls.* core CRUD + discovery ---
    'contentControls.list': (input) => api.contentControls.list(input),
    'contentControls.get': (input) => api.contentControls.get(input),
    'contentControls.listInRange': (input) => api.contentControls.listInRange(input),
    'contentControls.selectByTag': (input) => api.contentControls.selectByTag(input),
    'contentControls.selectByTitle': (input) => api.contentControls.selectByTitle(input),
    'contentControls.listChildren': (input) => api.contentControls.listChildren(input),
    'contentControls.getParent': (input) => api.contentControls.getParent(input),
    'contentControls.wrap': (input, options) => api.contentControls.wrap(input, options),
    'contentControls.unwrap': (input, options) => api.contentControls.unwrap(input, options),
    'contentControls.delete': (input, options) => api.contentControls.delete(input, options),
    'contentControls.copy': (input, options) => api.contentControls.copy(input, options),
    'contentControls.move': (input, options) => api.contentControls.move(input, options),
    'contentControls.patch': (input, options) => api.contentControls.patch(input, options),
    'contentControls.setLockMode': (input, options) => api.contentControls.setLockMode(input, options),
    'contentControls.setType': (input, options) => api.contentControls.setType(input, options),
    'contentControls.getContent': (input) => api.contentControls.getContent(input),
    'contentControls.replaceContent': (input, options) => api.contentControls.replaceContent(input, options),
    'contentControls.clearContent': (input, options) => api.contentControls.clearContent(input, options),
    'contentControls.appendContent': (input, options) => api.contentControls.appendContent(input, options),
    'contentControls.prependContent': (input, options) => api.contentControls.prependContent(input, options),
    'contentControls.insertBefore': (input, options) => api.contentControls.insertBefore(input, options),
    'contentControls.insertAfter': (input, options) => api.contentControls.insertAfter(input, options),
    // --- contentControls.* data binding + raw ---
    'contentControls.getBinding': (input) => api.contentControls.getBinding(input),
    'contentControls.setBinding': (input, options) => api.contentControls.setBinding(input, options),
    'contentControls.clearBinding': (input, options) => api.contentControls.clearBinding(input, options),
    'contentControls.getRawProperties': (input) => api.contentControls.getRawProperties(input),
    'contentControls.patchRawProperties': (input, options) => api.contentControls.patchRawProperties(input, options),
    'contentControls.validateWordCompatibility': (input) => api.contentControls.validateWordCompatibility(input),
    'contentControls.normalizeWordCompatibility': (input, options) =>
      api.contentControls.normalizeWordCompatibility(input, options),
    'contentControls.normalizeTagPayload': (input, options) => api.contentControls.normalizeTagPayload(input, options),
    // --- clipboard.* ---
    'clipboard.parse': (input, options) => api.clipboard.parse(input, options),
    'clipboard.insert': (input, options) => api.clipboard.insert(input, options),
    'clipboard.serializeSelection': (input) => api.clipboard.serializeSelection(input),
    // --- contentControls.text.* ---
    'contentControls.text.setMultiline': (input, options) => api.contentControls.text.setMultiline(input, options),
    'contentControls.text.setValue': (input, options) => api.contentControls.text.setValue(input, options),
    'contentControls.text.clearValue': (input, options) => api.contentControls.text.clearValue(input, options),
    // --- contentControls.date.* ---
    'contentControls.date.setValue': (input, options) => api.contentControls.date.setValue(input, options),
    'contentControls.date.clearValue': (input, options) => api.contentControls.date.clearValue(input, options),
    'contentControls.date.setDisplayFormat': (input, options) =>
      api.contentControls.date.setDisplayFormat(input, options),
    'contentControls.date.setDisplayLocale': (input, options) =>
      api.contentControls.date.setDisplayLocale(input, options),
    'contentControls.date.setStorageFormat': (input, options) =>
      api.contentControls.date.setStorageFormat(input, options),
    'contentControls.date.setCalendar': (input, options) => api.contentControls.date.setCalendar(input, options),
    // --- contentControls.checkbox.* ---
    'contentControls.checkbox.getState': (input) => api.contentControls.checkbox.getState(input),
    'contentControls.checkbox.setState': (input, options) => api.contentControls.checkbox.setState(input, options),
    'contentControls.checkbox.toggle': (input, options) => api.contentControls.checkbox.toggle(input, options),
    'contentControls.checkbox.setSymbolPair': (input, options) =>
      api.contentControls.checkbox.setSymbolPair(input, options),
    // --- contentControls.choiceList.* ---
    'contentControls.choiceList.getItems': (input) => api.contentControls.choiceList.getItems(input),
    'contentControls.choiceList.setItems': (input, options) => api.contentControls.choiceList.setItems(input, options),
    'contentControls.choiceList.setSelected': (input, options) =>
      api.contentControls.choiceList.setSelected(input, options),
    // --- contentControls.repeatingSection.* ---
    'contentControls.repeatingSection.listItems': (input) => api.contentControls.repeatingSection.listItems(input),
    'contentControls.repeatingSection.insertItemBefore': (input, options) =>
      api.contentControls.repeatingSection.insertItemBefore(input, options),
    'contentControls.repeatingSection.insertItemAfter': (input, options) =>
      api.contentControls.repeatingSection.insertItemAfter(input, options),
    'contentControls.repeatingSection.cloneItem': (input, options) =>
      api.contentControls.repeatingSection.cloneItem(input, options),
    'contentControls.repeatingSection.deleteItem': (input, options) =>
      api.contentControls.repeatingSection.deleteItem(input, options),
    'contentControls.repeatingSection.setAllowInsertDelete': (input, options) =>
      api.contentControls.repeatingSection.setAllowInsertDelete(input, options),
    // --- contentControls.group.* ---
    'contentControls.group.wrap': (input, options) => api.contentControls.group.wrap(input, options),
    'contentControls.group.ungroup': (input, options) => api.contentControls.group.ungroup(input, options),
    // --- bookmarks.* ---
    'bookmarks.list': (input) => api.bookmarks.list(input),
    'bookmarks.get': (input) => api.bookmarks.get(input),
    'bookmarks.insert': (input, options) => api.bookmarks.insert(input, options),
    'bookmarks.rename': (input, options) => api.bookmarks.rename(input, options),
    'bookmarks.remove': (input, options) => api.bookmarks.remove(input, options),
    // --- footnotes.* ---
    'footnotes.list': (input) => api.footnotes.list(input),
    'footnotes.get': (input) => api.footnotes.get(input),
    'footnotes.insert': (input, options) => api.footnotes.insert(input, options),
    'footnotes.update': (input, options) => api.footnotes.update(input, options),
    'footnotes.remove': (input, options) => api.footnotes.remove(input, options),
    'footnotes.configure': (input, options) => api.footnotes.configure(input, options),
    // --- crossRefs.* ---
    'crossRefs.list': (input) => api.crossRefs.list(input),
    'crossRefs.get': (input) => api.crossRefs.get(input),
    'crossRefs.insert': (input, options) => api.crossRefs.insert(input, options),
    'crossRefs.rebuild': (input, options) => api.crossRefs.rebuild(input, options),
    'crossRefs.remove': (input, options) => api.crossRefs.remove(input, options),
    // --- index.* ---
    'index.list': (input) => api.index.list(input),
    'index.get': (input) => api.index.get(input),
    'index.insert': (input, options) => api.index.insert(input, options),
    'index.configure': (input, options) => api.index.configure(input, options),
    'index.rebuild': (input, options) => api.index.rebuild(input, options),
    'index.remove': (input, options) => api.index.remove(input, options),
    // --- index.entries.* ---
    'index.entries.list': (input) => api.index.entries.list(input),
    'index.entries.get': (input) => api.index.entries.get(input),
    'index.entries.insert': (input, options) => api.index.entries.insert(input, options),
    'index.entries.update': (input, options) => api.index.entries.update(input, options),
    'index.entries.remove': (input, options) => api.index.entries.remove(input, options),
    // --- captions.* ---
    'captions.list': (input) => api.captions.list(input),
    'captions.get': (input) => api.captions.get(input),
    'captions.insert': (input, options) => api.captions.insert(input, options),
    'captions.update': (input, options) => api.captions.update(input, options),
    'captions.remove': (input, options) => api.captions.remove(input, options),
    'captions.configure': (input, options) => api.captions.configure(input, options),
    // --- fields.* ---
    'fields.list': (input) => api.fields.list(input),
    'fields.get': (input) => api.fields.get(input),
    'fields.insert': (input, options) => api.fields.insert(input, options),
    'fields.rebuild': (input, options) => api.fields.rebuild(input, options),
    'fields.remove': (input, options) => api.fields.remove(input, options),
    // --- citations.* ---
    'citations.list': (input) => api.citations.list(input),
    'citations.get': (input) => api.citations.get(input),
    'citations.insert': (input, options) => api.citations.insert(input, options),
    'citations.update': (input, options) => api.citations.update(input, options),
    'citations.remove': (input, options) => api.citations.remove(input, options),
    // --- citations.sources.* ---
    'citations.sources.list': (input) => api.citations.sources.list(input),
    'citations.sources.get': (input) => api.citations.sources.get(input),
    'citations.sources.insert': (input, options) => api.citations.sources.insert(input, options),
    'citations.sources.update': (input, options) => api.citations.sources.update(input, options),
    'citations.sources.remove': (input, options) => api.citations.sources.remove(input, options),
    // --- citations.bibliography.* ---
    'citations.bibliography.get': (input) => api.citations.bibliography.get(input),
    'citations.bibliography.insert': (input, options) => api.citations.bibliography.insert(input, options),
    'citations.bibliography.rebuild': (input, options) => api.citations.bibliography.rebuild(input, options),
    'citations.bibliography.configure': (input, options) => api.citations.bibliography.configure(input, options),
    'citations.bibliography.remove': (input, options) => api.citations.bibliography.remove(input, options),
    // --- authorities.* ---
    'authorities.list': (input) => api.authorities.list(input),
    'authorities.get': (input) => api.authorities.get(input),
    'authorities.insert': (input, options) => api.authorities.insert(input, options),
    'authorities.configure': (input, options) => api.authorities.configure(input, options),
    'authorities.rebuild': (input, options) => api.authorities.rebuild(input, options),
    'authorities.remove': (input, options) => api.authorities.remove(input, options),
    // --- authorities.entries.* ---
    'authorities.entries.list': (input) => api.authorities.entries.list(input),
    'authorities.entries.get': (input) => api.authorities.entries.get(input),
    'authorities.entries.insert': (input, options) => api.authorities.entries.insert(input, options),
    'authorities.entries.update': (input, options) => api.authorities.entries.update(input, options),
    'authorities.entries.remove': (input, options) => api.authorities.entries.remove(input, options),
    // --- diff.* ---
    'diff.capture': () => api.diff.capture(),
    'diff.compare': (input) => api.diff.compare(input),
    'diff.apply': (input, options) => api.diff.apply(input, options),
    // --- export.* ---
    'export.toDocx': (input) => api.export.toDocx(input),
    // --- protection.* ---
    'protection.get': (input) => api.protection.get(input),
    'protection.setEditingRestriction': (input, options) => api.protection.setEditingRestriction(input, options),
    'protection.clearEditingRestriction': (input, options) => api.protection.clearEditingRestriction(input, options),
    // --- permissionRanges.* ---
    'permissionRanges.list': (input) => api.permissionRanges.list(input),
    'permissionRanges.get': (input) => api.permissionRanges.get(input),
    'permissionRanges.create': (input, options) => api.permissionRanges.create(input, options),
    'permissionRanges.remove': (input, options) => api.permissionRanges.remove(input, options),
    'permissionRanges.updatePrincipal': (input, options) => api.permissionRanges.updatePrincipal(input, options),
    // --- customXml.parts.* ---
    'customXml.parts.list': (input) => api.customXml.parts.list(input),
    'customXml.parts.get': (input) => api.customXml.parts.get(input),
    'customXml.parts.create': (input, options) => api.customXml.parts.create(input, options),
    'customXml.parts.patch': (input, options) => api.customXml.parts.patch(input, options),
    'customXml.parts.remove': (input, options) => api.customXml.parts.remove(input, options),
    // --- metadata.* (anchored metadata) ---
    'metadata.attach': (input, options) => api.metadata.attach(input, options),
    'metadata.list': (input) => api.metadata.list(input),
    'metadata.get': (input) => api.metadata.get(input),
    'metadata.update': (input, options) => api.metadata.update(input, options),
    'metadata.remove': (input, options) => api.metadata.remove(input, options),
    'metadata.resolve': (input) => api.metadata.resolve(input),
  };
}
