import type { SdtMetadata } from './index.js';

type SdtBlockCandidate = {
  attrs?: {
    sdt?: SdtMetadata | null;
    containerSdt?: SdtMetadata | null;
  } | null;
};

const idlessSdtContainerKeys = new WeakMap<SdtMetadata, string>();
let nextIdlessSdtContainerKey = 0;

function getIdlessSdtContainerKey(metadata: SdtMetadata): string {
  const existingKey = idlessSdtContainerKeys.get(metadata);
  if (existingKey) return existingKey;

  const key = `idlessSdt:${++nextIdlessSdtContainerKey}`;
  idlessSdtContainerKeys.set(metadata, key);
  return key;
}

export function isSdtContainerMetadata(sdt: SdtMetadata | null | undefined): boolean {
  if (!sdt) return false;
  if (sdt.type === 'documentSection') return true;
  if (sdt.type === 'structuredContent' && sdt.scope === 'block') return true;
  return false;
}

export function getSdtContainerMetadata(
  sdt?: SdtMetadata | null,
  containerSdt?: SdtMetadata | null,
): SdtMetadata | null {
  if (isSdtContainerMetadata(sdt)) return sdt ?? null;
  if (isSdtContainerMetadata(containerSdt)) return containerSdt ?? null;
  return null;
}

export function getSdtContainerKey(sdt?: SdtMetadata | null, containerSdt?: SdtMetadata | null): string | null {
  const metadata = getSdtContainerMetadata(sdt, containerSdt);
  if (!metadata) return null;

  if (metadata.type === 'structuredContent') {
    if (metadata.scope !== 'block') return null;
    if (metadata.id) return `structuredContent:${metadata.id}`;
    return getIdlessSdtContainerKey(metadata);
  }

  if (metadata.type === 'documentSection') {
    const sectionId = metadata.id ?? metadata.sdBlockId;
    if (sectionId) return `documentSection:${sectionId}`;
    return getIdlessSdtContainerKey(metadata);
  }

  return null;
}

export function hasExplicitSdtContainerKey(sdt?: SdtMetadata | null, containerSdt?: SdtMetadata | null): boolean {
  const metadata = getSdtContainerMetadata(sdt, containerSdt);
  if (!metadata) return false;

  if (metadata.type === 'structuredContent') {
    return metadata.scope === 'block' && Boolean(metadata.id);
  }

  if (metadata.type === 'documentSection') {
    return Boolean(metadata.id ?? metadata.sdBlockId);
  }

  return false;
}

export function getSdtContainerKeyForBlock(block?: SdtBlockCandidate | null): string | null {
  if (!block) return null;
  return getSdtContainerKey(block.attrs?.sdt, block.attrs?.containerSdt);
}
