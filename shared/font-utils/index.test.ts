import { describe, it, expect } from 'bun:test';
import { FONT_FAMILY_FALLBACKS, DEFAULT_GENERIC_FALLBACK, mapWordFamilyFallback, toCssFontFamily } from './index.js';

describe('FONT_FAMILY_FALLBACKS', () => {
  it('should be frozen and contain expected mappings', () => {
    expect(Object.isFrozen(FONT_FAMILY_FALLBACKS)).toBe(true);
    expect(FONT_FAMILY_FALLBACKS).toEqual({
      swiss: 'Arial, sans-serif',
      roman: 'Times New Roman, serif',
      modern: 'Courier New, monospace',
      script: 'cursive',
      decorative: 'fantasy',
      system: 'system-ui',
      auto: 'sans-serif',
    });
  });
});

describe('DEFAULT_GENERIC_FALLBACK', () => {
  it('should be sans-serif', () => {
    expect(DEFAULT_GENERIC_FALLBACK).toBe('sans-serif');
  });
});

describe('mapWordFamilyFallback', () => {
  describe('valid values', () => {
    it('should map swiss to Arial, sans-serif', () => {
      expect(mapWordFamilyFallback('swiss')).toBe('Arial, sans-serif');
    });

    it('should map roman to Times New Roman, serif', () => {
      expect(mapWordFamilyFallback('roman')).toBe('Times New Roman, serif');
    });

    it('should map modern to Courier New, monospace', () => {
      expect(mapWordFamilyFallback('modern')).toBe('Courier New, monospace');
    });

    it('should map script to cursive', () => {
      expect(mapWordFamilyFallback('script')).toBe('cursive');
    });

    it('should map decorative to fantasy', () => {
      expect(mapWordFamilyFallback('decorative')).toBe('fantasy');
    });

    it('should map system to system-ui', () => {
      expect(mapWordFamilyFallback('system')).toBe('system-ui');
    });

    it('should map auto to sans-serif', () => {
      expect(mapWordFamilyFallback('auto')).toBe('sans-serif');
    });
  });

  describe('null and undefined', () => {
    it('should return default fallback for null', () => {
      expect(mapWordFamilyFallback(null)).toBe(DEFAULT_GENERIC_FALLBACK);
    });

    it('should return default fallback for undefined', () => {
      expect(mapWordFamilyFallback(undefined)).toBe(DEFAULT_GENERIC_FALLBACK);
    });

    it('should return default fallback when called without arguments', () => {
      expect(mapWordFamilyFallback()).toBe(DEFAULT_GENERIC_FALLBACK);
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase input', () => {
      expect(mapWordFamilyFallback('SWISS')).toBe('Arial, sans-serif');
    });

    it('should handle mixed case input', () => {
      expect(mapWordFamilyFallback('RoMaN')).toBe('Times New Roman, serif');
    });

    it('should handle PascalCase input', () => {
      expect(mapWordFamilyFallback('Decorative')).toBe('fantasy');
    });
  });

  describe('unknown values', () => {
    it('should return default fallback for unknown family', () => {
      expect(mapWordFamilyFallback('unknown')).toBe(DEFAULT_GENERIC_FALLBACK);
    });

    it('should return default fallback for arbitrary string', () => {
      expect(mapWordFamilyFallback('foobar')).toBe(DEFAULT_GENERIC_FALLBACK);
    });

    it('should return default fallback for numeric string', () => {
      expect(mapWordFamilyFallback('123')).toBe(DEFAULT_GENERIC_FALLBACK);
    });
  });

  describe('empty string', () => {
    it('should return default fallback for empty string', () => {
      expect(mapWordFamilyFallback('')).toBe(DEFAULT_GENERIC_FALLBACK);
    });

    it('should return default fallback for whitespace-only string', () => {
      expect(mapWordFamilyFallback('   ')).toBe(DEFAULT_GENERIC_FALLBACK);
    });
  });
});

describe('toCssFontFamily', () => {
  describe('null and undefined', () => {
    it('should return null for null input', () => {
      expect(toCssFontFamily(null)).toBe(null);
    });

    it('should return undefined for undefined input', () => {
      expect(toCssFontFamily(undefined)).toBe(undefined);
    });

    it('should return undefined when called without arguments', () => {
      expect(toCssFontFamily()).toBe(undefined);
    });
  });

  describe('invalid types', () => {
    it('should return number for number input', () => {
      expect(toCssFontFamily(123)).toBe(123);
    });

    it('should return boolean for boolean input', () => {
      expect(toCssFontFamily(true)).toBe(true);
    });

    it('should return object for object input', () => {
      const obj = { foo: 'bar' };
      expect(toCssFontFamily(obj)).toBe(obj);
    });

    it('should return array for array input', () => {
      const arr = ['Arial'];
      expect(toCssFontFamily(arr)).toBe(arr);
    });
  });

  describe('empty string', () => {
    it('should return empty string for empty string input', () => {
      expect(toCssFontFamily('')).toBe('');
    });

    it('should return empty string for whitespace-only string', () => {
      expect(toCssFontFamily('   ')).toBe('');
    });

    it('should return empty string for tab-only string', () => {
      expect(toCssFontFamily('\t\t')).toBe('');
    });

    it('should return empty string for newline-only string', () => {
      expect(toCssFontFamily('\n')).toBe('');
    });
  });

  describe('inherited font family', () => {
    it('leaves inherited font selection to the surrounding document style', () => {
      expect(toCssFontFamily('inherit')).toBeUndefined();
      expect(toCssFontFamily('INHERIT')).toBeUndefined();
    });
  });

  describe('comma handling', () => {
    it('should return as-is when input contains comma', () => {
      expect(toCssFontFamily('Arial, sans-serif')).toBe('Arial, sans-serif');
    });

    it('should return as-is when input contains multiple commas', () => {
      expect(toCssFontFamily('Arial, Helvetica, sans-serif')).toBe('Arial, Helvetica, sans-serif');
    });

    it('should return as-is for comma-separated list with spaces', () => {
      expect(toCssFontFamily('Georgia,  serif')).toBe('Georgia,  serif');
    });
  });

  describe('default fallback', () => {
    it('should append default fallback when no options provided', () => {
      expect(toCssFontFamily('Arial')).toBe('Arial, sans-serif');
    });

    it('should use serif fallback for known serif-like fonts', () => {
      expect(toCssFontFamily('Times New Roman')).toBe('Times New Roman, serif');
      expect(toCssFontFamily('Cambria')).toBe('Cambria, serif');
      expect(toCssFontFamily('Times')).toBe('Times, serif');
      expect(toCssFontFamily('Cambria Math')).toBe('Cambria Math, serif');
      expect(toCssFontFamily('Cochin')).toBe('Cochin, serif');
      expect(toCssFontFamily('Hoefler Text')).toBe('Hoefler Text, serif');
      expect(toCssFontFamily('Minion Pro')).toBe('Minion Pro, serif');
    });

    it('should append default fallback when options is empty object', () => {
      expect(toCssFontFamily('Courier', {})).toBe('Courier, monospace');
    });
  });

  describe('whitespace handling', () => {
    it('should trim leading whitespace', () => {
      expect(toCssFontFamily('  Arial')).toBe('Arial, sans-serif');
    });

    it('should trim trailing whitespace', () => {
      expect(toCssFontFamily('Arial  ')).toBe('Arial, sans-serif');
    });

    it('should trim both leading and trailing whitespace', () => {
      expect(toCssFontFamily('  Arial  ')).toBe('Arial, sans-serif');
    });

    it('should preserve internal whitespace in font names', () => {
      expect(toCssFontFamily('Times New Roman')).toBe('Times New Roman, serif');
    });
  });

  describe('custom fallback option', () => {
    it('should use custom fallback when provided', () => {
      expect(toCssFontFamily('Arial', { fallback: 'monospace' })).toBe('Arial, monospace');
    });

    it('should use custom multi-part fallback', () => {
      expect(toCssFontFamily('Georgia', { fallback: 'Times, serif' })).toBe('Georgia, Times, serif');
    });

    it('should use custom fallback with quotes', () => {
      expect(toCssFontFamily('MyFont', { fallback: '"Fallback Font", serif' })).toBe('MyFont, "Fallback Font", serif');
    });

    it('should handle empty custom fallback', () => {
      expect(toCssFontFamily('Arial', { fallback: '' })).toBe('Arial');
    });

    it('should handle whitespace-only custom fallback', () => {
      expect(toCssFontFamily('Arial', { fallback: '   ' })).toBe('Arial');
    });
  });

  describe('wordFamily option', () => {
    it('should use swiss family fallback', () => {
      expect(toCssFontFamily('Helvetica', { wordFamily: 'swiss' })).toBe('Helvetica, Arial, sans-serif');
    });

    it('should use roman family fallback', () => {
      expect(toCssFontFamily('Georgia', { wordFamily: 'roman' })).toBe('Georgia, Times New Roman, serif');
    });

    it('should use modern family fallback', () => {
      expect(toCssFontFamily('Monaco', { wordFamily: 'modern' })).toBe('Monaco, Courier New, monospace');
    });

    it('should use script family fallback', () => {
      expect(toCssFontFamily('Brush Script', { wordFamily: 'script' })).toBe('Brush Script, cursive');
    });

    it('should use decorative family fallback', () => {
      expect(toCssFontFamily('Impact', { wordFamily: 'decorative' })).toBe('Impact, fantasy');
    });

    it('should use system family fallback', () => {
      expect(toCssFontFamily('MyFont', { wordFamily: 'system' })).toBe('MyFont, system-ui');
    });

    it('should use auto family fallback', () => {
      expect(toCssFontFamily('MyFont', { wordFamily: 'auto' })).toBe('MyFont, sans-serif');
    });

    it('should handle null wordFamily', () => {
      expect(toCssFontFamily('Arial', { wordFamily: null })).toBe('Arial, sans-serif');
    });

    it('should handle undefined wordFamily', () => {
      expect(toCssFontFamily('Arial', { wordFamily: undefined })).toBe('Arial, sans-serif');
    });

    it('should handle unknown wordFamily', () => {
      expect(toCssFontFamily('Arial', { wordFamily: 'unknown' })).toBe('Arial, sans-serif');
    });

    it('should handle case-insensitive wordFamily', () => {
      expect(toCssFontFamily('Helvetica', { wordFamily: 'SWISS' })).toBe('Helvetica, Arial, sans-serif');
    });
  });

  describe('option precedence', () => {
    it('should prefer explicit fallback over wordFamily', () => {
      expect(toCssFontFamily('Arial', { fallback: 'serif', wordFamily: 'swiss' })).toBe('Arial, serif');
    });

    it('should prefer explicit fallback over default', () => {
      expect(toCssFontFamily('Arial', { fallback: 'monospace' })).toBe('Arial, monospace');
    });

    it('should prefer wordFamily over default when no fallback', () => {
      expect(toCssFontFamily('Arial', { wordFamily: 'roman' })).toBe('Arial, Times New Roman, serif');
    });

    it('should use default when both fallback and wordFamily are null', () => {
      expect(toCssFontFamily('Arial', { fallback: null, wordFamily: null })).toBe('Arial, sans-serif');
    });
  });

  describe('duplicate detection', () => {
    it('should not duplicate font if already in fallback (case-insensitive)', () => {
      expect(toCssFontFamily('Arial', { fallback: 'Arial, sans-serif' })).toBe('Arial, sans-serif');
    });

    it('should not duplicate font with different casing', () => {
      expect(toCssFontFamily('arial', { fallback: 'Arial, sans-serif' })).toBe('Arial, sans-serif');
    });

    it('should not duplicate font in middle of fallback chain', () => {
      expect(toCssFontFamily('Helvetica', { fallback: 'Arial, Helvetica, sans-serif' })).toBe(
        'Arial, Helvetica, sans-serif',
      );
    });

    it('should not duplicate when font matches generic family', () => {
      expect(toCssFontFamily('sans-serif', { fallback: 'sans-serif' })).toBe('sans-serif');
    });

    it('should not duplicate Times New Roman in roman family', () => {
      expect(toCssFontFamily('Times New Roman', { wordFamily: 'roman' })).toBe('Times New Roman, serif');
    });

    it('should not duplicate Arial in swiss family', () => {
      expect(toCssFontFamily('Arial', { wordFamily: 'swiss' })).toBe('Arial, sans-serif');
    });
  });

  describe('edge cases', () => {
    it('should handle font name with quotes', () => {
      expect(toCssFontFamily('"My Font"')).toBe('"My Font", sans-serif');
    });

    it('should handle font name with single quotes', () => {
      expect(toCssFontFamily("'My Font'")).toBe("'My Font', sans-serif");
    });

    it('should handle font name with numbers', () => {
      expect(toCssFontFamily('Arial-123')).toBe('Arial-123, sans-serif');
    });

    it('should handle font name with special characters', () => {
      expect(toCssFontFamily('Font-Name_123')).toBe('Font-Name_123, sans-serif');
    });

    it('should handle font name with unicode characters', () => {
      expect(toCssFontFamily('微软雅黑')).toBe('微软雅黑, sans-serif');
    });

    it('should handle very long font name', () => {
      const longName = 'A'.repeat(500);
      expect(toCssFontFamily(longName)).toBe(`${longName}, sans-serif`);
    });

    it('should handle fallback with extra whitespace', () => {
      expect(toCssFontFamily('Arial', { fallback: '  serif  ,  monospace  ' })).toBe('Arial, serif, monospace');
    });

    it('should handle fallback with empty parts after normalization', () => {
      expect(toCssFontFamily('Arial', { fallback: 'serif,,,monospace' })).toBe('Arial, serif, monospace');
    });

    it('should preserve original fallback order', () => {
      expect(toCssFontFamily('MyFont', { fallback: 'Font3, Font2, Font1' })).toBe('MyFont, Font3, Font2, Font1');
    });

    it('should handle duplicate detection with trimmed values', () => {
      expect(toCssFontFamily('Arial', { fallback: '  Arial  , sans-serif' })).toBe('Arial, sans-serif');
    });
  });

  describe('complex scenarios', () => {
    it('should handle combination of all features', () => {
      expect(toCssFontFamily('  Helvetica  ', { fallback: 'Arial, sans-serif' })).toBe('Helvetica, Arial, sans-serif');
    });

    it('should handle wordFamily with trimmed input', () => {
      expect(toCssFontFamily('  Monaco  ', { wordFamily: 'modern' })).toBe('Monaco, Courier New, monospace');
    });

    it('should handle empty fallback parts correctly', () => {
      expect(toCssFontFamily('Arial', { fallback: ', , serif, , ' })).toBe('Arial, serif');
    });

    it('should not add font if already exists with different whitespace', () => {
      expect(toCssFontFamily('Times New Roman', { fallback: 'times new roman, serif' })).toBe('times new roman, serif');
    });
  });

  describe('semicolon handling', () => {
    it('should convert semicolons to commas and append fallback', () => {
      expect(toCssFontFamily('Liberation Sans;Arial')).toBe('Liberation Sans, Arial, sans-serif');
    });

    it('should use wordFamily fallback with semicolon input', () => {
      expect(toCssFontFamily('Foo;Bar', { wordFamily: 'swiss' })).toBe('Foo, Bar, Arial, sans-serif');
    });

    it('should preserve semicolons inside quoted font names', () => {
      expect(toCssFontFamily('"Foo;Bar";Arial')).toBe('"Foo;Bar", Arial, sans-serif');
    });
  });
});
