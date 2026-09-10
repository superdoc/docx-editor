/**
 * Chart — rendering feature module
 *
 * Renders DrawingML chart blocks as inline SVG elements.
 * Supports bar/column, line, area, pie, doughnut, scatter, bubble,
 * radar, and stock charts, with a placeholder fallback for unsupported types.
 *
 * Performance guardrails:
 * - Max 20 rendered series
 * - Max 500 data points per series
 * - Max 5,000 SVG elements per chart
 *
 * @ooxml c:barChart     — bar and column charts (ECMA-376 §21.2.2.16)
 * @ooxml c:lineChart    — line charts (ECMA-376 §21.2.2.81)
 * @ooxml c:stockChart   — stock charts (ECMA-376 §21.2.2.157)
 * @ooxml c:areaChart    — area charts (ECMA-376 §21.2.2.1)
 * @ooxml c:scatterChart — scatter charts (ECMA-376 §21.2.2.147)
 * @ooxml c:bubbleChart  — bubble charts (ECMA-376 §21.2.2.20)
 * @ooxml c:radarChart   — radar charts (ECMA-376 §21.2.2.132)
 * @ooxml c:pieChart     — pie charts (ECMA-376 §21.2.2.126)
 * @ooxml c:doughnutChart — doughnut charts (ECMA-376 §21.2.2.50)
 * @ooxml c:ofPieChart   — bar-of-pie / pie-of-pie charts (ECMA-376 §21.2.2.111)
 * @spec  ECMA-376 §21.2 (DrawingML Charts)
 */

export { createChartElement, createChartPlaceholder, formatTickValue } from '../../chart-renderer.js';
