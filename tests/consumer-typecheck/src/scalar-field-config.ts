import type { Config, SuperDoc } from 'superdoc';

const config: Config = {
  selector: '#editor',
  fieldContext: {
    fileName: 'Agreement.docx',
    fullPath: '/legal/Agreement.docx',
    currentUser: { name: 'Ada', initials: 'AL', address: 'First Street\nLondon' },
  },
  fieldUpdatePolicy: 'refreshOnOpen',
};
const empty: Config = { selector: '#editor', fieldContext: { fileName: '', currentUser: null } };
const multiple: Config = {
  selector: '#editor',
  documents: [
    { type: 'docx', url: '/first.docx', fieldContext: { fileName: 'First.docx' } },
    { type: 'docx', url: '/second.docx', fieldContext: { fileName: 'Second.docx' } },
  ],
};
const invalidName: Config = {
  selector: '#editor',
  // @ts-expect-error Field values are explicit strings, not author identifiers.
  fieldContext: { fileName: 12 },
};
const invalidPolicy: Config = {
  selector: '#editor',
  // @ts-expect-error Passive layout is never an automatic refresh policy.
  fieldUpdatePolicy: 'everyLayout',
};
declare const document: SuperDoc;
const readback: Config['fieldContext'] = document.config.fieldContext;
const documentReadback: Config['fieldContext'] = document.state.documents[0]?.fieldContext;
void [config, empty, multiple, invalidName, invalidPolicy, readback, documentReadback];
