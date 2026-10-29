import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { cdnQuickstartHtml } from '@/lib/cdn-quickstart';

export function CdnQuickstart() {
  return <DynamicCodeBlock code={cdnQuickstartHtml} codeblock={{ title: 'index.html' }} lang='html' />;
}
