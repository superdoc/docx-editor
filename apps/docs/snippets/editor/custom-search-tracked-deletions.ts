import type { SuperDoc } from 'superdoc';

export function findPendingDeletion(superdoc: SuperDoc) {
  return superdoc.ui.search.find('Legacy', {
    includeTrackedDeletions: true,
  });
}
