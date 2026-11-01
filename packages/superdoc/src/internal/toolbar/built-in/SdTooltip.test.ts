import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SdTooltip from './SdTooltip.vue';

let wrapper;

const mountTooltip = () =>
  mount(SdTooltip, {
    props: { delay: 0 },
    slots: {
      trigger: '<button type="button">Aa</button>',
      default: 'Font family',
    },
    attachTo: document.body,
  });

const showTooltip = async () => {
  await wrapper.get('.sd-tooltip-trigger').trigger('mouseenter');
  await nextTick();
  await nextTick();
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('SdTooltip auto-dismiss', () => {
  it('hides automatically after the delay even while the trigger stays hovered', async () => {
    wrapper = mountTooltip();

    await showTooltip();
    expect(document.body.querySelector('.sd-tooltip-content')?.textContent).toContain('Font family');

    vi.advanceTimersByTime(2400);
    await nextTick();
    expect(document.body.querySelector('.sd-tooltip-content')).not.toBeNull();

    vi.advanceTimersByTime(200);
    await nextTick();
    expect(document.body.querySelector('.sd-tooltip-content')).toBeNull();
  });
});
describe('SdTooltip activation', () => {
  it('dismisses when a trigger child stops click propagation', async () => {
    wrapper = mountTooltip();
    wrapper.get('button').element.addEventListener('click', (event) => event.stopPropagation());
    await showTooltip();

    await wrapper.get('button').trigger('click');
    await nextTick();

    expect(document.body.querySelector('.sd-tooltip-content')).toBeNull();
  });

  it('cancels a pending open when the trigger is activated before the hover delay', async () => {
    wrapper = mountTooltip();
    await wrapper.setProps({ delay: 100 });
    await wrapper.get('.sd-tooltip-trigger').trigger('mouseenter');
    await wrapper.get('button').trigger('click');

    vi.advanceTimersByTime(150);
    await nextTick();
    expect(document.body.querySelector('.sd-tooltip-content')).toBeNull();

    await wrapper.get('.sd-tooltip-trigger').trigger('mouseleave');
    await wrapper.get('.sd-tooltip-trigger').trigger('mouseenter');
    vi.advanceTimersByTime(150);
    await nextTick();
    expect(document.body.querySelector('.sd-tooltip-content')).not.toBeNull();
  });
});
