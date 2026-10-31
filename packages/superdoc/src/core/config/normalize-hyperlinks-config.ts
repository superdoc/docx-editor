/**
 * Hyperlink activation is behavior, not a built-in UI surface. This profile
 * gives the top-level `hyperlinks` API precedence while preserving the
 * existing link-popover spellings.
 */

import { isPlainObject } from '../../helpers/object-guards.js';
import type {
  Config,
  HyperlinkActivationHandler,
  HyperlinksConfig,
  LinkPopoverConfig,
  LinkPopoverResolver,
  UIConfig,
} from '../types/index.js';

type HyperlinkHandler = HyperlinkActivationHandler | LinkPopoverResolver;
type HyperlinkHandlerSource = 'hyperlinks.onActivate' | 'compatibility';
type HyperlinkHandlerCandidate = { value: HyperlinkHandler | undefined; source: HyperlinkHandlerSource };

/**
 * Resolve hyperlink activation behavior.
 *
 * A canonical handler remains active under `ui: false` because an application
 * may navigate or render its own interface. Without a canonical handler, the
 * existing UI suppression rules keep their current behavior.
 */
export function normalizeHyperlinksConfig(config: Pick<Config, 'hyperlinks' | 'ui' | 'modules'> = {}): {
  handler: HyperlinkHandler | undefined;
  handlerSource: HyperlinkHandlerSource | undefined;
  editableActivationDisabled: boolean;
  builtInEditorDisabled: boolean;
  interceptsNavigationOnly: boolean;
} {
  const canonical: HyperlinksConfig = isPlainObject(config.hyperlinks) ? config.hyperlinks : {};
  const hasCanonicalHandler = typeof canonical.onActivate === 'function';
  const ui: UIConfig = isPlainObject(config.ui) ? config.ui : {};
  const legacyUi: LinkPopoverConfig = isPlainObject(ui.linkPopover) ? ui.linkPopover : {};

  const allActivationDisabled = config.hyperlinks === false;
  const builtInEditorDisabled = config.ui === false || ui.linkPopover === false;
  const candidates: HyperlinkHandlerCandidate[] = [
    { value: canonical.onActivate, source: 'hyperlinks.onActivate' },
    { value: legacyUi.popoverResolver, source: 'compatibility' },
    { value: config.modules?.links?.popoverResolver, source: 'compatibility' },
  ];
  const selectedHandler = candidates.find(({ value }) => value !== undefined);
  const editableActivationDisabled = allActivationDisabled || (!hasCanonicalHandler && builtInEditorDisabled);
  const handler =
    !editableActivationDisabled && typeof selectedHandler?.value === 'function' ? selectedHandler.value : undefined;

  return {
    handler,
    handlerSource: handler ? selectedHandler?.source : undefined,
    editableActivationDisabled,
    builtInEditorDisabled,
    interceptsNavigationOnly: allActivationDisabled || hasCanonicalHandler,
  };
}
