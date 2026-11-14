// Visual building blocks from the Bookinator design canvas: the seagull, cloud buttons, the sea,
// the hanging sign, speech bubbles and the language switch. Pure SVG + CSS, no images.
import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { CatalogBook } from "../engine/model.ts";
import { bookTitles, type Lang, type Strings } from "../i18n/index.ts";

export function Seagull({ className = "", mood = "idle" }: { className?: string; mood?: "idle" | "think" | "happy" | "sad" }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg className={`seagull seagull-${mood} ${className}`} viewBox="0 0 380 270" aria-hidden="true">
      <defs>
        <linearGradient id={`gb${gid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3f3f44" />
          <stop offset="0.45" stopColor="#c9c9cc" />
          <stop offset="1" stopColor="#f6f6f6" />
        </linearGradient>
      </defs>
      <g className="seagull-body">
        <polygon className="seagull-wing" points="0,160 150,126 156,166 12,174" fill="#2f2f33" />
        <polygon points="56,196 170,160 196,180" fill="#8e8e93" />
        <ellipse cx="208" cy="132" rx="128" ry="60" transform="rotate(-12 208 132)" fill={`url(#gb${gid})`} />
        <ellipse cx="286" cy="96" rx="46" ry="52" fill="#f1f1f1" />
        <g className="seagull-head">
          <circle cx="300" cy="60" r="44" fill="#f7f7f7" />
          <polygon points="338,54 374,66 338,74" fill="#f3cf4e" />
          <circle cx="318" cy="54" r="7" fill="#1a1a1a" />
          <circle cx="320" cy="52" r="2" fill="#ffffff" />
        </g>
      </g>
      <path d="M226 184 L229 206 M251 182 L254 204" stroke="#8e8e93" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M229 206 L233 250 L263 256 M254 204 L258 244 L289 248" stroke="#f3cf4e" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** "tall" = the lilac cloud, "wide" = the butter-yellow cloud. */
export type CloudShape = "tall" | "wide";

function CloudArt({ shape }: { shape: CloudShape }) {
  if (shape === "tall") {
    return (
      <svg className="cloud-art" viewBox="0 0 160 212" aria-hidden="true" preserveAspectRatio="xMidYMin meet">
        <ellipse cx="80" cy="62" rx="62" ry="60" />
        <ellipse cx="80" cy="114" rx="60" ry="14" />
        <path d="M40 126 q-10 17 0 34 q10 17 0 34" />
        <path d="M66 126 q10 17 0 34 q-10 17 0 34" />
        <path d="M94 126 q-10 17 0 34 q10 17 0 34" />
        <path d="M120 126 q10 17 0 34 q-10 17 0 34" />
      </svg>
    );
  }
  return (
    <svg className="cloud-art" viewBox="0 0 210 212" aria-hidden="true" preserveAspectRatio="xMidYMin meet">
      <ellipse cx="105" cy="62" rx="84" ry="50" />
      <ellipse cx="105" cy="114" rx="84" ry="16" />
      <path d="M48 126 q-10 17 0 34 q10 17 0 34" />
      <path d="M86 126 q10 17 0 34 q-10 17 0 34" />
      <path d="M124 126 q-10 17 0 34 q10 17 0 34" />
      <path d="M162 126 q10 17 0 34 q-10 17 0 34" />
    </svg>
  );
}

export function CloudButton({
  shape,
  label,
  className = "",
  ...rest
}: { shape: CloudShape; label: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`cloud-btn cloud-${shape} ${className}`} {...rest}>
      <CloudArt shape={shape} />
      <span className="cloud-label">{label}</span>
    </button>
  );
}

export function CloudDecor({ shape, className = "" }: { shape: CloudShape; className?: string }) {
  return (
    <div className={`cloud-decor cloud-${shape} ${className}`} aria-hidden="true">
      <CloudArt shape={shape} />
    </div>
  );
}

/** The scalloped sea band that holds the main buttons. */
export function Sea({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`sea ${className}`}>
      <svg className="sea-wave" viewBox="0 0 1280 43" preserveAspectRatio="none" aria-hidden="true">
        <path d="M-104.7 0 A150 60 0 0 0 178.3 0 A150 60 0 0 0 461.3 0 A150 60 0 0 0 744.3 0 A150 60 0 0 0 1027.3 0 A150 60 0 0 0 1310.3 0 A150 60 0 0 0 1593.3 0 L1593.3 43 L-283 43 Z" />
      </svg>
      <div className="sea-body">{children}</div>
    </div>
  );
}

/** A speech bubble with a tail pointing at the seagull. */
export function Bubble({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bubble ${className}`}>
      <svg className="bubble-tail" viewBox="0 0 40 40" aria-hidden="true">
        <polygon points="40,0 40,36 0,10" />
      </svg>
      {children}
    </div>
  );
}

/** Something hanging from the top of the sky on a rope: the question sign, a book card. */
export function Hanging({ children, className = "", rope = 120 }: { children: ReactNode; className?: string; rope?: number }) {
  return (
    <div className={`hanging ${className}`}>
      <svg className="rope" width="40" height={rope} viewBox={`0 0 40 ${rope}`} aria-hidden="true">
        <path d={`M20 0 C34 ${rope * 0.3} 6 ${rope * 0.7} 20 ${rope}`} />
      </svg>
      {children}
    </div>
  );
}

function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** A plain generated cover (D7: no cover images). */
export function Cover({ book, lang, small = false }: { book: CatalogBook; lang: Lang; small?: boolean }) {
  const { main } = bookTitles(book, lang);
  return (
    <div className={`cover ${small ? "cover-sm" : ""}`} style={{ ["--hue" as string]: hue(book.title_en) }} aria-hidden="true">
      <span>{small ? main.replace(/^The /, "").slice(0, 1) : main}</span>
    </div>
  );
}

export function BookCard({ book, lang, small = false }: { book: CatalogBook; lang: Lang; small?: boolean }) {
  const { main, alt } = bookTitles(book, lang);
  return (
    <div className={`book-card ${small ? "small" : ""}`}>
      <Cover book={book} lang={lang} small={small} />
      <div className="book-card-text">
        <p className="book-title">{main}</p>
        {alt && <p className="book-alt">{alt}</p>}
        <p className="book-meta">
          {book.author}
          {book.first_publication_year ? ` · ${book.first_publication_year}` : ""}
        </p>
      </div>
    </div>
  );
}

export function LangToggle({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Strings }) {
  return (
    <div className="lang-toggle" role="group" aria-label={t.langGroup}>
      <button type="button" aria-pressed={lang === "ko"} onClick={() => setLang("ko")} lang="ko">
        한국어
      </button>
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">
        English
      </button>
    </div>
  );
}

export function UndoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}
