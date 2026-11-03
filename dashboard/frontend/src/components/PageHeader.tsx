import type { CSSProperties, ReactNode } from "react";
import { pad2 } from "../lib/format";
import { ScrambleText } from "./ScrambleText";

interface Props {
  n: number; // section number (1-based)
  id: string; // page id; the title gets id `${id}-title` for aria-labelledby
  title: string;
  kicker: string;
  active: boolean;
  children?: ReactNode;
}

/** Big outlined section number, a tag, the decoding title and a HUD ruler. */
export function PageHeader({ n, id, title, kicker, active, children }: Props) {
  return (
    <header className="ph reveal" style={{ "--d": 0 } as CSSProperties}>
      <span className="ph-num" aria-hidden="true">
        {pad2(n)}
      </span>
      <div className="ph-body">
        <p className="ph-kicker">
          <span className="tag">SECT·{pad2(n)}</span>
          <span className="micro">{kicker}</span>
        </p>
        <h2 id={`${id}-title`} className="ph-title">
          <ScrambleText text={title.toUpperCase()} play={active} delay={380} />
        </h2>
        {children}
      </div>
      <div className="ph-ruler" aria-hidden="true">
        <span>{pad2(n)}.0</span>
        <i />
        <span>{pad2(n)}.5</span>
        <i />
        <span>{pad2(n + 1)}.0</span>
      </div>
    </header>
  );
}
