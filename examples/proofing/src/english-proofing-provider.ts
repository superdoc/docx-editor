import type { Config } from 'superdoc';
import Typo from 'typo-js';
import enUsAff from 'typo-js/dictionaries/en_US/en_US.aff?raw';
import enUsDic from 'typo-js/dictionaries/en_US/en_US.dic?raw';

type ProofingProvider = NonNullable<NonNullable<Config['proofing']>['provider']>;
type ProofingIssue = Awaited<ReturnType<ProofingProvider['check']>>['issues'][number];

const dictionary = new Typo('en_US', enUsAff, enUsDic);
const wordPattern = /[\p{L}]+(?:['’][\p{L}]+)*/gu;
const dictionaryWord = (word: string) => word.replaceAll('’', "'");

export const englishProofingProvider: ProofingProvider = {
  id: 'local-english-proofing',
  check: async ({ segments, signal }) => {
    const issues: ProofingIssue[] = [];
    let wordsSinceYield = 0;

    for (const segment of segments) {
      signal?.throwIfAborted();

      for (const match of segment.text.matchAll(wordPattern)) {
        const word = match[0];
        if (!dictionary.check(dictionaryWord(word))) {
          issues.push({
            segmentId: segment.id,
            start: match.index,
            end: match.index + word.length,
            kind: 'spelling',
            message: `“${word}” is not in the English dictionary`,
          });
        }

        wordsSinceYield += 1;
        if (wordsSinceYield === 50) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          signal?.throwIfAborted();
          wordsSinceYield = 0;
        }
      }
    }

    return { issues };
  },
  suggest: async ({ text, maxSuggestions = 3, signal }) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
    return { replacements: dictionary.suggest(dictionaryWord(text), maxSuggestions) };
  },
};
