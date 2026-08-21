/**
 * Smoke tests for the chart feature module public API.
 * Verifies that all exports are correctly re-exported through the feature
 * barrel and that the module handles every registered chart type without
 * throwing or returning a generic placeholder.
 *
 * Full rendering correctness is covered by chart-renderer.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createChartElement, createChartPlaceholder, formatTickValue } from './index.js';
import type { ChartModel, DrawingGeometry } from '@superdoc/contracts';

let doc: Document;

beforeEach(() => {
  doc = new JSDOM('<!DOCTYPE html><html><body></body></html>').window.document;
});

const geometry: DrawingGeometry = { width: 400, height: 300, rotation: 0, flipH: false, flipV: false };

const REGISTERED_CHART_TYPES: ChartModel['chartType'][] = [
  'barChart',
  'lineChart',
  'stockChart',
  'areaChart',
  'scatterChart',
  'bubbleChart',
  'radarChart',
  'pieChart',
  'doughnutChart',
  'ofPieChart',
];

function makeChart(chartType: ChartModel['chartType']): ChartModel {
  return {
    chartType,
    series: [
      { name: 'S1', categories: ['A', 'B', 'C'], values: [1, 2, 3], xValues: [1, 2, 3], bubbleSizes: [1, 2, 3] },
    ],
    legendPosition: 'b',
    barDirection: 'col',
  };
}

describe('chart feature module exports', () => {
  it('exports createChartElement as a function', () => {
    expect(typeof createChartElement).toBe('function');
  });

  it('exports createChartPlaceholder as a function', () => {
    expect(typeof createChartPlaceholder).toBe('function');
  });

  it('exports formatTickValue as a function', () => {
    expect(typeof formatTickValue).toBe('function');
  });
});

describe('createChartElement via feature module', () => {
  it('returns a superdoc-chart element', () => {
    const el = createChartElement(doc, makeChart('barChart'), geometry);
    expect(el.classList.contains('superdoc-chart')).toBe(true);
  });

  it('shows placeholder when chart data is missing', () => {
    const el = createChartElement(doc, undefined, geometry);
    expect(el.textContent).toContain('No chart data');
  });

  it.each(REGISTERED_CHART_TYPES)('renders %s without throwing', (chartType) => {
    const el = createChartElement(doc, makeChart(chartType), geometry);
    expect(el.classList.contains('superdoc-chart')).toBe(true);
    expect(el.textContent).not.toContain(`Chart: ${chartType}`);
  });
});

describe('createChartPlaceholder via feature module', () => {
  it('renders the label text', () => {
    const container = doc.createElement('div');
    const el = createChartPlaceholder(doc, container, 'Test label');
    expect(el.textContent).toContain('Test label');
  });
});

describe('formatTickValue via feature module', () => {
  it('formats thousands', () => expect(formatTickValue(1_500)).toBe('1.5K'));
  it('formats millions', () => expect(formatTickValue(2_000_000)).toBe('2.0M'));
  it('formats plain numbers', () => expect(formatTickValue(42)).toBe('42'));
});
