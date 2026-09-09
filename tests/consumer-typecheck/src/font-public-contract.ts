/** Consumer typecheck: named font types match the configuration and runtime surfaces that expose them. */
import type { Config, FontResolutionRecord, FontsConfig, SuperDoc } from 'superdoc';

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

const configuredFonts: FontsConfig = {
  families: [
    {
      family: 'Aptos',
      faces: [{ source: '/fonts/aptos-regular.woff2', weight: 400, style: 'normal' }],
    },
  ],
  map: {
    Aptos: 'Inter',
  },
};

const configAcceptsNamedType: NonNullable<Config['fonts']> = configuredFonts;
const configShapeMatches: AssertEqual<FontsConfig, NonNullable<Config['fonts']>> = true;
const startupMapShapeMatches: AssertEqual<NonNullable<FontsConfig['map']>, Record<string, string>> = true;
const reportShapeMatches: AssertEqual<ReturnType<SuperDoc['fonts']['getReport']>, FontResolutionRecord[]> = true;

void [configAcceptsNamedType, configShapeMatches, startupMapShapeMatches, reportShapeMatches];
