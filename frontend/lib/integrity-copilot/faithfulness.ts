// Numeric guard for the model-inferred summary: the model never sees a value and may not write one.
//
// History: a value-bag check (C-010) could not bind a number to its meaning. Allowing source
// identifiers verbatim (C-011) let their digits leak values to the model (UT-03-2016 carries a
// year) and be reused as claims ("remaining life is CML-03 years"). So now:
//
// 1. prepareModelInput(): every digit-bearing identifier becomes a digit-free alias
//    (CML-03 -> CML#a, UT-03-2016 -> UT#b), then every remaining number or ISO date/time becomes
//    "[value]". The request to Meta carries no digit at all.
// 2. numericContent(): the reply is withheld if it contains a hidden/format/private-use character,
//    an unknown alias, an alias used as a quantity ("CML#a years"), any Unicode number character
//    (\p{N}), %, ‰, ∞, or an EN/PT number word (matched case- and accent-insensitively).
// 3. restoreAliases(): only after the check passes are the real identifiers put back for display.
//
// Known limits (non-numeric, documented): identifier swaps ("CML-05 governs"); the articles
// one/um/uma; meio/meia/double (common non-numeric senses); Latin-letter ordinals and Roman
// numerals (XVIII). Prompt, the model_inferred label and engineer approval control these.

// Identifier-shaped tokens starting with a letter, hyphenated or compact: CML-03, POL-SYNTH-RATE-01,
// CML03, Rev2, A1B. Only those containing a digit are aliased. A leading \b means a token glued to a
// preceding digit (the "T00" inside an ISO timestamp) is not an identifier, so dates stay [value].
const IDENTIFIER = /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/g;
// Anything alias-shaped, in any case. Only an exact canonical alias (lower-case suffix, issued for
// this request) is accepted; CML#A or CML#ZZ is a forgery and withholds the summary.
const ALIAS = /\b(\p{L}+)#(\p{L}+)\b/gu;
const PLACEHOLDER = /\[\s*value\s*\]/i;
const NUMERIC_RUN = /\p{N}[\p{N}.,:/-]*(?:T[\p{N}.:]+Z?)?/gu;
const HIDDEN = /[\p{Cf}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;
const NUMERIC_CHARS = /[\p{N}%‰∞]+/gu;
// An alias stated as the value of a quantity ("the remaining life is CML#a", "o ano é CAL#h") is a
// value claim in disguise, as is an alias directly followed by a unit ("CML#a years").
const QUANTITY = "life|lives|year|years|date|dates|rate|rates|thickness|t_min|limit|due|age|interval|vida|ano|anos|data|datas|taxa|taxas|espessura|limite|prazo|vencimento|idade|intervalo";
const ALIAS_AS_STATED_VALUE = new RegExp(`(?<![\\p{L}])(?:${QUANTITY})(?![\\p{L}])[^.;!?\\n]{0,40}?(?:(?<![\\p{L}])(?:is|are|was|were|equals|é|são|era|foi|igual\\s+a)(?![\\p{L}])|[=:])\\s*\\p{L}+#\\p{L}+`, "iu");
// Separators include hyphens and dashes ("CML#a-year", "CML#a‑year"), which restore to "CML-03-year".
const ALIAS_AS_VALUE = /\b[A-Za-z]+#[a-z]+[\s\p{Pd}]*(?:years?|yrs?|y|anos?|months?|meses|m[eê]s|days?|dias?|hours?|horas?|h|mm\/?y|mm|in|inch(?:es)?|polegadas?)(?![\p{L}])/iu;

// Accent-free, lower-case forms; matched against an accent-stripped copy of the reply.
const NUMBER_WORDS = [
  // English (not "one": article/pronoun use is indistinguishable; not "double": "double-check")
  "zero", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
  "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands",
  "million", "millions", "billion", "billions", "trillion", "trillions", "dozen", "dozens", "score",
  "half", "halves", "quarter", "quarters", "third", "thirds", "twice", "thrice", "triple", "quadruple",
  "couple", "pair", "percent", "per cent",
  // Portuguese (not "um"/"uma": articles; not "meio"/"meia": "por meio de")
  "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
  "treze", "catorze", "quatorze", "quinze", "dezesseis", "dezasseis", "dezessete", "dezassete",
  "dezoito", "dezenove", "dezanove", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta",
  "oitenta", "noventa", "cem", "cento", "centena", "centenas", "duzentos", "duzentas", "trezentos",
  "trezentas", "quatrocentos", "quatrocentas", "quinhentos", "quinhentas", "seiscentos", "seiscentas",
  "setecentos", "setecentas", "oitocentos", "oitocentas", "novecentos", "novecentas", "mil", "milhar",
  "milhares", "milhao", "milhoes", "bilhao", "bilhoes", "biliao", "bilioes", "trilhao", "trilhoes",
  "triliao", "trilioes", "duzia", "duzias", "dezena", "dezenas", "metade", "dobro", "triplo", "quadruplo",
  "terco", "tercos", "quarto", "quartos", "por cento",
];
const WORDS = new RegExp(`(?<![\\p{L}])(?:${NUMBER_WORDS.map((w) => w.replace(" ", "\\s+")).join("|")})(?![\\p{L}])`, "gu");

// Fixed data-handling terms that contain a number word but state no quantity ("not zero-filled").
// Matched on the accent-folded text and removed before the word check; nothing broader is allowed.
const NON_NUMERIC_TERMS = /(?<![\p{L}])(?:zero-fill(?:ed|ing)?|preenchid[oa]s?\s+com\s+zeros?)(?![\p{L}])/gu;

const alphaCode = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : alphaCode(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));
const fold = (s: string) => s.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export interface ModelInput {
  masked: string;
  aliases: Map<string, string>; // alias -> real identifier
}

export function prepareModelInput(text: string): ModelInput {
  const byId = new Map<string, string>();
  const aliases = new Map<string, string>();
  const withAliases = text.replace(/\p{Co}/gu, "").replace(IDENTIFIER, (id) => {
    if (!/\p{N}/u.test(id)) return id;
    let a = byId.get(id);
    if (!a) {
      const prefix = id.split("-")[0].replace(/\p{N}/gu, "");
      a = `${prefix}#${alphaCode(byId.size)}`;
      byId.set(id, a);
      aliases.set(a, id);
    }
    return a;
  });
  return { masked: withAliases.replace(NUMERIC_RUN, "[value]"), aliases };
}

export function numericContent(modelText: string, aliases: Map<string, string>): string[] {
  const found = new Set<string>();
  const hidden = modelText.match(HIDDEN);
  if (hidden) found.add(`hidden character U+${hidden[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  for (const m of modelText.matchAll(ALIAS)) if (!aliases.has(m[0])) found.add(`unknown alias ${m[0]}`);
  const asValue = modelText.match(ALIAS_AS_VALUE) ?? modelText.match(ALIAS_AS_STATED_VALUE);
  if (asValue) found.add(`identifier used as a value: ${asValue[0]}`);
  if (PLACEHOLDER.test(modelText)) found.add("[value] placeholder");
  const rest = modelText.replace(ALIAS, " ");
  for (const m of rest.matchAll(NUMERIC_CHARS)) found.add(m[0]);
  for (const m of fold(rest).replace(NON_NUMERIC_TERMS, " ").matchAll(WORDS)) found.add(m[0]);
  return [...found];
}

export function restoreAliases(modelText: string, aliases: Map<string, string>): string {
  return modelText.replace(ALIAS, (a) => aliases.get(a) ?? a);
}
