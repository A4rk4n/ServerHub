// Type declarations for scripts/check-docs.mjs (tsconfig has allowJs: false).

export interface DocsProblem {
  file: string;
  line: number;
  target: string;
  reason: string;
}

export interface DocsLink {
  target: string;
  line: number;
}

export function collectMarkdownFiles(root: string): string[];
export function stripCode(markdown: string): string;
export function extractLinks(markdown: string): DocsLink[];
export function slugify(heading: string): string;
export function headingSlugs(markdown: string): Set<string>;
export function checkDocs(root: string): DocsProblem[];
