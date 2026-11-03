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
// A trailing "%" belongs to technique codes such as UTM-01-100% (100 % coverage), so the whole code
// is one identifier; it is replaced by a fixed phrase (C-037). A % in the model's prose withholds it.
// Allowlist, not a list of percent-like signs (C-038 review: ؉ ؊ and tag characters kept appearing).
// "Plain" = letters, marks, digits, whitespace and ASCII punctuation except "%". A code that ends in
// any other character (%, ％, ﹪, ٪, ‰, ‱, ؉, ؊, ...) is a signed code: it is never shown to the model.
const ASCII_PUNCT_NO_PERCENT = "\\x21-\\x24\\x26-\\x2F\\x3A-\\x40\\x5B-\\x60\\x7B-\\x7E";
const NOT_PLAIN = `[^\\p{L}\\p{M}\\p{N}\\s${ASCII_PUNCT_NO_PERCENT}]`;
const HAS_PERCENT = new RegExp(NOT_PLAIN, "u");
const NOT_PLAIN_ALL = new RegExp(NOT_PLAIN, "gu");
// Codes are ASCII. Any non-ASCII character glued to the end of one (a percent-like sign, a hidden
// character, a combining mark or a letter such as Å) makes it a signed code (C-040 review).
const CODE_SIGN = `[^\\sA-Za-z0-9${ASCII_PUNCT_NO_PERCENT}]`;
const SIGNED_CODE = new RegExp(`${CODE_SIGN}$`, "u");
const IDENTIFIER = new RegExp(`\\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\\b${CODE_SIGN}?`, "gu");
// Hidden and unassigned characters are non-plain too: a code followed by one (e.g. U+E0025 TAG
// PERCENT SIGN) is a signed code, classified before anything is removed (C-039 review); every
// hidden character left over is removed with the other non-plain characters.
// Reply allowlist: letters, marks, whitespace, ASCII punctuation except "%", and common typographic
// marks (– — ‘ ’ “ ” « » … · •). Anything else in the model's reply withholds it.
const REPLY_NOT_ALLOWED = new RegExp(`[^\\p{L}\\p{M}\\s${ASCII_PUNCT_NO_PERCENT}\\u2013\\u2014\\u2018\\u2019\\u201C\\u201D\\u00AB\\u00BB\\u2026\\u00B7\\u2022]+`, "gu");
// Anything alias-shaped, in any case. Only an exact canonical alias (lower-case suffix, issued for
// this request) is accepted; CML#A or CML#ZZ is a forgery and withholds the summary.
const ALIAS = /\b(\p{L}+)#(\p{L}+)\b/gu;
const PLACEHOLDER = /\[\s*value\s*\]/i;
const NUMERIC_RUN = /\p{N}[\p{N}.,:/-]*(?:T[\p{N}.:]+Z?)?/gu;
const HIDDEN = /[\p{Cf}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;
const NUMERIC_CHARS = /[\p{N}∞]+/gu;
// An alias stated as the value of a quantity ("the remaining life is CML#a", "o ano é CAL#h") is a
// value claim in disguise, as is an alias directly followed by a unit ("CML#a years").
const QUANTITY = "life|lives|year|years|date|dates|rate|rates|thickness|t_min|limit|due|age|interval|vida|ano|anos|data|datas|taxa|taxas|espessura|limite|prazo|vencimento|idade|intervalo|coverage|percentage|percent|proportion|extent|share|ratio|cobertura|percentagem|porcentagem|proporção|proporcao|extensão|extensao";
// Documented EN/PT link verbs that state a quantity's value (C-042 review added "corresponds to" and
// the forms below). This list is the scope of the quantity-clause rule; it is not open-ended. A clause
// is the text between ".", ";", "!", "?" and newlines, with no length limit (C-043 review).
const LINK_VERBS = [
  "is", "are", "was", "were", "be", "being", "been", "equals?", "equal\\s+to", "equivalent\\s+to",
  "corresponds?\\s+to", "correspond\\s+to", "amounts?\\s+to", "comes?\\s+to", "totals?", "stands?\\s+at",
  "reach(?:es)?", "remains?",
  "é", "são", "era", "eram", "foi", "foram", "será", "serão", "seja", "igual\\s+a", "iguais\\s+a",
  "equivale(?:m)?\\s+a", "corresponde(?:m)?\\s+a", "totaliza(?:m)?", "atinge(?:m)?", "chega(?:m)?\\s+a",
  "fica(?:m)?\\s+em", "permanece(?:m)?",
].join("|");
const ALIAS_AS_STATED_VALUE = new RegExp(`(?<![\\p{L}])(?:${QUANTITY})(?![\\p{L}])[^.;!?\\n]*?(?:(?<![\\p{L}])(?:${LINK_VERBS})(?![\\p{L}])|[=:])\\s*(?:(?:the|a|an|o|os|as|um|uma)\\s+)?\\p{L}+#\\p{L}+`, "iu");
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

export const PERCENT_CODE_PHRASE = "the coded technique";

export function prepareModelInput(text: string): ModelInput {
  const byId = new Map<string, string>();
  const aliases = new Map<string, string>();
  // Classified on the raw text, not a normalized copy: NFKC would turn a tail such as ℂ, K, Ａ or ﬀ into
  // ASCII and glue it to the code (C-041 review). Numbers are \p{N} and signs are non-plain either way.
  const withAliases = text.replace(IDENTIFIER, (id) => {
    if (!/\p{N}/u.test(id)) return id;
    // A %-bearing code (UTM-01-100%) is never shown to the model, not even as an alias: whatever the
    // model wrote around it would restore to a "100%" claim. The code stays in the deterministic
    // proposal; the narrative only says "the coded technique" (C-037).
    if (SIGNED_CODE.test(id)) return PERCENT_CODE_PHRASE;
    let a = byId.get(id);
    if (!a) {
      const prefix = id.split("-")[0].replace(/\p{N}/gu, "");
      a = `${prefix}#${alphaCode(byId.size)}`;
      byId.set(id, a);
      aliases.set(a, id);
    }
    return a;
  });
  // Every number becomes [value]; a % left over (from a free-standing percentage) is dropped, so the
  // request carries neither digits nor % signs (C-032 P1).
  return { masked: withAliases.replace(NUMERIC_RUN, "[value]").replace(NOT_PLAIN_ALL, ""), aliases };
}

// Defence in depth: prepareModelInput no longer aliases %-bearing codes (C-037), so these rules
// only apply to a caller-built alias map. A %-bearing technique code restores to text containing "%",
// so its alias may only be used as a method: right after a method/inspection word. Anywhere else it could read as a
// coverage or percentage claim once restored (C-032 P1).
const METHOD_CONTEXT = /(?:use|uses|used|usar|usa|usando|utiliza|utilizando|per|using|with|by|via|technique|method|methods|inspection|inspections|re-inspection|reinspection|com|usando|por|pela|pelo|segundo|conforme|técnica|tecnica|método|metodo|inspeção|inspecao|inspecção|reinspeção)(?![\p{L}])[^.;!?\n]{0,24}$/iu;
// Quantity meaning wins over a later method word anywhere earlier in the reply: punctuation-based
// sentence splitting is unsafe because abbreviations such as "e.g." contain periods. This is
// deliberately conservative; a withheld summary is regenerated (C-033/C-035 P1).
const QUANTITY_LINK_TO_ALIAS = new RegExp(`(?<![\\p{L}])(?:${QUANTITY})(?![\\p{L}])[\\s\\S]*?(?:(?<![\\p{L}])(?:${LINK_VERBS})(?![\\p{L}])|[=:])[\\s\\S]*$`, "iu");

export function numericContent(modelText: string, aliases: Map<string, string>): string[] {
  const found = new Set<string>();
  const hidden = modelText.match(HIDDEN);
  if (hidden) found.add(`hidden character U+${hidden[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  for (const m of modelText.matchAll(ALIAS)) if (!aliases.has(m[0])) found.add(`unknown alias ${m[0]}`);
  const asValue = modelText.match(ALIAS_AS_VALUE) ?? modelText.match(ALIAS_AS_STATED_VALUE);
  if (asValue) found.add(`identifier used as a value: ${asValue[0]}`);
  if (PLACEHOLDER.test(modelText)) found.add("[value] placeholder");
  for (const m of modelText.matchAll(ALIAS)) {
    if (!HAS_PERCENT.test(aliases.get(m[0]) ?? "")) continue;
    const before = modelText.slice(0, m.index ?? 0);
    if (QUANTITY_LINK_TO_ALIAS.test(before) || !METHOD_CONTEXT.test(before)) found.add(`percent-bearing identifier outside a method context: ${m[0]}`);
  }
  const rest = modelText.replace(ALIAS, " ");
  for (const m of rest.matchAll(NUMERIC_CHARS)) found.add(m[0]);
  for (const m of rest.matchAll(REPLY_NOT_ALLOWED)) found.add(m[0]);
  for (const m of fold(rest).replace(NON_NUMERIC_TERMS, " ").matchAll(WORDS)) found.add(m[0]);
  return [...found];
}

export function restoreAliases(modelText: string, aliases: Map<string, string>): string {
  return modelText.replace(ALIAS, (a) => aliases.get(a) ?? a);
}
