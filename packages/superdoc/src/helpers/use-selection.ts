import { ref, reactive, toRaw, type Ref } from 'vue';

type SelectionBounds = { top?: number; left?: number; right?: number; bottom?: number };

type UseSelectionParams = {
  documentId?: unknown;
  page?: number;
  selectionBounds?: SelectionBounds | null;
  source?: string | null;
};

type ContainerLocation = { top: number; left: number };

type SelectionValues<Bounds extends SelectionBounds> = {
  documentId: unknown;
  page: number | undefined;
  selectionBounds: Bounds;
  source: string | null | undefined;
};

type SelectionModel<Bounds extends SelectionBounds> = {
  documentId: Ref<unknown>;
  page: Ref<number | undefined>;
  selectionBounds: Bounds;
  source: Ref<string | null | undefined>;
  getValues: () => SelectionValues<Bounds>;
  getContainerId: () => string;
  getContainerLocation: (
    parentContainer: Pick<Element, 'getBoundingClientRect'> | null | undefined,
  ) => ContainerLocation;
};

export default function useSelection<Bounds extends SelectionBounds>(
  params: UseSelectionParams & { selectionBounds: Bounds },
): SelectionModel<Bounds>;
export default function useSelection(params: UseSelectionParams): SelectionModel<SelectionBounds>;
export default function useSelection(params: UseSelectionParams): SelectionModel<SelectionBounds> {
  const documentId = ref(params.documentId);
  const page = ref(params.page);
  const selectionBounds = reactive<SelectionBounds>(params.selectionBounds || {});
  const source = ref(params.source);

  const getContainerId = () => `${documentId.value}-page-${page.value}`;

  const getContainerLocation = (
    parentContainer: Pick<Element, 'getBoundingClientRect'> | null | undefined,
  ): ContainerLocation => {
    if (!parentContainer) return { top: 0, left: 0 };
    const parentBounds = parentContainer.getBoundingClientRect();
    const container = document.getElementById(getContainerId());

    let containerBounds: ContainerLocation = {
      top: 0,
      left: 0,
    };
    if (container) containerBounds = container.getBoundingClientRect();

    return {
      top: Number((containerBounds.top - parentBounds.top).toFixed(3)),
      left: Number((containerBounds.left - parentBounds.left).toFixed(3)),
    };
  };

  const getValues = () => {
    return {
      documentId: documentId.value,
      page: page.value,
      selectionBounds: toRaw(selectionBounds),
      source: source.value,
    };
  };

  return {
    documentId,
    page,
    selectionBounds,
    source,
    getValues,
    getContainerId,
    getContainerLocation,
  };
}
