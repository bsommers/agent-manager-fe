import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from '../layout/Toolbar';
import { agentStore } from '../../store/agentStore';

describe('Toolbar Component', () => {
  it('renders layout mode buttons and triggers modal', () => {
    const handleOpenModal = vi.fn();
    render(<Toolbar onOpenAddModal={handleOpenModal} />);

    expect(screen.getByPlaceholderText(/Search agents by name or host/i)).toBeInTheDocument();
    expect(screen.getByText('Grid')).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();
    expect(screen.getByText('Cascade')).toBeInTheDocument();

    const addBtn = screen.getByRole('button', { name: /New Agent/i });
    fireEvent.click(addBtn);
    expect(handleOpenModal).toHaveBeenCalledTimes(1);
  });

  it('updates store layout mode on button click', () => {
    render(<Toolbar onOpenAddModal={() => {}} />);

    const focusBtn = screen.getByText('Focus');
    fireEvent.click(focusBtn);
    expect(agentStore.layoutMode).toBe('focus');

    const gridBtn = screen.getByText('Grid');
    fireEvent.click(gridBtn);
    expect(agentStore.layoutMode).toBe('grid');
  });

  it('updates store search query on input', () => {
    render(<Toolbar onOpenAddModal={() => {}} />);

    const input = screen.getByPlaceholderText(/Search agents by name or host/i);
    fireEvent.change(input, { target: { value: 'prod-server' } });
    expect(agentStore.searchQuery).toBe('prod-server');

    fireEvent.change(input, { target: { value: '' } });
    expect(agentStore.searchQuery).toBe('');
  });
});
