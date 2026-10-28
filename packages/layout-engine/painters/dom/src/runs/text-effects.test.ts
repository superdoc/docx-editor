import { describe, expect, it, vi } from 'vite-plus/test';

import { applyTextEffects, resolveTextReflectionMask, resolveTextReflectionTransform } from './text-effects.js';

describe('applyTextEffects', () => {
  it('paints solid fill, outline, and directional shadow independently', () => {
    const element = document.createElement('span');

    applyTextEffects(element, {
      fill: '#FFFFFF',
      outline: { width: 1, fill: '#E97132' },
      shadow: {
        color: { color: '#4EA72E', alpha: 0.5 },
        blurRadius: 0,
        distance: 4,
        direction: 45,
      },
    });

    expect(element.style.color).toBe('#FFFFFF');
    expect(element.style.webkitTextStroke).toBe('1px #E97132');
    expect(element.style.textShadow).toContain('2.8284271247461903px 2.82842712474619px 0px');
    expect(element.style.textShadow).toContain('rgba(78, 167, 46, 0.5)');
  });

  it('composes glow and outer shadow instead of letting one overwrite the other', () => {
    const element = document.createElement('span');

    applyTextEffects(element, {
      glow: { color: { color: '#E97132', alpha: 0.5 }, radius: 4 },
      shadow: {
        color: { color: '#000000' },
        blurRadius: 2,
        distance: 3,
        direction: 90,
      },
    });

    expect(element.style.textShadow).toContain('0px 0px 4px rgba(233, 113, 50, 0.5)');
    expect(element.style.textShadow).toContain('0px 3px 2px #000000');
  });

  it('paints gradient text and a below-text reflection without changing font metrics', () => {
    const element = document.createElement('span');

    applyTextEffects(element, {
      fill: {
        type: 'gradient',
        gradientType: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: '#275417' },
          { position: 1, color: '#4EA72E' },
        ],
      },
      reflection: {
        blurRadius: 0.66,
        distance: 0,
        direction: 90,
        startAlpha: 0.53,
        startPosition: 0,
        endAlpha: 0.003,
        endPosition: 0.355,
        scaleX: 1,
        scaleY: -0.9,
      },
    });

    expect(element.style.backgroundImage).toContain('linear-gradient(180deg');
    expect(element.style.backgroundClip).toBe('text');
    expect(element.style.color).toBe('transparent');
    // The non-browser test DOM has no Canvas 2D metrics, so reflection paint
    // fails closed here. Geometry is covered independently below with explicit
    // glyph bounds; the browser proof exercises the generated paint layer.
    expect(element.style.webkitBoxReflect).toBeUndefined();
    expect(element.style.fontSize).toBe('');
    expect(element.style.letterSpacing).toBe('');
  });

  it('anchors a scaled reflection to visible glyph ink instead of the CSS line box', () => {
    const placement = resolveTextReflectionTransform(
      {
        blurRadius: 0.66,
        distance: 0,
        direction: 90,
        startAlpha: 0.53,
        startPosition: 0,
        endAlpha: 0.003,
        endPosition: 0.355,
        scaleX: 1,
        scaleY: -0.9,
      },
      { left: 0, top: 13.5, right: 180.3, bottom: 45.42 },
    );

    expect(placement).toEqual({
      transform: 'translate(0px, 86.298px) scale(1, -0.9)',
      maskDirection: 'bottom',
    });
  });

  it('anchors reflection opacity stops to glyph ink instead of empty line-box leading', () => {
    const mask = resolveTextReflectionMask(
      {
        blurRadius: 0.66,
        distance: 0,
        direction: 90,
        fadeDirection: 90,
        startAlpha: 0.53,
        startPosition: 0,
        endAlpha: 0.003,
        endPosition: 0.355,
        scaleX: 1,
        scaleY: -0.9,
      },
      { left: 0, top: 13.5, right: 180.3, bottom: 45.42 },
      { width: 180.3, height: 59 },
    );

    expect(mask).toBe(
      'linear-gradient(to top, rgba(0, 0, 0, 0.53) 13.58px, rgba(0, 0, 0, 0.003) 24.9116px, transparent 100%)',
    );
  });

  it('paints reflection as generated content without duplicating selectable DOM text', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: () => ({
        actualBoundingBoxAscent: 31.55,
        actualBoundingBoxDescent: 0.42,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 180.3,
        fontBoundingBoxAscent: 45,
        fontBoundingBoxDescent: 14,
      }),
    } as unknown as CanvasRenderingContext2D);
    const element = document.createElement('span');
    element.textContent = 'Word Art';
    element.style.fontFamily = 'Aptos, sans-serif';
    element.style.fontSize = '48px';

    try {
      applyTextEffects(element, {
        reflection: {
          blurRadius: 0.66,
          distance: 0,
          direction: 90,
          startAlpha: 0.53,
          startPosition: 0,
          endAlpha: 0.003,
          endPosition: 0.355,
          scaleX: 1,
          scaleY: -0.9,
        },
      });
    } finally {
      getContext.mockRestore();
    }

    expect(element.textContent).toBe('Word Art');
    expect(element.childElementCount).toBe(0);
    expect(element.classList.contains('superdoc-text-reflection')).toBe(true);
    expect(element.dataset.superdocReflectionText).toBe('Word Art');
    expect(element.style.getPropertyValue('--sd-text-reflection-transform')).toBe(
      'translate(0px, 86.298px) scale(1, -0.9)',
    );
    expect(element.style.getPropertyValue('--sd-text-reflection-mask')).toContain('to top');
    expect(element.style.getPropertyValue('--sd-text-reflection-blur')).toBe('0.66px');
  });

  it.each([
    {
      fontVariantCaps: 'small-caps',
      translateY: 76,
      fadeStart: 10,
      fadeEnd: 22,
    },
    {
      fontVariantCaps: '',
      translateY: 91.2,
      fadeStart: 2,
      fadeEnd: 17,
    },
  ])('uses the painted $fontVariantCaps variant for reflection ink bounds', (testCase) => {
    const context = { font: '', measureText: vi.fn() };
    context.measureText.mockImplementation(() => {
      const smallCaps = context.font.includes('small-caps');
      return {
        width: smallCaps ? 60 : 65,
        actualBoundingBoxAscent: smallCaps ? 24 : 22,
        actualBoundingBoxDescent: smallCaps ? 0 : 8,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: smallCaps ? 60 : 65,
        fontBoundingBoxAscent: 40,
        fontBoundingBoxDescent: 10,
      };
    });
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const element = document.createElement('span');
    element.textContent = 'gyp ';
    element.style.fontFamily = 'Arial, sans-serif';
    element.style.fontSize = '40px';
    element.style.fontVariantCaps = testCase.fontVariantCaps;

    try {
      applyTextEffects(element, {
        reflection: {
          blurRadius: 0,
          distance: 0,
          direction: 90,
          startAlpha: 0.5,
          startPosition: 0,
          endAlpha: 0,
          endPosition: 0.5,
          scaleX: 1,
          scaleY: -0.9,
        },
      });
    } finally {
      getContext.mockRestore();
    }

    expect(element.style.getPropertyValue('--sd-text-reflection-transform')).toBe(
      `translate(0px, ${testCase.translateY}px) scale(1, -0.9)`,
    );
    expect(element.style.getPropertyValue('--sd-text-reflection-mask')).toBe(
      `linear-gradient(to top, rgba(0, 0, 0, 0.5) ${testCase.fadeStart}px, rgba(0, 0, 0, 0) ${testCase.fadeEnd}px, transparent 100%)`,
    );
    expect(context.measureText).toHaveBeenCalledWith('gyp ');
    expect(element.textContent).toBe('gyp ');
    expect(element.dataset.superdocReflectionText).toBe('gyp ');
  });

  it('fails closed for an unsupported gradient outline instead of inventing a stroke color', () => {
    const element = document.createElement('span');
    applyTextEffects(element, {
      outline: {
        width: 2,
        fill: {
          type: 'gradient',
          gradientType: 'linear',
          angle: 0,
          stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#FFFFFF' },
          ],
        },
      },
    });

    expect(element.style.webkitTextStroke).toBeUndefined();
  });
});
