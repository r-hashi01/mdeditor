// @ts-expect-error — @fig/lezer-bash ships types but its package.json "exports" map omits them
import { parser } from "@fig/lezer-bash";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";

const bashHighlighting = styleTags({
  Comment: t.comment,
  CommandName: t.function(t.variableName),
  "VariableName": t.variableName,
  "EnvironmentVariable": t.special(t.variableName),
  String: t.string,
  RawString: t.string,
  Literal: t.literal,
  "if then else elif fi for while until do done case esac in select function": t.controlKeyword,
  "Assignment/=": t.definitionOperator,
  "|": t.operator,
  IORedirect: t.operator,
  "( )": t.paren,
  "{ }": t.brace,
});

const bashLanguage = LRLanguage.define({
  name: "bash",
  parser: parser.configure({ props: [bashHighlighting] }),
  languageData: {
    commentTokens: { line: "#" },
  },
});

export function bash(): LanguageSupport {
  return new LanguageSupport(bashLanguage);
}
