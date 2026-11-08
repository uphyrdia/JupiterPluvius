import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import { ScrambleText } from "./ScrambleText";

interface Props {
  id: string; // page id; the title gets id `${id}-title` for aria-labelledby
  title: string;
  kicker: string;
  active: boolean;
  onBack?: () => void; // pages opened from the overview get a button back to it
  children?: ReactNode;
}

/** A back button (on pages opened from the overview), the decoding title and a HUD ruler. */
export function PageHeader({ id, title, kicker, active, onBack, children }: Props) {
  return (
    <header className="ph reveal" style={{ "--d": 0 } as CSSProperties}>
      <div className="ph-body">
        <p className="ph-kicker">
          {onBack && (
            <button type="button" className="tag ph-back" onClick={onBack} aria-label="Back to the overview">
              <Icon name="left" size={11} />
              Overview
            </button>
          )}
          <span className="micro">{kicker}</span>
        </p>
        <h2 id={`${id}-title`} className="ph-title">
          <ScrambleText text={title.toUpperCase()} play={active} delay={380} />
        </h2>
        {children}
      </div>
      <div className="ph-ruler" aria-hidden="true">
        <i />
      </div>
    </header>
  );
}
