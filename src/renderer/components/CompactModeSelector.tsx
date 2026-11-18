import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Mode } from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { ModeSwitcher } from '@/components/ModeSwitcher';

interface CompactModeSelectorProps {
  current: Mode;
  onRequestMode: (mode: Mode) => void;
  disabled?: boolean;
}

/** Compact Workspace trigger; the shared mode registry supplies the choices. */
export function CompactModeSelector({ current, onRequestMode, disabled = false }: CompactModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dismiss = useCallback(() => setOpen(false), []);
  const descriptor = getModeDescriptor(current);

  return (
    <div className="workspace-mode-anchor">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Operating mode: ${descriptor.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'pixel-mode-menu' : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="workspace-mode-trigger"
      >
        <span>{descriptor.label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <ModeSwitcher
          current={current}
          onRequestMode={(mode) => { dismiss(); onRequestMode(mode); }}
          onDismiss={dismiss}
          returnFocusRef={triggerRef}
          placement="anchored"
        />
      ) : null}
    </div>
  );
}
