import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface UseModalFocusOptions {
  isOpen: boolean;
  onClose: () => void;
  /** Element to focus when the modal opens (defaults to the first tabbable element). */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const TABBABLE_SELECTOR = ['a[href]', 'button', 'input', 'select', 'textarea', '[tabindex]'].join(',');

function getTabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.closest('[hidden]')) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return true;
  });
}

// Modals currently open, most recently opened last. Only the top one handles keys.
const modalStack: symbol[] = [];

/**
 * Shared modal focus handling: focus trap, Escape to close, initial focus and
 * focus restoration. Attach the returned ref to the dialog container. Call it
 * before any early return so hook order stays stable.
 */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  initialFocusRef,
}: UseModalFocusOptions): RefObject<T> {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    if (!isOpen) return;

    const id = Symbol('modal');
    modalStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (container) {
      const initial = initialFocusRefRef.current?.current ?? getTabbable(container)[0];
      if (initial) {
        initial.focus();
      } else {
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const el = containerRef.current;
      if (!el) return;

      const tabbable = getTabbable(el);
      if (tabbable.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }

      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!active || !el.contains(active) || active === el) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      if (
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.body.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}
