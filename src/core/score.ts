import { ParsedModule } from "../parsers/types.js";

export interface ModuleScore {
  filePath: string;
  totalSymbols: number;
  documentedSymbols: number;
  coverage: number; // 0-100
  undocumented: string[]; // symbol names
}

export interface ScoreResult {
  score: number; // 0-100 project aggregate
  band: "poor" | "fair" | "good";
  modules: ModuleScore[];
  totalSymbols: number;
  documentedSymbols: number;
  lowQualityCount: number; // docs that are placeholders
}

const STUB_PATTERNS =
  /^(todo|fixme|placeholder|no description|stub|tbd|\.{3})/i;

/** Counts a single symbol toward coverage. Returns [documented?, lowQuality?]. */
function assessDoc(doc: string | undefined): [boolean, boolean] {
  if (!doc || !doc.trim()) return [false, false];
  const low = STUB_PATTERNS.test(doc.trim());
  return [true, low];
}

/** Computes deterministic documentation coverage for exported public symbols. */
export function scoreModules(modules: ParsedModule[]): ScoreResult {
  const moduleScores: ModuleScore[] = [];
  let totalSymbols = 0;
  let documentedSymbols = 0;
  let lowQualityCount = 0;

  for (const m of modules) {
    let total = 0;
    let documented = 0;
    const undocumented: string[] = [];

    for (const f of m.functions) {
      if (!f.isExported) continue;
      total++;
      const [isDoc, isLow] = assessDoc(f.existingDoc);
      if (isDoc) documented++;
      else undocumented.push(f.name);
      if (isLow) lowQualityCount++;
    }

    for (const c of m.classes) {
      if (!c.isExported) continue;
      total++;
      const [isDoc, isLow] = assessDoc(c.existingDoc);
      if (isDoc) documented++;
      else undocumented.push(c.name);
      if (isLow) lowQualityCount++;

      for (const meth of c.methods) {
        if (meth.visibility !== "public") continue;
        total++;
        const [mDoc, mLow] = assessDoc(meth.existingDoc);
        if (mDoc) documented++;
        else undocumented.push(`${c.name}.${meth.name}`);
        if (mLow) lowQualityCount++;
      }
    }

    totalSymbols += total;
    documentedSymbols += documented;
    moduleScores.push({
      filePath: m.filePath,
      totalSymbols: total,
      documentedSymbols: documented,
      coverage: total === 0 ? 100 : Math.round((documented / total) * 100),
      undocumented,
    });
  }

  const score =
    totalSymbols === 0
      ? 100
      : Math.round((documentedSymbols / totalSymbols) * 100);
  return {
    score,
    band: bucket(score),
    modules: moduleScores,
    totalSymbols,
    documentedSymbols,
    lowQualityCount,
  };
}

/** Maps a numeric documentation score to a coarse health band. */
export function bucket(score: number): "poor" | "fair" | "good" {
  if (score < 40) return "poor";
  if (score < 70) return "fair";
  return "good";
}

export const BAND_META: Record<
  "poor" | "fair" | "good",
  { emoji: string; label: string }
> = {
  poor: { emoji: "🔴", label: "Poor" },
  fair: { emoji: "🟡", label: "Fair" },
  good: { emoji: "🟢", label: "Good" },
};
