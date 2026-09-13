import type { Layout } from 'superdoc';

// `Layout.columns` is a `ColumnLayout`, and the section page direction (`w:sectPr/w:bidi`) travels
// on it because column geometry is what the axis decides: which side the FIRST column sits on.
// The field is reachable from outside the package through this nested shape, so it is pinned here.

type PublicColumnLayout = NonNullable<Layout['columns']>;
type PublicColumnDirection = NonNullable<PublicColumnLayout['direction']>;

// Both literals a section can carry have to be assignable from outside the package.
const rtlSection: PublicColumnLayout = { count: 2, gap: 48, direction: 'rtl' };
const ltrSection: PublicColumnLayout = { count: 2, gap: 48, direction: 'ltr' };

// Absent means LTR, so a consumer that never heard of the axis must still type-check.
const directionless: PublicColumnLayout = { count: 2, gap: 48 };

// The field is optional, and reading it back yields the same union — no widening to `string`.
declare const layout: Layout;
const readDirection: PublicColumnDirection | undefined = layout.columns?.direction;

const rtl: PublicColumnDirection = 'rtl';
const ltr: PublicColumnDirection = 'ltr';

// A consumer must be able to hand a value it read straight back into a layout it builds.
declare const observed: PublicColumnDirection;
const roundTripped: PublicColumnLayout = { count: 3, gap: 24, direction: observed };

void rtlSection;
void ltrSection;
void directionless;
void readDirection;
void rtl;
void ltr;
void roundTripped;
