import { describe, it, expect } from 'vite-plus/test';
import { isRef, isReactive, nextTick } from 'vue';
import { useField, useFieldValueWatcher, useImageField, useSelectField, useCheckboxField } from './use-field.js';

const makeField = (overrides = {}) => ({
  itemid: { value: 'field-1' },
  itemicon: 'icon-name',
  itemiconpack: 'fa',
  itemdisplaylabel: 'First name',
  itemlinkvalue: 'Alice',
  itemplaceholdertext: 'Enter name',
  itemtype: 'TEXTINPUT',
  itemfieldtype: 'text',
  itemformat: null,
  fontfamily: 'Helvetica',
  font_size: '14pt',
  original_font_size: '14pt',
  logicrules: [],
  ...overrides,
});

describe('useField', () => {
  it('exposes identity and style properties as refs/reactive', () => {
    const f = useField(makeField());
    expect(isRef(f.id)).toBe(true);
    expect(f.id.value).toEqual({ value: 'field-1' });
    expect(f.label.value).toBe('First name');
    expect(f.placeholder).toBe('Enter name');
    expect(isReactive(f.fieldStyle)).toBe(true);
    expect(f.fieldStyle.fontFamily).toBe('Helvetica');
    expect(f.fieldStyle.fontSize).toBe('14pt');
  });

  it('uses style defaults when font properties are missing', () => {
    const f = useField(makeField({ fontfamily: null, font_size: null, original_font_size: null }));
    expect(f.fieldStyle.fontFamily).toBe('Arial');
    expect(f.fieldStyle.fontSize).toBe('12pt');
  });

  it('preserves valueGetter from the raw field', () => {
    const fn = () => 'computed';
    const f = useField(makeField({ valueGetter: fn }));
    expect(f.valueGetter).toBe(fn);
  });

  it('applies SELECT handler additional options', () => {
    const f = useField(makeField({ itemtype: 'SELECT', itemoptions: [{ label: 'A', value: 'a' }] }));
    // refs auto-unwrap when assigned to a reactive container, so f.options is the array
    expect(f.options).toEqual([{ label: 'A', value: 'a' }]);
  });

  it('applies IMAGEINPUT handler additional options', () => {
    const f = useField(makeField({ itemtype: 'IMAGEINPUT', iteminputtype: 'file' }));
    expect(f.fontfamily).toBe('Helvetica');
    expect(f.iteminputtype).toBe('file');
  });

  it('transforms CHECKBOXINPUT options into normalized entries', () => {
    const f = useField(
      makeField({
        itemtype: 'CHECKBOXINPUT',
        itemoptions: [
          {
            itemdisplaylabel: 'Yes',
            itemlinkvalue: 'yes',
            ischecked: true,
            itemid: 'opt-1',
            annotationId: 'a-1',
          },
        ],
      }),
    );
    expect(f.options).toEqual([{ label: 'Yes', value: 'yes', checked: true, id: 'opt-1', annotationId: 'a-1' }]);
  });
});

describe('useFieldValueWatcher', () => {
  it('wraps primitive values in a ref', () => {
    const { value } = useFieldValueWatcher('hello');
    expect(isRef(value)).toBe(true);
    expect(value.value).toBe('hello');
  });

  it('wraps object values reactively and clones them', () => {
    const original = { a: 1, b: 2 };
    const { value } = useFieldValueWatcher(original);
    expect(isReactive(value)).toBe(true);
    expect(value).not.toBe(original);
    expect(value).toEqual(original);
  });

  it('does not mutate the source object when the reactive copy changes', async () => {
    const original = { a: 1 };
    const { value } = useFieldValueWatcher(original);
    value.a = 99;
    await nextTick();
    expect(original.a).toBe(1);
  });

  it('handles null as a primitive value', () => {
    const { value } = useFieldValueWatcher(null);
    expect(isRef(value)).toBe(true);
    expect(value.value).toBeNull();
  });
});

describe('field-type sub-handlers', () => {
  it('useImageField exposes font + input type refs', () => {
    const res = useImageField({ fontfamily: 'Inter', iteminputtype: 'camera' });
    expect(res.fontfamily.value).toBe('Inter');
    expect(res.iteminputtype.value).toBe('camera');
  });

  it('useSelectField exposes options as a ref', () => {
    const opts = [{ label: 'A' }];
    const res = useSelectField({ itemoptions: opts });
    expect(isRef(res.options)).toBe(true);
    expect(res.options.value).toEqual(opts);
  });

  it('useCheckboxField maps raw options to normalized entries', () => {
    const res = useCheckboxField({
      itemoptions: [
        {
          itemdisplaylabel: 'One',
          itemlinkvalue: '1',
          ischecked: false,
          itemid: 'o-1',
          annotationId: 'a-1',
        },
      ],
    });
    expect(res.options.value[0]).toEqual({
      label: 'One',
      value: '1',
      checked: false,
      id: 'o-1',
      annotationId: 'a-1',
    });
  });

  it('useCheckboxField leaves options untouched when falsy', () => {
    const res = useCheckboxField({ itemoptions: null });
    expect(res.options.value).toBeNull();
  });
});
