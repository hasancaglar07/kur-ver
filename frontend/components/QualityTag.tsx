const qualityStyles = {
  high: "border-[#CFE0CD] bg-[#EDF3EC] text-[#346538]",
  medium: "border-[#E8DCB9] bg-[#FBF3DB] text-[#956400]",
  low: "border-[#F3D6D8] bg-[#FDEBEC] text-[#9F2F2D]",
  none: "border-[#EAEAEA] bg-[#F9F9F8] text-[#787774]",
};

export function QualityTag({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return (
      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.04em] ${qualityStyles.none}`}>
        Skor yok
      </span>
    );
  }

  if (score >= 85) {
    return (
      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.04em] ${qualityStyles.high}`}>
        Yüksek {score}
      </span>
    );
  }

  if (score >= 60) {
    return (
      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.04em] ${qualityStyles.medium}`}>
        Orta {score}
      </span>
    );
  }

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.04em] ${qualityStyles.low}`}>
      Düşük {score}
    </span>
  );
}
