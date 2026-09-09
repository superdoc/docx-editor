import type { ComponentProps } from 'react';
import type { MDXComponents } from 'mdx/types';
import type { StaticImageData } from 'next/image';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { CommandStateDemo } from '@/components/embeds/command-state-demo';
import { BuiltInUiMap } from '@/components/embeds/built-in-ui-map';
import { ClauseLibraryDemo } from '@/components/embeds/clause-library-demo';
import { ContentControlAuthoringDemo } from '@/components/embeds/content-control-authoring-demo';
import { ContentControlLocksDemo } from '@/components/embeds/content-control-locks-demo';
import { ContentControlPatterns } from '@/components/embeds/content-control-patterns';
import { CustomBoldDemo, CustomToolbarDemo } from '@/components/embeds/custom-bold-demo';
import { CustomCommentsDemo } from '@/components/embeds/custom-comments-demo';
import { CustomCommandDemo } from '@/components/embeds/custom-command-demo';
import { CustomContentControlsDemo } from '@/components/embeds/custom-content-controls-demo';
import { CustomDocumentControlsDemo } from '@/components/embeds/custom-document-controls-demo';
import { CustomSearchDemo } from '@/components/embeds/custom-search-demo';
import { CustomReviewFindingsDemo, CustomSelectionDemo } from '@/components/embeds/custom-selection-demo';
import { CustomTrackChangesDemo } from '@/components/embeds/custom-track-changes-demo';
import { CustomUiArchitecture } from '@/components/embeds/custom-ui-architecture';
import { CollaborationOverview } from '@/components/embeds/collaboration-overview';
import { CollaborationDemo } from '@/components/embeds/collaboration-demo';
import { DocumentPreview } from '@/components/embeds/document-preview';
import { EditorDemo } from '@/components/embeds/editor-demo';
import { FontResolutionExplorer } from '@/components/embeds/font-resolution-explorer';
import { InterfaceOwnership } from '@/components/embeds/interface-ownership';
import { SurfaceLifecycleDemo } from '@/components/embeds/surface-lifecycle-demo';
import { ThemePlayground } from '@/components/embeds/theme-playground';
import { DocsHome } from '@/components/docs-home';
import { Callout } from '@/components/mdx/callout';
import { CommentsConfigReference } from '@/components/mdx/comments-config-reference';
import { ConfigReference } from '@/components/mdx/ConfigReference';
import { ContextMenuConfigReference } from '@/components/mdx/context-menu-config-reference';
import { FileDownload } from '@/components/mdx/file-download';
import { FrameworkExample, FrameworkExampleTabs } from '@/components/mdx/FrameworkExampleTabs';
import { HyperlinksConfigReference } from '@/components/mdx/hyperlinks-config-reference';
import { LifecycleJourney } from '@/components/embeds/lifecycle-journey';
import { LoadingConfigReference } from '@/components/mdx/loading-config-reference';
import { MigrationAgentPrompt } from '@/components/mdx/MigrationAgentPrompt';
import { MigrationExplorer } from '@/components/mdx/migration-explorer';
import { MigrationExample, MigrationExampleTabs } from '@/components/mdx/migration-example-tabs';
import { ProofingConfigReference } from '@/components/mdx/proofing-config-reference';
import { ReceiptBar } from '@/components/mdx/receipt-bar';
import { RuntimeExample, RuntimeExampleTabs } from '@/components/mdx/runtime-example-tabs';
import { RulerConfigReference } from '@/components/mdx/ruler-config-reference';
import { SearchConfigReference } from '@/components/mdx/search-config-reference';
import { ToolbarConfigReference } from '@/components/mdx/toolbar-config-reference';
import { TemplatePopulationDemo } from '@/components/embeds/template-population-demo';
import {
  DocumentApiNamespace,
  DocumentApiOperation,
  DocumentApiReferenceLanding,
} from '@/components/document-api-reference';

function isStaticImageData(value: unknown): value is StaticImageData {
  if (typeof value !== 'object' || value === null || !('src' in value)) return false;
  return typeof value.src === 'string';
}

function DocsImage({ src, ...props }: ComponentProps<'img'>) {
  const imageSource: unknown = src;

  if (typeof imageSource === 'string' || isStaticImageData(imageSource)) {
    return <ImageZoom src={imageSource} {...props} />;
  }

  return <img src={src} {...props} />;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Callout,
    BuiltInUiMap,
    ClauseLibraryDemo,
    ContentControlAuthoringDemo,
    ContentControlLocksDemo,
    CommentsConfigReference,
    ConfigReference,
    ContextMenuConfigReference,
    CommandStateDemo,
    ContentControlPatterns,
    CustomBoldDemo,
    CustomCommentsDemo,
    CustomCommandDemo,
    CustomContentControlsDemo,
    CustomDocumentControlsDemo,
    CustomReviewFindingsDemo,
    CustomSearchDemo,
    CustomSelectionDemo,
    CustomTrackChangesDemo,
    CustomToolbarDemo,
    CustomUiArchitecture,
    CollaborationOverview,
    CollaborationDemo,
    DocumentPreview,
    DocumentApiNamespace,
    DocumentApiOperation,
    DocumentApiReferenceLanding,
    DocsHome,
    EditorDemo,
    FileDownload,
    FontResolutionExplorer,
    FrameworkExample,
    FrameworkExampleTabs,
    HyperlinksConfigReference,
    InterfaceOwnership,
    LifecycleJourney,
    LoadingConfigReference,
    MigrationAgentPrompt,
    MigrationExplorer,
    MigrationExample,
    MigrationExampleTabs,
    ProofingConfigReference,
    ReceiptBar,
    RuntimeExample,
    RuntimeExampleTabs,
    RulerConfigReference,
    SearchConfigReference,
    SurfaceLifecycleDemo,
    ThemePlayground,
    ToolbarConfigReference,
    TemplatePopulationDemo,
    img: DocsImage,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;
