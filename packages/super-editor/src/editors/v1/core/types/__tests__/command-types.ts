import type { ExtensionCommandMap } from '@core/types/ChainedCommands.js';

type ExpectTrue<T extends true> = T;
type Equal<A, B> = (<U>() => U extends A ? 1 : 2) extends <U>() => U extends B ? 1 : 2 ? true : false;

type SearchReturn = ReturnType<ExtensionCommandMap['search']>;
type AssertSearchReturn = ExpectTrue<Equal<SearchReturn, { id: string; from: number; to: number; text: string }[]>>;

type InsertBookmarkArgs = Parameters<ExtensionCommandMap['insertBookmark']>[0];
type AssertBookmarkArgs = ExpectTrue<
  Equal<
    InsertBookmarkArgs,
    {
      name: string;
      id?: string | null;
      colFirst?: number | string | null;
      colLast?: number | string | null;
      displacedByCustomXml?: string | null;
    }
  >
>;

type SetHeadingArgs = Parameters<ExtensionCommandMap['setHeading']>[0];
type AssertHeadingArgs = ExpectTrue<Equal<SetHeadingArgs, { level: number }>>;

type AppendRowsArgs = Parameters<ExtensionCommandMap['appendRowsWithContent']>[0];
type AssertAppendRowsArgs = ExpectTrue<
  Equal<
    AppendRowsArgs,
    { tablePos?: number | null; tableNode?: unknown; valueRows?: unknown[][]; copyRowStyle?: boolean }
  >
>;

type StructuredTableArgs = Parameters<ExtensionCommandMap['appendRowsToStructuredContentTable']>[0];
type AssertStructuredTableArgs = ExpectTrue<
  Equal<
    StructuredTableArgs,
    { id: string; tableIndex?: number; rows?: Array<string[] | string>; copyRowStyle?: boolean }
  >
>;

type SearchResultCheck =
  SearchReturn extends Array<{ id: string; from: number; to: number; text: string }> ? true : false;
type AssertSearchShape = ExpectTrue<SearchResultCheck>;

void (0 as unknown as AssertSearchReturn);
void (0 as unknown as AssertBookmarkArgs);
void (0 as unknown as AssertHeadingArgs);
void (0 as unknown as AssertAppendRowsArgs);
void (0 as unknown as AssertStructuredTableArgs);
void (0 as unknown as AssertSearchShape);

type WordCommentIdentity = NonNullable<
  Exclude<Parameters<ExtensionCommandMap['addComment']>[0], string>
>['authorIdentity'];
type AssertWordCommentIdentity = ExpectTrue<
  Equal<WordCommentIdentity, { providerId: string; userId: string } | null | undefined>
>;
type ReplyWordIdentity = NonNullable<Parameters<ExtensionCommandMap['addCommentReply']>[0]>['authorIdentity'];
type AssertReplyWordIdentity = ExpectTrue<Equal<ReplyWordIdentity, WordCommentIdentity>>;
