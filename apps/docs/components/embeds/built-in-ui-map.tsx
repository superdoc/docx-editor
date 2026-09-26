'use client';

import { Fragment, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/ui/tabs';
import {
  builtInUiSurfaces,
  isBuiltInUiSurfaceId,
  type BuiltInUiInlinePart,
  type BuiltInUiSurfaceId,
} from '@/lib/built-in-ui-map';

function InitialBehavior({ parts }: { parts: readonly BuiltInUiInlinePart[] }) {
  return parts.map((part, index) => (
    <Fragment key={`${part.value}-${index}`}>{part.kind === 'code' ? <code>{part.value}</code> : part.value}</Fragment>
  ));
}

function regionClass(selected: BuiltInUiSurfaceId, region: BuiltInUiSurfaceId, kind: 'edge' | 'float') {
  const classes = ['sd-builtin-map-region', `sd-builtin-map-region-${kind}`];
  if (selected === region) classes.push('sd-builtin-map-region-active');
  if (selected !== 'layout' && selected !== region) classes.push('sd-builtin-map-region-dimmed');
  return classes.join(' ');
}

export function BuiltInUiMap() {
  const [selected, setSelected] = useState<BuiltInUiSurfaceId>('toolbar');

  return (
    <figure aria-label='Map of the built-in Editor surfaces' className='sd-builtin-map'>
      <Tabs
        className='sd-builtin-map-layout'
        onValueChange={(value) => {
          if (isBuiltInUiSurfaceId(value)) setSelected(value);
        }}
        orientation='vertical'
        value={selected}
      >
        <div
          aria-hidden='true'
          className={`sd-builtin-map-editor${selected === 'layout' ? ' sd-builtin-map-editor-active' : ''}`}
        >
          <div className='sd-builtin-map-chrome'>
            <span />
            <span />
            <span />
          </div>

          <div className={`${regionClass(selected, 'toolbar', 'edge')} sd-builtin-map-toolbar`}>
            <span className='sd-builtin-map-button sd-builtin-map-button-wide' />
            <span className='sd-builtin-map-button sd-builtin-map-button-selected' />
            <span className='sd-builtin-map-button' />
            <span className='sd-builtin-map-button' />
            <span className='sd-builtin-map-button' />
          </div>

          <div className={`${regionClass(selected, 'ruler', 'edge')} sd-builtin-map-ruler`}>
            <span className='sd-builtin-map-ruler-margin' />
            <span className='sd-builtin-map-ruler-ticks'>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className='sd-builtin-map-ruler-margin' />
          </div>

          <div className='sd-builtin-map-body'>
            <div className='sd-builtin-map-canvas'>
              {selected === 'watermarks' ? (
                <div className={`${regionClass(selected, 'watermarks', 'float')} sd-builtin-map-loading`}>
                  <strong>Watermark</strong>
                  <span>Text · Picture · Scope</span>
                </div>
              ) : null}
              {selected === 'loading' ? (
                <div className={`${regionClass(selected, 'loading', 'float')} sd-builtin-map-loading`}>
                  <span className='sd-builtin-map-loading-title' />
                  <span className='sd-builtin-map-loading-copy' />
                  <span className='sd-builtin-map-loading-track'>
                    <span />
                  </span>
                </div>
              ) : null}

              <div className={`${regionClass(selected, 'search', 'float')} sd-builtin-map-search`}>
                <span className='sd-builtin-map-search-icon' />
                <span className='sd-builtin-map-search-field' />
              </div>

              <div className='sd-builtin-map-page'>
                <span className='sd-builtin-map-line' style={{ width: '62%' }} />
                <span className='sd-builtin-map-line' style={{ width: '94%' }} />
                <div className='sd-builtin-map-segments' style={{ width: '88%' }}>
                  <span style={{ width: '26%' }} />
                  <span className='sd-builtin-map-deletion' style={{ width: '18%' }} />
                  <span className='sd-builtin-map-insertion' style={{ width: '18%' }} />
                  <span style={{ width: '30%' }} />
                </div>

                <div
                  className={`${regionClass(selected, 'content-controls', 'float')} sd-builtin-map-content-control`}
                  style={{ width: '70%' }}
                >
                  <span />
                  <span />
                </div>

                <div className='sd-builtin-map-segments' style={{ width: '80%' }}>
                  <span
                    className={`${regionClass(selected, 'hyperlinks', 'float')} sd-builtin-map-hyperlink`}
                    style={{ width: '34%' }}
                  />
                  <span style={{ width: '50%' }} />
                </div>
                <span className='sd-builtin-map-line' style={{ width: '56%' }} />

                <div className={`${regionClass(selected, 'context-menu', 'float')} sd-builtin-map-menu`}>
                  <span style={{ width: '70%' }} />
                  <span style={{ width: '55%' }} />
                  <span style={{ width: '62%' }} />
                </div>
              </div>
            </div>

            <div className={`${regionClass(selected, 'comments', 'edge')} sd-builtin-map-comments`}>
              <div className='sd-builtin-map-comment'>
                <span className='sd-builtin-map-avatar' />
                <span style={{ width: '92%' }} />
                <span style={{ width: '64%' }} />
              </div>
            </div>
          </div>
        </div>

        <div className='sd-builtin-map-index'>
          <TabsList aria-label='Built-in UI guides' className='sd-builtin-map-tabs'>
            {builtInUiSurfaces.map((surface) => (
              <TabsTrigger className='sd-builtin-map-trigger' key={surface.id} value={surface.id}>
                <span aria-hidden='true' />
                {surface.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {builtInUiSurfaces.map((surface) => (
            <TabsContent className='sd-builtin-map-detail' key={surface.id} value={surface.id}>
              <div className='sd-builtin-map-detail-layout'>
                <div className='sd-builtin-map-detail-heading'>
                  <h3>{surface.label}</h3>
                  <a href={surface.href}>Open guide →</a>
                </div>

                <div className='sd-builtin-map-detail-copy'>
                  <p>
                    <strong>Initial behavior:</strong> <InitialBehavior parts={surface.initialBehavior} />
                  </p>
                  <p>{surface.description}</p>
                </div>
              </div>
            </TabsContent>
          ))}

          <p className='sd-builtin-map-note'>
            The marks in the document are tracked changes. <a href='/editor/track-changes'>Learn how to review them</a>.
          </p>
        </div>
      </Tabs>
    </figure>
  );
}
