import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useModalFocus } from '../useModalFocus';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  label: string;
  withInitialRef?: boolean;
  empty?: boolean;
}

const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, label, withInitialRef, empty }) => {
  const initialRef = React.useRef<HTMLButtonElement>(null);
  const containerRef = useModalFocus<HTMLDivElement>({
    isOpen,
    onClose,
    initialFocusRef: withInitialRef ? initialRef : undefined,
  });
  if (!isOpen) return null;
  return (
    <div ref={containerRef} role="dialog" aria-label={label} data-testid={`dialog-${label}`}>
      {empty ? (
        <span>nothing tabbable</span>
      ) : (
        <>
          <button>{label}-first</button>
          <button ref={initialRef}>{label}-middle</button>
          <button>{label}-last</button>
        </>
      )}
    </div>
  );
};

const Harness: React.FC<{ withInitialRef?: boolean; onClose?: () => void }> = ({ withInitialRef, onClose }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>opener</button>
      <Dialog
        isOpen={open}
        label="A"
        withInitialRef={withInitialRef}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      />
    </div>
  );
};

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  const opener = screen.getByText('opener');
  opener.focus();
  await user.click(opener);
  return opener;
};

describe('useModalFocus', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('focuses the first tabbable element on open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);
    expect(screen.getByText('A-first')).toHaveFocus();
  });

  it('focuses initialFocusRef when provided', async () => {
    const user = userEvent.setup();
    render(<Harness withInitialRef />);
    await openDialog(user);
    expect(screen.getByText('A-middle')).toHaveFocus();
  });

  it('focuses the container itself when it has no tabbable element and keeps it there on Tab', async () => {
    const user = userEvent.setup();
    render(<Dialog isOpen onClose={() => {}} label="E" empty />);
    const dialog = screen.getByTestId('dialog-E');
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toHaveFocus();
  });

  it('wraps Tab from the last element to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);
    screen.getByText('A-last').focus();
    await user.tab();
    expect(screen.getByText('A-first')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first element to the last', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);
    await user.tab({ shift: true });
    expect(screen.getByText('A-last')).toHaveFocus();
  });

  it('pulls focus back in when Tab is pressed while focus is outside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = await openDialog(user);
    opener.focus();
    expect(opener).toHaveFocus();
    await user.tab();
    expect(screen.getByText('A-first')).toHaveFocus();
  });

  it('calls onClose exactly once per Escape press', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await openDialog(user);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores keys when closed', () => {
    const onClose = vi.fn();
    render(<Dialog isOpen={false} onClose={onClose} label="Z" />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('restores focus to the opener on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = await openDialog(user);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('dialog-A')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not restore focus when the opener was removed from the document', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<Dialog isOpen onClose={() => {}} label="R" />);
    expect(screen.getByText('R-first')).toHaveFocus();
    opener.remove();
    rerender(<Dialog isOpen={false} onClose={() => {}} label="R" />);
    expect(document.activeElement).not.toBe(opener);
  });

  it('only the most recently opened modal handles Escape', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    render(
      <>
        <Dialog isOpen onClose={closeA} label="A" />
        <Dialog isOpen onClose={closeB} label="B" />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });

  it('returns Escape handling to the lower modal once the top one closes', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const { rerender } = render(
      <>
        <Dialog isOpen onClose={closeA} label="A" />
        <Dialog isOpen onClose={closeB} label="B" />
      </>,
    );
    rerender(
      <>
        <Dialog isOpen onClose={closeA} label="A" />
        <Dialog isOpen={false} onClose={closeB} label="B" />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
  });

  it('registers the window listener only while open and removes it on close and unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const adds = () => addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    const removes = () => removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length;

    const { rerender, unmount } = render(<Dialog isOpen={false} onClose={() => {}} label="L" />);
    expect(adds()).toBe(0);

    rerender(<Dialog isOpen onClose={() => {}} label="L" />);
    expect(adds()).toBe(1);

    rerender(<Dialog isOpen={false} onClose={() => {}} label="L" />);
    expect(removes()).toBe(1);

    rerender(<Dialog isOpen onClose={() => {}} label="L" />);
    expect(adds()).toBe(2);
    unmount();
    expect(removes()).toBe(2);
  });

  it('does not re-subscribe when onClose identity changes between renders', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { rerender } = render(<Dialog isOpen onClose={() => {}} label="S" />);
    const before = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    rerender(<Dialog isOpen onClose={() => {}} label="S" />);
    rerender(<Dialog isOpen onClose={() => {}} label="S" />);
    expect(addSpy.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(before);
  });
});
