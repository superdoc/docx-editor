import generatedCommentInteractionConfig from '@/generated/comment-interaction-config-reference.json';
import generatedCommentsConfig from '@/generated/comments-config-reference.json';
import generatedCommentsResponsiveConfig from '@/generated/comments-responsive-config-reference.json';
import type { ConfigExplorerData, ConfigField, ConfigFieldExample } from './config-explorer';
import type { CommentInteractionConfig, CommentsConfig, CommentsResponsiveConfig } from 'superdoc';

type DeprecatedCommentsField =
  | 'displayMode'
  | 'compactMeasurementSelector'
  | 'compactBreakpointPx'
  | 'highlightColors'
  | 'highlightOpacity'
  | 'highlightHoverColor'
  | 'trackChangeHighlightColors'
  | 'trackChangeActiveHighlightColors';
type UnavailableCommentsField = 'readOnly' | 'allowResolve' | 'level' | 'permissionResolver';
type DeprecatedCommentInteractionField = 'readOnly' | 'allowResolve';
type CommentsField = Exclude<keyof CommentsConfig, DeprecatedCommentsField | UnavailableCommentsField | 'responsive'>;
type CommentsResponsiveField = keyof CommentsResponsiveConfig;
type CommentInteractionField = Exclude<keyof CommentInteractionConfig, DeprecatedCommentInteractionField>;
type CommentsGroupId = 'display' | 'layout' | 'responsive' | 'actions';
type CommentsPresentation = {
  group: CommentsGroupId;
  summary: string;
  default?: string;
  example: ConfigFieldExample;
};

const commentsPresentation = {
  panel: option(
    'display',
    'Show the built-in comments panel. Same as setting ui.comments to false when off.',
    'false',
    'true',
  ),
  highlights: option(
    'display',
    'Highlight commented text. Turn off to paint your own with ui.decorations.',
    'false',
    'true',
  ),
  layout: option(
    'layout',
    'Place threads in a sidebar, inline with the document, or according to available width.',
    "'auto'",
    "'sidebar'",
  ),
} satisfies Record<CommentsField, CommentsPresentation>;

const responsivePresentation = {
  target: option('responsive', 'Measure this element when layout is auto.', "'#editor'"),
  breakpoint: option('responsive', 'Switch to inline threads below this width when layout is auto.', '900'),
} satisfies Record<CommentsResponsiveField, CommentsPresentation>;

const interactionPresentation = {
  level: option(
    'actions',
    'Allow reading only, writing comments, or resolving and reopening threads.',
    "'write'",
    "'resolve'",
  ),
} satisfies Record<CommentInteractionField, CommentsPresentation>;

const generatedComments = generatedCommentsConfig as ConfigExplorerData;
const generatedResponsive = generatedCommentsResponsiveConfig as ConfigExplorerData;
const generatedInteraction = generatedCommentInteractionConfig as ConfigExplorerData;

export const commentsConfigExplorer: ConfigExplorerData = {
  id: 'comments-config',
  name: 'Comments',
  sources: ['CommentsConfig', 'CommentsResponsiveConfig', 'CommentInteractionConfig'],
  root: 'comments',
  label: 'comments configuration',
  path: [],
  copyMode: 'selected-field',
  groups: [
    { id: 'display', label: 'Display', path: ['ui', 'comments'] },
    { id: 'layout', label: 'Layout', path: ['ui', 'comments'] },
    { id: 'responsive', label: 'Responsive', path: ['ui', 'comments', 'responsive'] },
    { id: 'actions', label: 'Actions', path: ['interaction', 'comments'] },
  ],
  fields: [
    ...generatedComments.fields
      .filter((field) => field.name !== 'responsive')
      .map((field) =>
        presentField(field, commentsPresentation[field.name as CommentsField], `ui.comments.${field.name}`),
      ),
    ...generatedResponsive.fields.map((field) =>
      presentField(
        field,
        responsivePresentation[field.name as CommentsResponsiveField],
        `ui.comments.responsive.${field.name}`,
      ),
    ),
    ...generatedInteraction.fields.map((field) =>
      presentField(
        field,
        interactionPresentation[field.name as CommentInteractionField],
        `interaction.comments.${field.name}`,
      ),
    ),
  ],
};

function option(group: CommentsGroupId, summary: string, value: string, defaultValue?: string): CommentsPresentation {
  return {
    group,
    summary,
    default: defaultValue,
    example: { value, code: '' },
  };
}

function presentField(field: ConfigField, fieldPresentation: CommentsPresentation, name: string): ConfigField {
  if (!fieldPresentation) throw new Error(`${field.name} is missing its Comments reference presentation.`);
  return {
    ...field,
    name,
    key: field.name,
    group: fieldPresentation.group,
    summary: fieldPresentation.summary,
    default: fieldPresentation.default,
    example: {
      ...fieldPresentation.example,
      code: `${field.name}: ${fieldPresentation.example.value}`,
    },
  };
}
