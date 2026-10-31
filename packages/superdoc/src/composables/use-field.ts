import { ref, reactive } from 'vue';

export interface FieldOptionDefinition {
  itemdisplaylabel?: unknown;
  itemlinkvalue?: unknown;
  ischecked?: unknown;
  itemid?: unknown;
  annotationId?: unknown;
}

export interface FieldDefinition {
  itemid: { value?: unknown };
  itemicon?: unknown;
  itemiconpack?: unknown;
  itemdisplaylabel?: unknown;
  itemlinkvalue?: unknown;
  itemplaceholdertext?: unknown;
  itemtype?: string;
  itemfieldtype?: unknown;
  itemformat?: unknown;
  itemoptions?: FieldOptionDefinition[] | null;
  iteminputtype?: unknown;
  fontfamily?: string | null;
  font_size?: string | null;
  original_font_size?: string | null;
  logicrules?: unknown;
  valueGetter?: (data: object) => string;
}

export function useFieldValueWatcher(originalValue: unknown) {
  const valueIsObject = originalValue !== null && typeof originalValue === 'object';
  const value = valueIsObject ? reactive({ ...originalValue }) : ref(originalValue);
  return {
    value,
  };
}

export function useField(field: FieldDefinition) {
  const id = ref(field.itemid);

  const icon = ref(field.itemicon);
  const iconPack = ref(field.itemiconpack);

  const label = ref(field.itemdisplaylabel);
  const originalValue = field.itemlinkvalue;
  const placeholder = field.itemplaceholdertext;

  const { value } = useFieldValueWatcher(originalValue);

  const fieldType = ref(field.itemtype);
  const fieldSubType = ref(field.itemfieldtype);
  const originalJSON = field;
  const fieldStyle = reactive({
    fontFamily: field.fontfamily || 'Arial',
    fontSize: field.font_size || '12pt',
    originalFontSize: field.original_font_size || '12pt',
  });

  const logicRules = ref(field.logicrules);
  const hidden = ref(false);

  const additionalOptions = reactive<Record<string, unknown>>({});
  const fieldHandlers: Record<string, (field: FieldDefinition) => object> = {
    SELECT: useSelectField,
    IMAGEINPUT: useImageField,
    CHECKBOXINPUT: useCheckboxField,
  };
  const fieldTypeName = fieldType.value;
  if (fieldTypeName !== undefined && fieldTypeName in fieldHandlers) {
    Object.assign(additionalOptions, fieldHandlers[fieldTypeName](field));
  }

  const format = ref(field.itemformat);

  const valueGetter = field.valueGetter;

  return {
    id,
    icon,
    iconPack,
    label,
    placeholder,
    fieldType,
    fieldSubType,
    value,
    format,
    logicRules,
    hidden,
    originalJSON,
    fieldStyle,
    valueGetter,
    ...additionalOptions,
  };
}

export function useImageField(field: Pick<FieldDefinition, 'fontfamily' | 'iteminputtype'>) {
  const fontfamily = ref(field.fontfamily);
  const iteminputtype = ref(field.iteminputtype);

  const self = {
    fontfamily,
    iteminputtype,
  };
  return self;
}

export function useSelectField(field: Pick<FieldDefinition, 'itemoptions'>) {
  const options = ref(field.itemoptions);
  return {
    options,
  };
}

export function useCheckboxField(field: Pick<FieldDefinition, 'itemoptions'>) {
  const itemoptions = field.itemoptions;
  const options = ref(
    itemoptions
      ? itemoptions.map((option) => {
          return {
            label: option.itemdisplaylabel,
            value: option.itemlinkvalue,
            checked: option.ischecked,
            id: option.itemid,
            annotationId: option.annotationId,
          };
        })
      : itemoptions,
  );
  return {
    options,
  };
}
