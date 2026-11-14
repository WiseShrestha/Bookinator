// Folio: Bookinator's mascot, an enchanted open book. Pure SVG + CSS, no images.
// The mood follows the game state only (asking, guessing, found, shortlist, no match);
// it never reflects posterior probabilities.

export type Mood = "idle" | "curious" | "thinking" | "confident" | "triumph" | "puzzled" | "sad";

const MOUTH: Record<Mood, string> = {
  idle: "M100 146 Q120 160 140 146",
  curious: "M113 150 a7 8 0 1 0 14 0 a7 8 0 1 0 -14 0",
  thinking: "M104 150 Q112 145 120 150 Q128 155 136 150",
  confident: "M98 147 Q124 162 143 141",
  triumph: "M97 143 Q120 175 143 143 Z",
  puzzled: "M102 152 L110 147 L118 152 L126 147 L134 152 L140 148",
  sad: "M102 158 Q120 143 138 158",
};

// [left brow, right brow] paths
const BROWS: Record<Mood, [string, string]> = {
  idle: ["M64 84 Q80 78 96 84", "M144 84 Q160 78 176 84"],
  curious: ["M64 80 Q80 70 96 78", "M144 84 Q160 80 176 84"],
  thinking: ["M64 82 Q80 76 96 86", "M144 86 Q160 76 176 82"],
  confident: ["M64 88 Q80 82 96 84", "M144 84 Q160 82 176 88"],
  triumph: ["M64 78 Q80 70 96 78", "M144 78 Q160 70 176 78"],
  puzzled: ["M64 76 Q80 68 96 76", "M144 90 Q160 86 176 88"],
  sad: ["M66 82 Q82 84 96 76", "M144 76 Q158 84 174 82"],
};

// pupil offset
const LOOK: Record<Mood, [number, number]> = {
  idle: [0, 0],
  curious: [-3, -1],
  thinking: [5, -7],
  confident: [2, 1],
  triumph: [0, 0],
  puzzled: [-4, 2],
  sad: [0, 6],
};

function Eye({ cx, mood, side }: { cx: number; mood: Mood; side: "l" | "r" }) {
  if (mood === "triumph") {
    return <path className="folio-happy-eye" d={`M${cx - 15} 112 Q${cx} 94 ${cx + 15} 112`} />;
  }
  const [dx, dy] = LOOK[mood];
  const small = mood === "puzzled" && side === "r";
  const ry = small ? 14 : 19;
  return (
    <g className="folio-eye">
      <ellipse className="folio-sclera" cx={cx} cy={108} rx={small ? 14 : 17} ry={ry} />
      <circle className="folio-pupil" cx={cx + dx} cy={110 + dy} r={small ? 6 : 8} />
      <circle className="folio-glint" cx={cx + dx + 3} cy={106 + dy} r={2.6} />
      {mood === "confident" && <path className="folio-lid-half" d={`M${cx - 18} 104 Q${cx} 92 ${cx + 18} 104 L${cx + 18} 88 L${cx - 18} 88 Z`} />}
      <ellipse className="folio-lid" cx={cx} cy={108} rx={18} ry={ry + 1} />
    </g>
  );
}

function Sparkle({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <path
      className="folio-sparkle"
      style={{ animationDelay: `${delay}s` }}
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z"
    />
  );
}

export function Folio({ mood, size = 220 }: { mood: Mood; size?: number }) {
  const [lb, rb] = BROWS[mood];
  return (
    <div className={`folio folio-${mood}`} style={{ width: size }} aria-hidden="true">
      <svg viewBox="0 0 240 230" role="presentation">
        <defs>
          <radialGradient id="folio-aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" className="folio-aura-in" />
            <stop offset="100%" stopOpacity="0" className="folio-aura-out" />
          </radialGradient>
          <linearGradient id="folio-cover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7a2b3a" />
            <stop offset="100%" stopColor="#3d1220" />
          </linearGradient>
          <linearGradient id="folio-page-l" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#efdcb6" />
            <stop offset="100%" stopColor="#fff4dc" />
          </linearGradient>
          <linearGradient id="folio-page-r" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#efdcb6" />
            <stop offset="100%" stopColor="#fff4dc" />
          </linearGradient>
        </defs>

        <circle className="folio-aura" cx="120" cy="118" r="112" fill="url(#folio-aura)" />
        {(mood === "thinking" || mood === "curious") && (
          <circle className="folio-runes" cx="120" cy="118" r="102" />
        )}
        <ellipse className="folio-shadow" cx="120" cy="218" rx="62" ry="7" />

        <g className="folio-body">
          {/* covers */}
          <path d="M120 80 Q70 56 16 64 L16 170 Q70 162 120 184 Z" fill="url(#folio-cover)" />
          <path d="M120 80 Q170 56 224 64 L224 170 Q170 162 120 184 Z" fill="url(#folio-cover)" />
          <path className="folio-gilt" d="M24 70 L24 162 M216 70 L216 162" />
          {/* page stack edges */}
          <path d="M120 82 Q72 60 22 67 L22 166 Q72 158 120 179 Z" fill="#d9c093" />
          <path d="M120 82 Q168 60 218 67 L218 166 Q168 158 120 179 Z" fill="#d9c093" />
          {/* top pages */}
          <path d="M120 85 Q74 64 28 71 L28 160 Q74 153 120 173 Z" fill="url(#folio-page-l)" />
          <path d="M120 85 Q166 64 212 71 L212 160 Q166 153 120 173 Z" fill="url(#folio-page-r)" />
          <g className="folio-lines">
            <path d="M40 132 Q72 128 104 138" />
            <path d="M40 140 Q72 136 104 146" />
            <path d="M136 138 Q168 128 200 132" />
            <path d="M136 146 Q168 136 200 140" />
          </g>
          <path className="folio-spine" d="M120 85 L120 173" />

          {/* face */}
          <path className="folio-brow" d={lb} />
          <path className="folio-brow" d={rb} />
          <Eye cx={80} mood={mood} side="l" />
          <Eye cx={160} mood={mood} side="r" />
          {(mood === "idle" || mood === "triumph" || mood === "confident") && (
            <>
              <ellipse className="folio-blush" cx="62" cy="134" rx="9" ry="5" />
              <ellipse className="folio-blush" cx="178" cy="134" rx="9" ry="5" />
            </>
          )}
          <path className={`folio-mouth ${mood === "triumph" || mood === "curious" ? "filled" : ""}`} d={MOUTH[mood]} />
          {mood === "sad" && <path className="folio-tear" d="M168 124 q-5 9 0 12 q5 -3 0 -12 Z" />}

          {/* ribbon bookmark */}
          <path className="folio-ribbon" d="M124 170 L124 206 L130 199 L136 206 L136 168 Z" />
        </g>

        {mood === "thinking" && (
          <g className="folio-thought">
            <circle cx="196" cy="48" r="5" />
            <circle cx="210" cy="30" r="7" />
            <circle cx="226" cy="10" r="9" />
          </g>
        )}
        {mood === "puzzled" && (
          <g className="folio-question">
            <text x="198" y="52">?</text>
            <text x="24" y="40" className="small">?</text>
          </g>
        )}
        {(mood === "confident" || mood === "triumph" || mood === "idle") && (
          <g>
            <Sparkle x={22} y={40} delay={0} />
            <Sparkle x={214} y={34} s={1.3} delay={0.6} />
            <Sparkle x={200} y={196} s={0.8} delay={1.2} />
            {mood !== "idle" && <Sparkle x={36} y={200} s={1.1} delay={0.3} />}
          </g>
        )}
      </svg>
    </div>
  );
}
