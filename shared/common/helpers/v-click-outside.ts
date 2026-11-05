import type { Directive, DirectiveBinding } from 'vue';

interface ClickOutsideElement extends HTMLElement {
  __clickOutsideHandler?: (event: MouseEvent) => void;
  __clickOutsideDocument?: Document;
}

type ClickOutsideHandler = (event: MouseEvent) => void;
type ClickOutsideBinding = Pick<DirectiveBinding<ClickOutsideHandler>, 'value'>;

interface ClickOutsideRegistry {
  bindings: Map<ClickOutsideElement, ClickOutsideBinding>;
  listener: (event: MouseEvent) => void;
}

const registries = new WeakMap<Document, ClickOutsideRegistry>();

function ownerDocumentFor(el: ClickOutsideElement): Document {
  return el.ownerDocument ?? document;
}

function unregister(el: ClickOutsideElement, ownerDocument: Document): void {
  const registry = registries.get(ownerDocument);
  registry?.bindings.delete(el);
  if (registry && registry.bindings.size === 0) {
    ownerDocument.removeEventListener('click', registry.listener);
    registries.delete(ownerDocument);
  }
}

function register(el: ClickOutsideElement, binding: ClickOutsideBinding): void {
  const ownerDocument = ownerDocumentFor(el);
  if (el.__clickOutsideDocument && el.__clickOutsideDocument !== ownerDocument) {
    unregister(el, el.__clickOutsideDocument);
  }
  let registry = registries.get(ownerDocument);
  if (!registry) {
    const bindings = new Map<ClickOutsideElement, ClickOutsideBinding>();
    const listener = (event: MouseEvent) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
      for (const [element, currentBinding] of bindings) {
        const isInside = path?.includes(element) ?? element.contains(event.target as Node);
        if (!isInside) currentBinding.value?.(event);
      }
    };
    registry = { bindings, listener };
    registries.set(ownerDocument, registry);
    ownerDocument.addEventListener('click', listener);
  }
  registry.bindings.set(el, binding);
  el.__clickOutsideHandler = registry.listener;
  el.__clickOutsideDocument = ownerDocument;
}

export default {
  mounted(el: ClickOutsideElement, binding: ClickOutsideBinding) {
    register(el, binding);
  },
  updated(el: ClickOutsideElement, binding: ClickOutsideBinding) {
    register(el, binding);
  },
  unmounted(el: ClickOutsideElement) {
    unregister(el, el.__clickOutsideDocument ?? ownerDocumentFor(el));
    delete el.__clickOutsideHandler;
    delete el.__clickOutsideDocument;
  },
} satisfies Directive<ClickOutsideElement, ClickOutsideHandler>;
