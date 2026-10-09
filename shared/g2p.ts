// English text -> Kokoro phonemes, using the misaki pronunciation dictionaries
// (Apache-2.0, https://github.com/hexgrad/misaki). This is a dictionary-based
// port of misaki's US-English lexicon rules without its part-of-speech tagger
// and without espeak-ng, so it contains no GPL code. Words missing from the
// dictionaries are built from known parts where possible, otherwise spelled
// with simple letter rules.

export type Entry = string | Record<string, string | null>;
export type Dictionary = Record<string, Entry>;

const PRIMARY = "ˈ";
const SECONDARY = "ˌ";
const STRESSES = PRIMARY + SECONDARY;
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
const CONSONANTS = new Set("bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ");
const US_TAUS = new Set("AIOWYiuæɑəɛɪɹʊʌ");
const PUNCTS = new Set(';:,.!?—…"“”');
const NON_QUOTE_PUNCTS = new Set(";:,.!?—…");
const SYMBOLS: Record<string, string> = { "%": "percent", "&": "and", "+": "plus", "@": "at" };
const CURRENCIES: Record<string, [string, string]> = { $: ["dollar", "cent"], "£": ["pound", "pence"], "€": ["euro", "cent"] };
const ORDINALS = new Set(["st", "nd", "rd", "th"]);

const isAlpha = (s: string) => /^[A-Za-z]+$/.test(s);
const isDigits = (s: string) => /^[0-9]+$/.test(s);
const upper = (s: string) => s.toUpperCase();
const lower = (s: string) => s.toLowerCase();
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function applyStress(ps: string | null, stress: number | null): string | null {
  if (ps === null || stress === null) return ps;
  const hasVowel = [...ps].some((c) => VOWELS.has(c));
  const restress = (s: string) => {
    // Move each stress mark to just before the next vowel.
    const items = [...s].map((c, i) => ({ c, pos: i }));
    items.forEach((it, i) => {
      if (STRESSES.includes(it.c)) {
        const j = items.findIndex((x, k) => k >= i && VOWELS.has(x.c));
        if (j >= 0) it.pos = j - 0.5;
      }
    });
    return items
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.c)
      .join("");
  };
  if (stress < -1) return ps.replaceAll(PRIMARY, "").replaceAll(SECONDARY, "");
  if (stress === -1 || ((stress === 0 || stress === -0.5) && ps.includes(PRIMARY))) {
    return ps.replaceAll(SECONDARY, "").replaceAll(PRIMARY, SECONDARY);
  }
  if ((stress === 0 || stress === 0.5 || stress === 1) && ![...STRESSES].some((s) => ps.includes(s))) {
    return hasVowel ? restress(SECONDARY + ps) : ps;
  }
  if (stress >= 1 && !ps.includes(PRIMARY) && ps.includes(SECONDARY)) return ps.replaceAll(SECONDARY, PRIMARY);
  if (stress > 1 && ![...STRESSES].some((s) => ps.includes(s))) return hasVowel ? restress(PRIMARY + ps) : ps;
  return ps;
}

/** Adds capitalised/lowercased variants, as misaki does. */
function grow(d: Dictionary): Dictionary {
  const extra: Dictionary = {};
  for (const [k, v] of Object.entries(d)) {
    if (k.length < 2) continue;
    if (k === lower(k)) {
      if (k !== capitalize(k)) extra[capitalize(k)] = v;
    } else if (k === capitalize(k)) {
      extra[lower(k)] = v;
    }
  }
  return Object.assign(extra, d);
}

interface Ctx {
  futureVowel: boolean | null;
  futureTo: boolean;
}

type Result = [string | null, number | null];

export class Lexicon {
  private golds: Dictionary;
  private silvers: Dictionary;

  constructor(gold: Dictionary, silver: Dictionary) {
    this.golds = grow(gold);
    this.silvers = grow(silver);
  }

  private has(d: Dictionary, w: string) {
    return Object.prototype.hasOwnProperty.call(d, w);
  }

  private nnp(word: string): Result {
    const parts = [...word].filter((c) => /[A-Za-z]/.test(c)).map((c) => this.golds[upper(c)]);
    if (parts.some((p) => typeof p !== "string")) return [null, null];
    const ps = applyStress(parts.join(""), 0)!;
    const i = ps.lastIndexOf(SECONDARY);
    return [i < 0 ? ps : ps.slice(0, i) + PRIMARY + ps.slice(i + 1), 3];
  }

  private special(word: string, stress: number | null, ctx: Ctx): Result {
    if (SYMBOLS[word]) return this.lookup(SYMBOLS[word], null, ctx);
    if (/\./.test(word.replace(/^\.+|\.+$/g, "")) && isAlpha(word.replaceAll(".", "")) && Math.max(...word.split(".").map((s) => s.length)) < 3) {
      return this.nnp(word);
    }
    if (word === "a" || word === "A") return ["ɐ", 4];
    if (word === "am" || word === "Am" || word === "AM") {
      if (ctx.futureVowel === null || word !== "am" || (stress !== null && stress > 0)) return [this.golds["am"] as string, 4];
      return ["ɐm", 4];
    }
    if (word === "an" || word === "An" || word === "AN") return ["ɐn", 4];
    if (word === "I") return [`${SECONDARY}I`, 4];
    if (word === "to" || word === "To" || word === "TO") {
      return [ctx.futureVowel === null ? (this.golds["to"] as string) : ctx.futureVowel ? "tʊ" : "tə", 4];
    }
    if (word === "in" || word === "In" || word === "IN") return [(ctx.futureVowel === null ? PRIMARY : "") + "ɪn", 4];
    if (word === "the" || word === "The" || word === "THE") return [ctx.futureVowel === true ? "ði" : "ðə", 4];
    if (/^vs\.?$/i.test(word)) return this.lookup("versus", null, ctx);
    if (word === "used" || word === "Used" || word === "USED") {
      const used = this.golds["used"] as Record<string, string>;
      return [ctx.futureTo ? used["VBD"] : used["DEFAULT"], 4];
    }
    return [null, null];
  }

  isKnown(word: string): boolean {
    if (this.has(this.golds, word) || SYMBOLS[word] || this.has(this.silvers, word)) return true;
    if (!/^[A-Za-z'-]+$/.test(word) || !isAlpha(word.replace(/['-]/g, ""))) return false;
    if (word.length === 1) return true;
    if (word === upper(word) && this.has(this.golds, lower(word))) return true;
    return word.slice(1) === upper(word.slice(1));
  }

  lookup(word: string, stress: number | null, ctx: Ctx | null): Result {
    let isNNP = false;
    if (word === upper(word) && !this.has(this.golds, word)) {
      word = lower(word);
    }
    let entry: Entry | undefined = this.golds[word];
    let rating = 4;
    if (entry === undefined && !isNNP) {
      entry = this.silvers[word];
      rating = 3;
    }
    let ps: string | null = null;
    if (typeof entry === "string") ps = entry;
    else if (entry) {
      // No part-of-speech tagger: use the "None" reading before a pause, else the default.
      ps = (ctx && ctx.futureVowel === null && "None" in entry ? entry["None"] : entry["DEFAULT"]) ?? entry["DEFAULT"] ?? null;
    }
    if (ps === null || (isNNP && !ps.includes(PRIMARY))) {
      const [n, r] = this.nnp(word);
      if (n !== null) return [n, r];
    }
    return [applyStress(ps, stress), rating];
  }

  private s(stem: string | null): string | null {
    if (!stem) return null;
    const last = stem.at(-1)!;
    if ("ptkfθ".includes(last)) return stem + "s";
    if ("szʃʒʧʤ".includes(last)) return stem + "ᵻz";
    return stem + "z";
  }

  private stemS(word: string, stress: number | null, ctx: Ctx | null): Result {
    if (word.length < 3 || !word.endsWith("s")) return [null, null];
    let stem: string;
    if (!word.endsWith("ss") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if ((word.endsWith("'s") || (word.length > 4 && word.endsWith("es") && !word.endsWith("ies"))) && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith("ies") && this.isKnown(word.slice(0, -3) + "y")) stem = word.slice(0, -3) + "y";
    else return [null, null];
    const [ps, r] = this.lookup(stem, stress, ctx);
    return [this.s(ps), r];
  }

  private ed(stem: string | null): string | null {
    if (!stem) return null;
    const last = stem.at(-1)!;
    if ("pkfθʃsʧ".includes(last)) return stem + "t";
    if (last === "d") return stem + "ᵻd";
    if (last !== "t") return stem + "d";
    if (stem.length < 2) return stem + "ɪd";
    if (US_TAUS.has(stem.at(-2)!)) return stem.slice(0, -1) + "ɾᵻd";
    return stem + "ᵻd";
  }

  private stemEd(word: string, stress: number | null, ctx: Ctx | null): Result {
    if (word.length < 4 || !word.endsWith("d")) return [null, null];
    let stem: string;
    if (!word.endsWith("dd") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if (word.length > 4 && word.endsWith("ed") && !word.endsWith("eed") && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else return [null, null];
    const [ps, r] = this.lookup(stem, stress, ctx);
    return [this.ed(ps), r];
  }

  private ing(stem: string | null): string | null {
    if (!stem) return null;
    if (stem.length > 1 && stem.at(-1) === "t" && US_TAUS.has(stem.at(-2)!)) return stem.slice(0, -1) + "ɾɪŋ";
    return stem + "ɪŋ";
  }

  private stemIng(word: string, stress: number | null, ctx: Ctx | null): Result {
    if (word.length < 5 || !word.endsWith("ing")) return [null, null];
    let stem: string;
    if (word.length > 5 && this.isKnown(word.slice(0, -3))) stem = word.slice(0, -3);
    else if (this.isKnown(word.slice(0, -3) + "e")) stem = word.slice(0, -3) + "e";
    else if (word.length > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word) && this.isKnown(word.slice(0, -4))) stem = word.slice(0, -4);
    else return [null, null];
    const [ps, r] = this.lookup(stem, stress, ctx);
    return [this.ing(ps), r];
  }

  getWord(word: string, stress: number | null, ctx: Ctx): Result {
    const sp = this.special(word, stress, ctx);
    if (sp[0] !== null) return sp;
    const wl = lower(word);
    if (
      word.length > 1 &&
      isAlpha(word.replaceAll("'", "")) &&
      word !== wl &&
      !this.has(this.golds, word) &&
      !this.has(this.silvers, word) &&
      (word === upper(word) || word.slice(1) === lower(word.slice(1))) &&
      (this.has(this.golds, wl) ||
        this.has(this.silvers, wl) ||
        this.stemS(wl, stress, ctx)[0] ||
        this.stemEd(wl, stress, ctx)[0] ||
        this.stemIng(wl, stress, ctx)[0])
    ) {
      word = wl;
    }
    if (this.isKnown(word)) return this.lookup(word, stress, ctx);
    if (word.endsWith("s'") && this.isKnown(word.slice(0, -2) + "'s")) return this.lookup(word.slice(0, -2) + "'s", stress, ctx);
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return this.lookup(word.slice(0, -1), stress, ctx);
    for (const r of [this.stemS(word, stress, ctx), this.stemEd(word, stress, ctx), this.stemIng(word, stress ?? 0.5, ctx)]) {
      if (r[0] !== null) return r;
    }
    return [null, null];
  }

  numberWords(word: string, currency: string | null): Result {
    const suffixMatch = /[a-z']+$/.exec(word);
    const suffix = suffixMatch?.[0] ?? null;
    if (suffix) word = word.slice(0, -suffix.length);
    const parts: string[] = [];
    if (word.startsWith("-")) {
      parts.push("minus");
      word = word.slice(1);
    }
    const plain = word.replaceAll(",", "");
    if (isDigits(plain) && suffix && ORDINALS.has(suffix)) parts.push(ordinal(Number(plain)));
    else if (word.length === 4 && isDigits(word) && !(currency && CURRENCIES[currency])) parts.push(year(Number(word)));
    else if (currency && CURRENCIES[currency] && /^\d+(\.\d{1,2})?$/.test(plain)) {
      const [whole, cents = ""] = plain.split(".");
      const [unit, sub] = CURRENCIES[currency];
      const w = Number(whole);
      const c = cents ? Number(cents.padEnd(2, "0")) : 0;
      if (w || !c) parts.push(cardinal(w), w === 1 ? unit : unit + "s");
      if (c) {
        if (w) parts.push("and");
        parts.push(cardinal(c), c === 1 || sub === "pence" ? sub : sub + "s");
      }
    } else if (/^\d*\.\d+$/.test(plain)) {
      const [whole, frac] = plain.split(".");
      if (whole) parts.push(cardinal(Number(whole)));
      parts.push("point", ...[...frac].map((d) => cardinal(Number(d))));
    } else if (isDigits(plain)) {
      parts.push(plain.length > 15 ? [...plain].map((d) => cardinal(Number(d))).join(" ") : cardinal(Number(plain)));
    } else return [null, null];
    const ps: string[] = [];
    let rating = 4;
    for (const w of parts.join(" ").split(/[^a-z]+/).filter(Boolean)) {
      const [p, r] = w === "and" ? this.lookup("and", null, null) : this.lookup(w, w === "point" ? -2 : null, null);
      if (p === null) return [null, null];
      ps.push(p);
      rating = Math.min(rating, r ?? 3);
    }
    let result = ps.join(" ");
    if (suffix === "s" || suffix === "'s") result = this.s(result)!;
    else if (suffix === "ed" || suffix === "'d") result = this.ed(result)!;
    else if (suffix === "ing") result = this.ing(result)!;
    return [result, rating];
  }
}

// ---------- Numbers ----------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

export function cardinal(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + cardinal(n % 100) : "");
  const words: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) words.unshift(cardinal(chunk) + (SCALES[scale] ? " " + SCALES[scale] : ""));
    n = Math.floor(n / 1000);
    scale++;
  }
  return words.join(" ");
}

const ORDINAL_WORDS: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

export function ordinal(n: number): string {
  const words = cardinal(n);
  const m = /([a-z]+)$/.exec(words)!;
  const last = m[1];
  const ord = ORDINAL_WORDS[last] ?? (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th");
  return words.slice(0, m.index) + ord;
}

export function year(n: number): string {
  if (n % 1000 < 10 || n < 1100) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return cardinal(hi) + " hundred";
  return cardinal(hi) + " " + (lo < 10 ? "oh " + cardinal(lo) : cardinal(lo));
}

// ---------- Fallback for unknown words ----------

// Rough letter-to-sound rules, longest match first. Only used for words that
// aren't in the dictionaries and can't be built from known parts.
const LETTER_RULES: [string, string][] = [
  ["tion", "ʃən"], ["sion", "ʒən"], ["ough", "ʌf"], ["augh", "ɔf"], ["ight", "It"], ["eigh", "A"],
  ["tch", "ʧ"], ["sch", "sk"], ["igh", "I"], ["dge", "ʤ"], ["ph", "f"], ["ch", "ʧ"], ["sh", "ʃ"], ["th", "θ"],
  ["ng", "ŋ"], ["ck", "k"], ["qu", "kw"], ["wh", "w"], ["kn", "n"], ["wr", "ɹ"], ["ee", "i"], ["ea", "i"],
  ["oo", "u"], ["ou", "W"], ["ow", "O"], ["oi", "Y"], ["oy", "Y"], ["ai", "A"], ["ay", "A"], ["au", "ɔ"],
  ["aw", "ɔ"], ["ie", "i"], ["ei", "A"], ["ey", "i"], ["oa", "O"], ["ue", "u"], ["ew", "u"], ["er", "əɹ"],
  ["ar", "ɑɹ"], ["or", "ɔɹ"], ["ir", "ɜɹ"], ["ur", "ɜɹ"], ["a", "æ"], ["b", "b"], ["c", "k"], ["d", "d"],
  ["e", "ɛ"], ["f", "f"], ["g", "ɡ"], ["h", "h"], ["i", "ɪ"], ["j", "ʤ"], ["k", "k"], ["l", "l"], ["m", "m"],
  ["n", "n"], ["o", "ɑ"], ["p", "p"], ["q", "k"], ["r", "ɹ"], ["s", "s"], ["t", "t"], ["u", "ʌ"], ["v", "v"],
  ["w", "w"], ["x", "ks"], ["y", "i"], ["z", "z"],
];

function spellOut(word: string): string | null {
  let w = lower(word).replace(/[^a-z]/g, "");
  if (!w) return null;
  // A final silent e lengthens the vowel before it: "kade" -> "kAd".
  const magic = /[aeiou][^aeiou]e$/.test(w) && w.length > 3;
  if (magic) w = w.slice(0, -1);
  let out = "";
  for (let i = 0; i < w.length; ) {
    const rule = LETTER_RULES.find(([g]) => w.startsWith(g, i))!;
    out += rule[1];
    i += rule[0].length;
  }
  if (magic) out = out.replace(/[æɛɪɑʌ](?=[^æɛɪɑʌ]*$)/, (v) => ({ æ: "A", ɛ: "i", ɪ: "I", ɑ: "O", ʌ: "u" })[v]!);
  return applyStress(out, 2);
}

// ---------- G2P ----------

const TOKEN = /((?:[A-Za-z]\.){2,}|\d+(?:,\d{3})*(?:\.\d+)?(?:st|nd|rd|th|s|'s)?|\.\d+|[A-Za-z]+(?:['’][A-Za-z]+)*['’]?|[$£€%&+@]|[;:,.!?—…"“”()–-]+|\S)/g;

export class G2P {
  private lexicon: Lexicon;

  constructor(lexicon: Lexicon) {
    this.lexicon = lexicon;
  }

  /** Phonemes for one sentence. */
  phonemize(text: string): string {
    const clean = text
      .replace(/[‘’]/g, "'")
      .replace(/[«»]/g, '"')
      .replace(/\s+/g, " ")
      .replace(/\b(Mr|Mrs|Ms|Dr|St)\.(?= [A-Z])/g, (_, t: string) => ({ Mr: "Mister", Mrs: "Missus", Ms: "Miss", Dr: "Doctor", St: "Saint" })[t]!)
      .trim();
    const raw = [...clean.matchAll(TOKEN)].map((m) => ({ text: m[0], space: clean[m.index! + m[0].length] === " " }));
    const out: string[] = new Array(raw.length).fill("");
    let ctx: Ctx = { futureVowel: null, futureTo: false };
    let currency: string | null = null;
    for (let i = raw.length - 1; i >= 0; i--) {
      const { text: t } = raw[i];
      let ps: string | null = null;
      if (CURRENCIES[t] && /^\d/.test(raw[i + 1]?.text ?? "")) {
        ps = "";
      } else if (/^[;:,.!?—…"“”()–-]+$/.test(t)) {
        ps = t === "-" || t === "–" ? "—" : [...t].map((c) => (c === "(" ? "«" : c === ")" ? "»" : PUNCTS.has(c) ? c : "")).join("");
      } else if (/^[\d.]/.test(t) && /\d/.test(t)) {
        currency = i > 0 && CURRENCIES[raw[i - 1].text] ? raw[i - 1].text : null;
        ps = this.lexicon.numberWords(t, currency)[0];
      } else {
        const stress = t === lower(t) ? null : t === upper(t) && t.length > 1 ? 2 : 0.5;
        ps = this.lexicon.getWord(t, stress, ctx)[0] ?? this.compound(t, ctx) ?? (t.length <= 4 && t === upper(t) ? this.lexicon.lookup(t, null, ctx)[0] : null) ?? spellOut(t);
      }
      out[i] = ps ?? "";
      if (ps) {
        const first = [...ps].find((c) => VOWELS.has(c) || CONSONANTS.has(c) || NON_QUOTE_PUNCTS.has(c));
        if (first) ctx = { futureVowel: NON_QUOTE_PUNCTS.has(first) ? null : VOWELS.has(first), futureTo: /^to$/i.test(t) };
      }
    }
    let result = "";
    raw.forEach((tok, i) => {
      result += out[i];
      if (tok.space && out[i]) result += " ";
    });
    // Kokoro v1.0 uses T for the flap and t for the glottal stop.
    return result.replace(/ +/g, " ").replaceAll("ɾ", "T").replaceAll("ʔ", "t").trim();
  }

  /** "lighthousekeeper" -> "lighthouse" + "keeper". */
  private compound(word: string, ctx: Ctx): string | null {
    if (word.length < 6 || !isAlpha(word)) return null;
    const w = lower(word);
    for (let i = w.length - 3; i >= 3; i--) {
      const head = w.slice(0, i);
      const tail = w.slice(i);
      if (!this.lexicon.isKnown(head) || !this.lexicon.isKnown(tail) || head.length < 3) continue;
      const a = this.lexicon.getWord(head, null, ctx)[0];
      const b = this.lexicon.getWord(tail, -1, ctx)[0];
      if (a && b) return a + b;
    }
    return null;
  }
}
