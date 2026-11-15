import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';

describe('IG Relationship Auditor end-to-end UI flow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads demo export, reconciles simulated live drift, and executes guided in-system unfollow', async () => {
    render(<App />);

    const demoBtn = await screen.findByRole('button', { name: /Load Sample Demo/i });
    fireEvent.click(demoBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Not Following Back/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Export Data Is ~35 Days Old/i)).toBeInTheDocument();
    });

    // Navigate to Live Fact-Check tab
    fireEvent.click(screen.getByRole('button', { name: /^Live Fact-Check$/i }));
    const driftBtn = await screen.findByRole('button', { name: /Apply Demo Live Drift/i });
    fireEvent.click(driftBtn);

    await waitFor(() => {
      expect(screen.getByText(/Queue All \d+ Confirmed Non-Mutuals/i)).toBeInTheDocument();
    });

    // Queue confirmed non-mutuals -> automatically navigates to Unfollow Cockpit
    fireEvent.click(screen.getByRole('button', { name: /Queue All \d+ Confirmed Non-Mutuals/i }));

    await waitFor(() => {
      expect(screen.getByText(/In-System Unfollow Cockpit/i)).toBeInTheDocument();
    });

    // Switch to Guided Keyboard Cockpit and mark one unfollowed
    fireEvent.click(screen.getByRole('button', { name: /Guided Keyboard Cockpit/i }));
    const markBtn = await screen.findByRole('button', { name: /Mark Unfollowed & Next/i });
    fireEvent.click(markBtn);

    await waitFor(() => {
      expect(screen.getByText(/guided_manual/i)).toBeInTheDocument();
    });
  });
});
