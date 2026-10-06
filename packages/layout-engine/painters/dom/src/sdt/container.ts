import type { SdtMetadata, StructuredContentMetadata } from '@superdoc/contracts';
export {
  getSdtContainerKey,
  getSdtContainerKeyForBlock,
  getSdtContainerMetadata,
  hasExplicitSdtContainerKey,
} from '@superdoc/contracts';
import { getSdtContainerKey, getSdtContainerMetadata } from '@superdoc/contracts';
import { DOM_CLASS_NAMES } from '../constants.js';

export type SdtContainerConfig = {
  className: string;
  labelText: string;
  labelClassName: string;
  isStart: boolean;
  isEnd: boolean;
} | null;

export type SdtBoundaryOptions = {
  isStart?: boolean;
  isEnd?: boolean;
  widthOverride?: number;
  paddingBottomOverride?: number;
  showLabel?: boolean;
};

export type SdtAncestorOptions = {
  ancestorContainerKey?: string | null;
  ancestorContainerSdt?: SdtMetadata | null;
  ancestorContainerKeys?: readonly (string | null | undefined)[];
  ancestorContainerSdts?: readonly (SdtMetadata | null | undefined)[];
};

export function isStructuredContentMetadata(sdt: SdtMetadata | null | undefined): sdt is StructuredContentMetadata {
  return (
    sdt !== null && sdt !== undefined && typeof sdt === 'object' && 'type' in sdt && sdt.type === 'structuredContent'
  );
}

export function isDocumentSectionMetadata(
  sdt: SdtMetadata | null | undefined,
): sdt is { type: 'documentSection'; title?: string | null } {
  return (
    sdt !== null && sdt !== undefined && typeof sdt === 'object' && 'type' in sdt && sdt.type === 'documentSection'
  );
}

export function getSdtContainerConfig(sdt: SdtMetadata | null | undefined): SdtContainerConfig {
  if (isDocumentSectionMetadata(sdt)) {
    return {
      className: 'superdoc-document-section',
      labelText: sdt.title ?? 'Document section',
      labelClassName: 'superdoc-document-section__tooltip',
      isStart: true,
      isEnd: true,
    };
  }

  if (isStructuredContentMetadata(sdt) && sdt.scope === 'block') {
    return {
      className: 'superdoc-structured-content-block',
      labelText: sdt.alias ?? 'Structured content',
      labelClassName: `${DOM_CLASS_NAMES.BLOCK_SDT_LABEL} superdoc-structured-content-block__label`,
      isStart: true,
      isEnd: true,
    };
  }

  return null;
}

export function shouldRenderSdtContainerChrome(
  sdt?: SdtMetadata | null,
  containerSdt?: SdtMetadata | null,
  options?: SdtAncestorOptions,
): boolean {
  const metadata = getSdtContainerMetadata(sdt, containerSdt);
  if (!metadata) return false;
  if (isStructuredContentMetadata(metadata) && metadata.appearance === 'hidden') {
    return false;
  }

  const containerKey = getSdtContainerKey(sdt, containerSdt);
  const ancestorKeys = [options?.ancestorContainerKey, ...(options?.ancestorContainerKeys ?? [])];
  if (containerKey && ancestorKeys.includes(containerKey)) {
    return false;
  }

  const ancestorSdts = [options?.ancestorContainerSdt, ...(options?.ancestorContainerSdts ?? [])];
  if (ancestorSdts.includes(metadata)) {
    return false;
  }

  return true;
}

export function getSdtSiblingBoundaries(
  containerKeys: readonly (string | null)[],
): Array<SdtBoundaryOptions | undefined> {
  return containerKeys.map((key, index): SdtBoundaryOptions | undefined => {
    if (!key) return undefined;
    const prev = index > 0 ? containerKeys[index - 1] : null;
    const next = index < containerKeys.length - 1 ? containerKeys[index + 1] : null;
    return { isStart: key !== prev, isEnd: key !== next };
  });
}

export function applySdtContainerChrome(
  doc: Document,
  container: HTMLElement,
  sdt: SdtMetadata | null | undefined,
  containerSdt?: SdtMetadata | null | undefined,
  boundaryOptions?: SdtBoundaryOptions,
  options?: SdtAncestorOptions,
  chrome?: 'default' | 'none',
): boolean {
  if (!shouldRenderSdtContainerChrome(sdt, containerSdt, options)) return false;

  const metadata = getSdtContainerMetadata(sdt, containerSdt);
  const config = getSdtContainerConfig(metadata);
  if (!config) return false;

  const isStart = boundaryOptions?.isStart ?? config.isStart;
  const isEnd = boundaryOptions?.isEnd ?? config.isEnd;
  const shouldShowLabel = boundaryOptions?.showLabel ?? isStart;

  if (isStructuredContentMetadata(metadata) && metadata.checkbox) {
    // Checkbox content controls use their child glyph as the visible control;
    // do not surround a block checkbox with generic SDT chrome or a label.
    container.classList.add('superdoc-word-checkbox-container');
    container.dataset.wordCheckbox = 'true';
    container.dataset.lockMode = metadata.lockMode || 'unlocked';
    // Boundary stamps are needed by page-content's fragment-reuse check even
    // though checkboxes do not render generic chrome or labels.
    container.dataset.sdtContainerStart = String(isStart);
    container.dataset.sdtContainerEnd = String(isEnd);
    container.dataset.sdtContainerLabel = String(shouldShowLabel);
    container.setAttribute('role', 'checkbox');
    container.setAttribute('aria-checked', String(metadata.checkbox.checked));
    container.setAttribute('aria-label', metadata.alias ?? 'Checkbox');
    if (metadata.lockMode === 'contentLocked' || metadata.lockMode === 'sdtContentLocked') {
      container.setAttribute('aria-disabled', 'true');
    } else {
      container.tabIndex = 0;
    }
    return true;
  }

  container.classList.add(config.className);
  container.dataset.sdtContainerStart = String(isStart);
  container.dataset.sdtContainerEnd = String(isEnd);
  container.style.overflow = 'visible';

  if (isStructuredContentMetadata(metadata)) {
    container.dataset.lockMode = metadata.lockMode || 'unlocked';
  }

  if (boundaryOptions?.widthOverride != null) {
    container.style.width = `${boundaryOptions.widthOverride}px`;
  }

  if (boundaryOptions?.paddingBottomOverride != null && boundaryOptions.paddingBottomOverride > 0) {
    container.style.paddingBottom = `${boundaryOptions.paddingBottomOverride}px`;
    container.style.setProperty('--sd-sdt-chrome-bottom-extension', `${boundaryOptions.paddingBottomOverride}px`);
  }

  // Rendered-label intent stamp: `shouldRebuildForSdtBoundary` compares it
  // against the label the next paint WOULD render, so patch/reuse paths
  // self-correct when the label-bearing page changes (window shifts, dense
  // repaints where an earlier page newly renders the label).
  container.dataset.sdtContainerLabel = String(shouldShowLabel);

  if (shouldShowLabel) {
    if (chrome === 'none' && isStructuredContentMetadata(metadata)) {
      return true;
    }
    const labelEl = doc.createElement('div');
    labelEl.className = config.labelClassName;
    const labelText = doc.createElement('span');
    labelText.textContent = config.labelText;
    labelEl.appendChild(labelText);
    container.appendChild(labelEl);
  }

  return true;
}

export function shouldRebuildForSdtBoundary(element: HTMLElement, boundary: SdtBoundaryOptions | undefined): boolean {
  if (!boundary) {
    return element.dataset.sdtContainerStart !== undefined;
  }
  const startAttr = element.dataset.sdtContainerStart;
  const endAttr = element.dataset.sdtContainerEnd;
  const expectedStart = String(boundary.isStart ?? true);
  const expectedEnd = String(boundary.isEnd ?? true);
  if (startAttr === undefined || endAttr === undefined) {
    return true;
  }
  // Label placement is cross-page prefix state (which page carries the
  // container label) that resolve stamps and geometry do not cover — a
  // reused fragment whose rendered-label state no longer matches what this
  // paint would render must rebuild. Mirrors `applySdtContainerChrome`'s
  // `showLabel ?? isStart` default; elements stamped before this attribute
  // existed rebuild once and gain it.
  const expectedLabel = String(boundary.showLabel ?? boundary.isStart ?? true);
  return startAttr !== expectedStart || endAttr !== expectedEnd || element.dataset.sdtContainerLabel !== expectedLabel;
}
