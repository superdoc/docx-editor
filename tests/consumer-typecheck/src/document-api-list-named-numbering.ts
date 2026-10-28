import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;

type NumberStyleInput = Parameters<DocumentApi['lists']['setLevelNumberStyle']>[0];
type NumberStyleResult = ReturnType<DocumentApi['lists']['setLevelNumberStyle']>;
type NumberStyleFailureCode = Extract<NumberStyleResult, { success: false }>['failure']['code'];

const failureCodeIsLiteral: string extends NumberStyleFailureCode ? false : true = true;
const requiredFailureCodes: readonly NumberStyleFailureCode[] = ['CAPABILITY_UNAVAILABLE', 'NO_OP'];

const input: NumberStyleInput = {
  target: { kind: 'block', nodeType: 'listItem', nodeId: 'section-1' },
  level: 0,
  numberStyle: 'upperRoman',
};
const result: NumberStyleResult = doc.lists.setLevelNumberStyle(input);
if (result.success) {
  const changed: boolean | undefined = result.changed;
  const txId: string | undefined = result.txId;
  void changed;
  void txId;
} else {
  const code: NumberStyleFailureCode = result.failure.code;
  void code;
}

const numberInDashInput: NumberStyleInput = { ...input, numberStyle: 'numberInDash' };
doc.lists.setLevelNumberStyle(numberInDashInput);

void [failureCodeIsLiteral, requiredFailureCodes];
