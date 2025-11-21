/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import YourPlanesCard from '../YourPlanesCard';
import { createPlane } from '../../../test/fixtures/plane';

describe('YourPlanesCard', () => {
  it('renders plane summaries', () => {
    const plane = createPlane();
    render(<YourPlanesCard planes={[plane]} onCreatePlane={jest.fn()} onUpdatePlane={jest.fn()} />);

    expect(screen.getByText(plane.displayName as string)).toBeInTheDocument();
    expect(screen.getByText(plane.tailNumber)).toBeInTheDocument();
    expect(screen.getByText(/Cruise/i)).toBeInTheDocument();
  });

  it('submits plane form', async () => {
    const mockCreate = jest.fn().mockResolvedValue(createPlane({ tailNumber: 'N77777', id: 2 }));
    render(<YourPlanesCard planes={[]} onCreatePlane={mockCreate} onUpdatePlane={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /add plane/i }));

    fireEvent.change(screen.getByLabelText(/Tail Number/i), { target: { value: 'N77777' } });
    fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: 'Bravo' } });
    fireEvent.change(screen.getByLabelText(/Cruise Speed/i), { target: { value: '110' } });
    fireEvent.click(screen.getByRole('button', { name: /save plane/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tailNumber: 'N77777',
      cruiseSpeed: 110,
    }));
  });

  it('edits an existing plane', async () => {
    const plane = createPlane({ id: 9, tailNumber: 'N160RA', displayName: 'Romeo Alpha' });
    const mockUpdate = jest.fn().mockResolvedValue(plane);
    render(<YourPlanesCard planes={[plane]} onCreatePlane={jest.fn()} onUpdatePlane={mockUpdate} />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: 'Updated Name' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(plane.id, expect.objectContaining({
      displayName: 'Updated Name',
    }));
  });
});
