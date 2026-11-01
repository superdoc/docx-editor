import { toolbarIcons } from './toolbarIcons.js';

export const bulletStyleButtons = [
  { key: 'disc', icon: toolbarIcons.bulletListDisc, ariaLabel: 'Opaque circle' },
  { key: 'circle', icon: toolbarIcons.bulletListCircle, ariaLabel: 'Outline circle' },
  { key: 'square', icon: toolbarIcons.bulletListSquare, ariaLabel: 'Opaque square' },
];

export const numberedStyleButtons = [
  { key: 'decimal', icon: toolbarIcons.numberedListDecimal, ariaLabel: '1. 2. 3.' },
  { key: 'decimal-paren', icon: toolbarIcons.numberedListDecimalParen, ariaLabel: '1) 2) 3)' },
  { key: 'upper-roman', icon: toolbarIcons.numberedListUpperRoman, ariaLabel: 'I. II. III.' },
  { key: 'lower-roman', icon: toolbarIcons.numberedListLowerRoman, ariaLabel: 'i. ii. iii.' },
  { key: 'upper-alpha', icon: toolbarIcons.numberedListUpperAlpha, ariaLabel: 'A. B. C.' },
  { key: 'upper-alpha-paren', icon: toolbarIcons.numberedListUpperAlphaParen, ariaLabel: 'A) B) C)' },
  { key: 'lower-alpha', icon: toolbarIcons.numberedListLowerAlpha, ariaLabel: 'a. b. c.' },
  { key: 'lower-alpha-paren', icon: toolbarIcons.numberedListLowerAlphaParen, ariaLabel: 'a) b) c)' },
];
